// AI task summaries for billing: one German sentence per session describing the
// work done, generated from ~/.clideck/transcripts/<id>.jsonl via the local
// `claude` CLI (haiku, headless -p mode — uses the user's existing auth).
// Cached in ~/.clideck/task-summaries.json, regenerated when a transcript grows.

const { readFileSync, writeFileSync, existsSync, statSync } = require('fs');
const { execFile } = require('child_process');
const { join } = require('path');
const os = require('os');

const CACHE_PATH = join(os.homedir(), '.clideck', 'task-summaries.json');
const TRANSCRIPTS = join(os.homedir(), '.clideck', 'transcripts');
const MAX_DIGEST = 9000; // chars of transcript fed to the model

let cache = {};
try { if (existsSync(CACHE_PATH)) cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8')); } catch { cache = {}; }

const queue = [];
const pending = new Set();
let running = false;

function transcriptFile(id) { return join(TRANSCRIPTS, `${id}.jsonl`); }

function digestOf(id) {
  const file = transcriptFile(id);
  if (!existsSync(file)) return null;
  const lines = readFileSync(file, 'utf8').trim().split('\n');
  const parts = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      if (!e.text) continue;
      parts.push(`[${e.role}] ${String(e.text).slice(0, 1200)}`);
    } catch { /* skip malformed line */ }
  }
  if (!parts.length) return null;
  let digest = parts.join('\n');
  if (digest.length > MAX_DIGEST) digest = digest.slice(0, MAX_DIGEST / 2) + '\n[...]\n' + digest.slice(-MAX_DIGEST / 2);
  return digest;
}

function isFresh(id) {
  const c = cache[id];
  if (!c?.summary) return false;
  try {
    const size = statSync(transcriptFile(id)).size;
    return Math.abs(size - (c.srcSize || 0)) < 500;
  } catch { return true; } // transcript gone → keep what we have
}

function generateOne(id) {
  return new Promise((resolve) => {
    const digest = digestOf(id);
    if (!digest) { resolve(null); return; }
    const prompt = 'Du bist ein Abrechnungs-Assistent. Unten steht das Protokoll einer Arbeits-Session '
      + 'zwischen einem Nutzer und einem KI-Coding-Agenten. Fasse in EINEM deutschen Satz '
      + '(max. 18 Wörter, ohne Anführungszeichen, ohne Einleitung) zusammen, welche Arbeit erledigt wurde. '
      + 'Antworte NUR mit diesem einen Satz.\n\n---\n' + digest;
    execFile('claude', ['-p', prompt, '--model', 'haiku'], { timeout: 90000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err || !stdout) { resolve(null); return; }
      const summary = stdout.trim().split('\n').filter(Boolean).pop()?.slice(0, 300) || null;
      resolve(summary);
    });
  });
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const id = queue.shift();
    try {
      const summary = await generateOne(id);
      if (summary) {
        let srcSize = 0;
        try { srcSize = statSync(transcriptFile(id)).size; } catch { /* keep 0 */ }
        cache[id] = { summary, srcSize, at: new Date().toISOString() };
        try { writeFileSync(CACHE_PATH, JSON.stringify(cache)); } catch { /* disk hiccup */ }
      }
    } finally {
      pending.delete(id);
    }
  }
  running = false;
}

function request(ids) {
  let queued = 0;
  for (const id of ids || []) {
    if (typeof id !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(id)) continue;
    if (pending.has(id) || isFresh(id)) continue;
    if (!existsSync(transcriptFile(id))) continue;
    pending.add(id);
    queue.push(id);
    queued++;
  }
  pump();
  return queued;
}

function report() {
  const summaries = {};
  for (const [id, c] of Object.entries(cache)) if (c?.summary) summaries[id] = c.summary;
  return { summaries, pending: [...pending] };
}

module.exports = { request, report };
