// Time-tracking report panel: agent + user time per project per task (session).
// Data comes from GET /api/timetracking (server-side tracker, daily buckets).
import { state } from './state.js';

let range = 'today';
let timer = null;

function fmt(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return ms > 0 ? '<1m' : '0m';
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

function daysInRange(days) {
  const keys = Object.keys(days).sort().reverse();
  if (range === 'today') return keys.slice(0, 1);
  if (range === 'week') {
    const cutoff = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    return keys.filter(k => k >= cutoff);
  }
  return keys;
}

function aggregate(days) {
  // projectId -> { name, agentMs, userMs, tasks: Map(taskName -> {agentMs,userMs,live}) }
  const projects = new Map();
  for (const dayKey of daysInRange(days)) {
    for (const entry of Object.values(days[dayKey] || {})) {
      const pid = entry.projectId || '__none__';
      let proj = projects.get(pid);
      if (!proj) {
        const cfgProj = (state.cfg.projects || []).find(p => p.id === entry.projectId);
        proj = { name: cfgProj?.name || (entry.projectId ? 'Unknown project' : 'No project'), agentMs: 0, userMs: 0, tasks: new Map() };
        projects.set(pid, proj);
      }
      proj.agentMs += entry.agentMs || 0;
      proj.userMs += entry.userMs || 0;
      const tName = entry.name || 'Unnamed session';
      const t = proj.tasks.get(tName) || { agentMs: 0, userMs: 0, live: false };
      t.agentMs += entry.agentMs || 0;
      t.userMs += entry.userMs || 0;
      t.live = t.live || !!entry.live;
      proj.tasks.set(tName, t);
    }
  }
  return [...projects.values()].sort((a, b) => (b.agentMs + b.userMs) - (a.agentMs + a.userMs));
}

function render(days) {
  const root = document.getElementById('time-report');
  if (!root) return;
  root.textContent = '';
  const projects = aggregate(days);

  let totalAgent = 0, totalUser = 0;
  for (const p of projects) { totalAgent += p.agentMs; totalUser += p.userMs; }

  const total = document.createElement('div');
  total.style.cssText = 'display:flex;justify-content:space-between;padding:8px 6px;margin-bottom:6px;border-bottom:1px solid rgba(100,116,139,0.25);font-size:12px;color:#e2e8f0;font-weight:600;';
  const totalLeft = document.createElement('span');
  totalLeft.textContent = 'Total';
  const totalRight = document.createElement('span');
  totalRight.textContent = fmt(totalAgent + totalUser);
  total.append(totalLeft, totalRight);
  root.appendChild(total);

  const legend = document.createElement('div');
  legend.style.cssText = 'font-size:10px;color:#64748b;padding:0 6px 8px;';
  legend.textContent = `🤖 Agent ${fmt(totalAgent)} · ⌨ Du ${fmt(totalUser)}`;
  root.appendChild(legend);

  if (!projects.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:16px 6px;font-size:12px;color:#64748b;';
    empty.textContent = 'Noch keine Daten im gewählten Zeitraum.';
    root.appendChild(empty);
    return;
  }

  for (const proj of projects) {
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;padding:7px 6px 3px;font-size:11px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:#94a3b8;';
    const hName = document.createElement('span');
    hName.textContent = proj.name;
    hName.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const hTime = document.createElement('span');
    hTime.textContent = fmt(proj.agentMs + proj.userMs);
    hTime.style.cssText = 'color:#e2e8f0;flex-shrink:0;margin-left:8px;';
    head.append(hName, hTime);
    root.appendChild(head);

    const tasks = [...proj.tasks.entries()].sort((a, b) => (b[1].agentMs + b[1].userMs) - (a[1].agentMs + a[1].userMs));
    for (const [tName, t] of tasks) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;padding:3px 6px 3px 14px;font-size:12px;color:#cbd5e1;';
      const left = document.createElement('span');
      left.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      if (t.live) {
        const dot = document.createElement('span');
        dot.textContent = '● ';
        dot.style.cssText = 'color:#eab308;font-size:9px;';
        dot.title = 'Agent arbeitet gerade';
        left.appendChild(dot);
      }
      left.appendChild(document.createTextNode(tName));
      const right = document.createElement('span');
      right.style.cssText = 'flex-shrink:0;margin-left:8px;color:#64748b;font-size:11px;';
      right.textContent = `🤖 ${fmt(t.agentMs)} · ⌨ ${fmt(t.userMs)}`;
      row.append(left, right);
      root.appendChild(row);
    }
  }
}

async function refresh() {
  try {
    const res = await fetch('/api/timetracking');
    if (!res.ok) return;
    render(await res.json());
  } catch { /* offline / reconnecting */ }
}

export function initTimePanel() {
  document.getElementById('time-range')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.time-range-btn');
    if (!btn) return;
    range = btn.dataset.range;
    document.querySelectorAll('.time-range-btn').forEach(b => {
      const on = b === btn;
      b.className = 'time-range-btn text-[10px] px-2 py-[3px] rounded ' + (on ? 'bg-slate-700/70 text-slate-200' : 'text-slate-500 hover:text-slate-300');
    });
    refresh();
  });

  // Refresh on opening the panel; live-update every 30s while it is visible
  document.querySelector('#nav-rail .rail-btn[data-panel="time"]')?.addEventListener('click', refresh);
  timer = setInterval(() => {
    const panel = document.getElementById('panel-time');
    if (panel && !panel.classList.contains('hidden')) refresh();
  }, 30000);
}
