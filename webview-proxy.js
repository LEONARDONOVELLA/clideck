// Reverse proxy for the dashboard's browser view (web panes).
//
// /webview/<port>/<path> is proxied to http://127.0.0.1:<port>/<path> with
// anti-framing headers stripped, so local dev servers render inside the
// dashboard's iframes regardless of X-Frame-Options/CSP — and are reachable
// remotely even when they only listen on localhost.
//
// Apps request their assets with absolute paths (/assets/x.js), which miss the
// /webview prefix. handleFallback() catches those at the dashboard's 404 spot
// by sniffing the Referer for a /webview/<port>/ context.
//
// Targets are restricted to 127.0.0.1 — this cannot proxy to arbitrary hosts.

const http = require('http');

const PREFIX_RE = /^\/webview\/(\d{2,5})(\/.*)?$/;

function refererPort(req) {
  const m = String(req.headers.referer || '').match(/\/webview\/(\d{2,5})\//);
  return m ? Number(m[1]) : null;
}

function proxyTo(port, path, req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  delete headers['accept-encoding']; // keep upstream responses un-compressed and pipeable
  const upstream = http.request(
    { host: '127.0.0.1', port, path, method: req.method, headers },
    (ur) => {
      const out = { ...ur.headers };
      delete out['x-frame-options'];
      delete out['content-security-policy'];
      delete out['content-security-policy-report-only'];
      // Keep same-origin redirects inside the proxy prefix
      if (out.location && out.location.startsWith('/') && !out.location.startsWith('/webview/')) {
        out.location = `/webview/${port}${out.location}`;
      }
      res.writeHead(ur.statusCode || 502, out);
      ur.pipe(res);
    }
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end(`webview: cannot reach 127.0.0.1:${port}`);
  });
  req.pipe(upstream);
  return true;
}

// Explicit /webview/<port>/... requests. Returns true when handled.
function handle(req, res) {
  const m = String(req.url || '').match(PREFIX_RE);
  if (!m) return false;
  return proxyTo(Number(m[1]), m[2] || '/', req, res);
}

// Absolute-path asset requests coming from inside a proxied page (Referer sniffing).
// Call where the dashboard would otherwise 404. Returns true when handled.
function handleFallback(req, res) {
  const port = refererPort(req);
  if (!port) return false;
  return proxyTo(port, req.url, req, res);
}

module.exports = { handle, handleFallback };
