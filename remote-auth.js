// Password gate for REMOTE access only (Tailscale Funnel/Serve).
//
// Local direct requests (main-machine browser, agent hooks) reach the loopback
// listener with no X-Forwarded-For header and stay auth-free. Tailscale's proxy
// always adds X-Forwarded-For to forwarded traffic, so remoteRequest() catches
// exactly the public-facing requests and requires a signed session cookie.
//
// No external deps — node:crypto only. Credentials live in ~/.clideck/remote-auth.json.

const crypto = require('crypto');
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');
const os = require('os');

const AUTH_PATH = join(os.homedir(), '.clideck', 'remote-auth.json');
const COOKIE = 'clideck_remote';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let cfg = null;

function load() {
  if (cfg) return cfg;
  if (existsSync(AUTH_PATH)) {
    try { cfg = JSON.parse(readFileSync(AUTH_PATH, 'utf8')); return cfg; } catch { /* regenerate */ }
  }
  return null;
}

// Create (or reset) the remote password. Returns the plaintext once, for display.
function provision(plainOverride) {
  const password = plainOverride || crypto.randomBytes(15).toString('base64url'); // ~20 chars
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex');
  cfg = { salt, hash, secret, createdAt: new Date().toISOString() };
  writeFileSync(AUTH_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  return password;
}

function isConfigured() { return !!load(); }

function verifyPassword(password) {
  const c = load();
  if (!c || typeof password !== 'string' || !password) return false;
  const candidate = crypto.scryptSync(password, c.salt, 64);
  const expected = Buffer.from(c.hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// --- Signed session token (HMAC), stateless ---
function issueToken() {
  const c = load();
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', c.secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  const c = load();
  if (!c || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', c.secret).update(payload).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof exp === 'number' && exp > Date.now();
  } catch { return false; }
}

// --- Request helpers ---
function remoteRequest(req) {
  // Forwarded by the tailscale proxy (Funnel/Serve) → public-facing → gate it.
  return !!req.headers['x-forwarded-for'];
}

function cookieValue(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function isAuthed(req) {
  if (!remoteRequest(req)) return true;          // local = trusted
  if (!isConfigured()) return false;             // remote with no password set → deny
  return verifyToken(cookieValue(req, COOKIE));
}

function setCookie(res) {
  // Secure: Funnel is always HTTPS. HttpOnly: JS can't read it. SameSite=Lax.
  res.setHeader('Set-Cookie',
    `${COOKIE}=${issueToken()}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(TOKEN_TTL_MS / 1000)}`);
}

// --- Login rate limiting (per forwarded client) ---
const attempts = new Map(); // key -> { count, first }
const MAX_ATTEMPTS = 8, WINDOW_MS = 15 * 60 * 1000;
function clientKey(req) { return (req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim(); }
function rateLimited(req) {
  const key = clientKey(req);
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) return false;
  return rec.count >= MAX_ATTEMPTS;
}
function recordFailure(req) {
  const key = clientKey(req);
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: now });
  else rec.count++;
}
function clearFailures(req) { attempts.delete(clientKey(req)); }

const LOGIN_HTML = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>CliDeck — Sign in</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    background:#0b1220;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e2e8f0}
  form{background:#0f172a;border:1px solid #1e293b;border-radius:16px;padding:32px;width:min(90vw,340px);
    box-shadow:0 20px 60px rgba(0,0,0,.5)}
  h1{margin:0 0 4px;font-size:18px}
  p{margin:0 0 20px;color:#64748b;font-size:13px}
  input{width:100%;box-sizing:border-box;padding:11px 13px;border-radius:9px;border:1px solid #334155;
    background:#1e293b;color:#e2e8f0;font-size:15px;outline:none}
  input:focus{border-color:#3b82f6}
  button{margin-top:14px;width:100%;padding:11px;border:0;border-radius:9px;background:#2563eb;color:#fff;
    font-size:15px;font-weight:600;cursor:pointer}
  button:hover{background:#1d4ed8}
  .err{margin-top:12px;color:#f87171;font-size:13px;min-height:16px}
</style></head><body>
<form method="POST" action="/auth/login">
  <h1>CliDeck</h1><p>Remote access — enter your password</p>
  <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password">
  <button type="submit">Sign in</button>
  <div class="err">__ERR__</div>
</form></body></html>`;

function loginPage(res, { error = '', status = 200 } = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(LOGIN_HTML.replace('__ERR__', error));
}

// Handle /auth/* routes. Returns true when the request was consumed.
function handleAuthRoutes(req, res) {
  const url = (req.url || '').split('?')[0];
  if (url === '/auth/login' && req.method === 'GET') { loginPage(res); return true; }
  if (url === '/auth/login' && req.method === 'POST') {
    if (rateLimited(req)) { loginPage(res, { error: 'Too many attempts. Wait 15 min.', status: 429 }); return true; }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      if (verifyPassword(params.get('password') || '')) {
        clearFailures(req);
        setCookie(res);
        res.writeHead(303, { Location: '/' });
        res.end();
      } else {
        recordFailure(req);
        loginPage(res, { error: 'Wrong password.', status: 401 });
      }
    });
    return true;
  }
  return false;
}

module.exports = {
  provision, isConfigured, isAuthed, remoteRequest, handleAuthRoutes, loginPage, COOKIE, AUTH_PATH,
};
