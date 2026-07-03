// Automatic per-session time tracking.
//
// Two counters per session per day, attributed to (projectId, session name):
//  - agentMs: time the agent spent working (session.status working→idle spans,
//    fed by the existing broadcast bus — covers Claude, Codex, all bridges)
//  - userMs:  the user's active typing time in the terminal (gaps > 60s end a
//    stretch, so idle time never counts)
//
// Persisted daily-bucketed in ~/.clideck/timetracking.json; the report endpoint
// includes the live (still-running) agent span so numbers tick in real time.

const { readFileSync, writeFileSync, existsSync } = require('fs');
const { join } = require('path');
const os = require('os');

const DATA_PATH = join(os.homedir(), '.clideck', 'timetracking.json');
const IDLE_GAP_MS = 60_000;

let data = { days: {} };
let dirty = false;
let getSessions = null;

function today() { return new Date().toISOString().slice(0, 10); }

function bucket(id) {
  const day = (data.days[today()] ||= {});
  const b = (day[id] ||= { name: '', projectId: null, agentMs: 0, userMs: 0 });
  const s = getSessions?.().get(id);
  if (s) {
    if (s.name) b.name = s.name;
    if (s.projectId !== undefined) b.projectId = s.projectId;
  }
  dirty = true;
  return b;
}

const agentStart = new Map(); // sessionId -> ts of the working-span start
function noteStatus(id, working) {
  if (working) {
    if (!agentStart.has(id)) agentStart.set(id, Date.now());
    bucket(id); // ensure name/project snapshot exists early
    return;
  }
  const t0 = agentStart.get(id);
  if (t0 !== undefined) {
    agentStart.delete(id);
    bucket(id).agentMs += Date.now() - t0;
  }
}

const lastInput = new Map(); // sessionId -> ts of last keystroke
// Terminal "input" also carries non-typing traffic: mouse-wheel scrolling and
// mouse clicks arrive as xterm escape reports (ESC[M…, ESC[<…M/m), focus events
// as ESC[I / ESC[O. Reading + scrolling must NOT count as typing time.
const NON_TYPING_RE = /^(?:\x1b\[(?:M[\s\S]{3}|<\d+;\d+;\d+[Mm]|[IO]))+$/;

function isTyping(data) {
  if (typeof data !== 'string' || !data) return false;
  return !NON_TYPING_RE.test(data);
}

function noteInput(id, data) {
  if (!isTyping(data)) return;
  const now = Date.now();
  const prev = lastInput.get(id);
  lastInput.set(id, now);
  if (prev !== undefined && now - prev < IDLE_GAP_MS) {
    bucket(id).userMs += now - prev;
  }
}

// Report: persisted data + live agent spans folded in (non-destructive copy)
function report() {
  const out = JSON.parse(JSON.stringify(data.days));
  const day = (out[today()] ||= {});
  const now = Date.now();
  for (const [id, t0] of agentStart) {
    const s = getSessions?.().get(id);
    const b = (day[id] ||= { name: s?.name || '', projectId: s?.projectId ?? null, agentMs: 0, userMs: 0 });
    b.agentMs += now - t0;
    b.live = true;
  }
  return out;
}

function save() {
  try { writeFileSync(DATA_PATH, JSON.stringify(data)); dirty = false; } catch { /* disk hiccup — retry next tick */ }
}

function init(sessionsMod) {
  getSessions = sessionsMod.getSessions;
  if (existsSync(DATA_PATH)) {
    try { data = JSON.parse(readFileSync(DATA_PATH, 'utf8')); } catch { data = { days: {} }; }
  }
  if (!data.days) data = { days: {} };
  sessionsMod.addBroadcastListener((msg) => {
    if (msg.type === 'session.status') noteStatus(msg.id, !!msg.working);
    else if (msg.type === 'closed') noteStatus(msg.id, false); // book a running span on close
  });
  setInterval(() => { if (dirty) save(); }, 30_000).unref();
}

module.exports = { init, noteInput, report, shutdownSave: save, isTyping };
