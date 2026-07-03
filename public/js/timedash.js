// Fullscreen time-tracking dashboard: per-project billing on top of the tracker.
// Ranges (today / 7 days / calendar month with ‹› nav / all), hourly rate per
// project (persisted in config.billingRates), computed amounts, CSV export.
import { state, send } from './state.js';

let overlay = null;
let mode = 'month';           // 'today' | 'week' | 'month' | 'all'
let monthDate = new Date();   // which calendar month when mode==='month'
let expanded = new Set();     // projectIds with visible task rows
let lastDays = {};
let timer = null;

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function fmt(ms) {
  const m = Math.round(ms / 60000);
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}
function hours(ms) { return ms / 3600000; }
function chf(n) { return n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function filterKeys(days) {
  const keys = Object.keys(days).sort();
  const today = new Date().toISOString().slice(0, 10);
  if (mode === 'today') return keys.filter(k => k === today);
  if (mode === 'week') {
    const cutoff = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    return keys.filter(k => k >= cutoff);
  }
  if (mode === 'month') {
    const prefix = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    return keys.filter(k => k.startsWith(prefix));
  }
  return keys;
}

function aggregate(days) {
  const projects = new Map(); // pid -> {name, agentMs, userMs, tasks: Map}
  for (const key of filterKeys(days)) {
    for (const entry of Object.values(days[key] || {})) {
      const pid = entry.projectId || '__none__';
      let proj = projects.get(pid);
      if (!proj) {
        const cfgProj = (state.cfg.projects || []).find(p => p.id === entry.projectId);
        proj = { pid, name: cfgProj?.name || (entry.projectId ? 'Unbekanntes Projekt' : 'Ohne Projekt'), agentMs: 0, userMs: 0, tasks: new Map() };
        projects.set(pid, proj);
      }
      proj.agentMs += entry.agentMs || 0;
      proj.userMs += entry.userMs || 0;
      const tName = entry.name || 'Unbenannt';
      const t = proj.tasks.get(tName) || { agentMs: 0, userMs: 0 };
      t.agentMs += entry.agentMs || 0;
      t.userMs += entry.userMs || 0;
      proj.tasks.set(tName, t);
    }
  }
  return [...projects.values()].sort((a, b) => (b.agentMs + b.userMs) - (a.agentMs + a.userMs));
}

function rateOf(pid) { return Number(state.cfg.billingRates?.[pid]) || 0; }

function setRate(pid, value) {
  state.cfg.billingRates = state.cfg.billingRates || {};
  const v = Number(value);
  if (v > 0) state.cfg.billingRates[pid] = v;
  else delete state.cfg.billingRates[pid];
  send({ type: 'config.update', config: state.cfg });
}

function rangeLabel() {
  if (mode === 'today') return 'Heute';
  if (mode === 'week') return 'Letzte 7 Tage';
  if (mode === 'month') return `${MONTHS[monthDate.getMonth()]} ${monthDate.getFullYear()}`;
  return 'Gesamt';
}

function exportCsv(projects) {
  const rows = [['Projekt', 'Task', 'Agent (h)', 'Selbst (h)', 'Total (h)', 'CHF/h', 'Betrag CHF']];
  for (const p of projects) {
    const rate = rateOf(p.pid);
    const totalH = hours(p.agentMs + p.userMs);
    rows.push([p.name, '— gesamt —', hours(p.agentMs).toFixed(2), hours(p.userMs).toFixed(2), totalH.toFixed(2), rate || '', rate ? (totalH * rate).toFixed(2) : '']);
    for (const [tName, t] of p.tasks) {
      rows.push([p.name, tName, hours(t.agentMs).toFixed(2), hours(t.userMs).toFixed(2), hours(t.agentMs + t.userMs).toFixed(2), '', '']);
    }
  }
  const csv = rows.map(r => r.map(c => `"${String(c).replaceAll('"', '""')}"`).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `nos-zeiten-${rangeLabel().replaceAll(' ', '-').toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function statCard(label, value, accent) {
  const card = document.createElement('div');
  card.style.cssText = 'flex:1;min-width:150px;background:rgba(30,41,59,0.5);border:1px solid rgba(100,116,139,0.25);border-radius:12px;padding:14px 18px;';
  const l = document.createElement('div');
  l.textContent = label;
  l.style.cssText = 'font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;';
  const v = document.createElement('div');
  v.textContent = value;
  v.style.cssText = `font-size:22px;font-weight:700;margin-top:4px;color:${accent || '#e2e8f0'};font-variant-numeric:tabular-nums;`;
  card.append(l, v);
  return card;
}

function render() {
  const body = overlay.querySelector('.dash-body');
  const projects = aggregate(lastDays);
  body.textContent = '';

  overlay.querySelector('.dash-range-label').textContent = rangeLabel();
  overlay.querySelectorAll('.dash-mode-btn').forEach(b => {
    const on = b.dataset.mode === mode;
    b.style.background = on ? 'rgba(37,99,235,0.9)' : 'rgba(30,41,59,0.7)';
    b.style.color = on ? '#fff' : '#94a3b8';
  });
  overlay.querySelector('.dash-month-nav').style.display = mode === 'month' ? 'flex' : 'none';

  let totalAgent = 0, totalUser = 0, totalChf = 0, unratedMs = 0;
  for (const p of projects) {
    totalAgent += p.agentMs; totalUser += p.userMs;
    const rate = rateOf(p.pid);
    if (rate) totalChf += hours(p.agentMs + p.userMs) * rate;
    else unratedMs += p.agentMs + p.userMs;
  }

  const cards = document.createElement('div');
  cards.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;';
  cards.append(
    statCard('Total Zeit', fmt(totalAgent + totalUser)),
    statCard('🤖 Agent', fmt(totalAgent), '#93c5fd'),
    statCard('⌨ Selbst', fmt(totalUser), '#fbbf24'),
    statCard('Verrechenbar', 'CHF ' + chf(totalChf), '#22c55e'),
  );
  body.appendChild(cards);

  if (unratedMs > 60000) {
    const hint = document.createElement('div');
    hint.textContent = `Hinweis: ${fmt(unratedMs)} ohne Stundensatz — Satz in der Tabelle eintragen, dann fließt es in „Verrechenbar" ein.`;
    hint.style.cssText = 'font-size:11px;color:#f59e0b;margin:-8px 0 14px 2px;';
    body.appendChild(hint);
  }

  // Table
  const table = document.createElement('div');
  table.style.cssText = 'border:1px solid rgba(100,116,139,0.25);border-radius:12px;overflow:hidden;';
  const header = document.createElement('div');
  header.style.cssText = 'display:grid;grid-template-columns:1fr 90px 90px 90px 90px 110px;gap:8px;padding:9px 14px;background:rgba(30,41,59,0.6);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;';
  for (const h of ['Projekt / Task', '🤖 Agent', '⌨ Selbst', 'Total', 'CHF/h', 'Betrag']) {
    const c = document.createElement('span');
    c.textContent = h;
    if (h !== 'Projekt / Task') c.style.textAlign = 'right';
    header.appendChild(c);
  }
  table.appendChild(header);

  if (!projects.length) {
    const empty = document.createElement('div');
    empty.textContent = 'Keine Daten im gewählten Zeitraum.';
    empty.style.cssText = 'padding:24px 14px;font-size:13px;color:#64748b;';
    table.appendChild(empty);
  }

  for (const p of projects) {
    const rate = rateOf(p.pid);
    const totalMs = p.agentMs + p.userMs;
    const row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:1fr 90px 90px 90px 90px 110px;gap:8px;padding:10px 14px;border-top:1px solid rgba(100,116,139,0.15);font-size:13px;color:#e2e8f0;align-items:center;cursor:pointer;';
    const name = document.createElement('span');
    name.textContent = `${expanded.has(p.pid) ? '▾' : '▸'} ${p.name}`;
    name.style.cssText = 'font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const a = document.createElement('span'); a.textContent = fmt(p.agentMs); a.style.cssText = 'text-align:right;color:#93c5fd;';
    const u = document.createElement('span'); u.textContent = fmt(p.userMs); u.style.cssText = 'text-align:right;color:#fbbf24;';
    const t = document.createElement('span'); t.textContent = fmt(totalMs); t.style.cssText = 'text-align:right;font-weight:600;';
    const rateWrap = document.createElement('span');
    rateWrap.style.cssText = 'text-align:right;';
    const rateInput = document.createElement('input');
    rateInput.type = 'number';
    rateInput.min = '0';
    rateInput.placeholder = '–';
    rateInput.value = rate || '';
    rateInput.title = 'Stundensatz (CHF) für dieses Projekt';
    rateInput.style.cssText = 'width:70px;background:rgba(30,41,59,0.8);border:1px solid rgba(100,116,139,0.3);border-radius:6px;color:#e2e8f0;font-size:12px;padding:3px 6px;text-align:right;outline:none;';
    rateInput.addEventListener('click', (e) => e.stopPropagation());
    rateInput.addEventListener('change', () => { setRate(p.pid, rateInput.value); render(); });
    rateWrap.appendChild(rateInput);
    const amount = document.createElement('span');
    amount.textContent = rate ? 'CHF ' + chf(hours(totalMs) * rate) : '—';
    amount.style.cssText = `text-align:right;font-weight:700;color:${rate ? '#22c55e' : '#475569'};font-variant-numeric:tabular-nums;`;
    row.append(name, a, u, t, rateWrap, amount);
    row.addEventListener('click', () => {
      expanded.has(p.pid) ? expanded.delete(p.pid) : expanded.add(p.pid);
      render();
    });
    table.appendChild(row);

    if (expanded.has(p.pid)) {
      const tasks = [...p.tasks.entries()].sort((x, y) => (y[1].agentMs + y[1].userMs) - (x[1].agentMs + x[1].userMs));
      for (const [tName, tk] of tasks) {
        const tr = document.createElement('div');
        tr.style.cssText = 'display:grid;grid-template-columns:1fr 90px 90px 90px 90px 110px;gap:8px;padding:6px 14px 6px 34px;border-top:1px solid rgba(100,116,139,0.08);font-size:12px;color:#94a3b8;';
        const tn = document.createElement('span');
        tn.textContent = tName;
        tn.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        const ta = document.createElement('span'); ta.textContent = fmt(tk.agentMs); ta.style.textAlign = 'right';
        const tu = document.createElement('span'); tu.textContent = fmt(tk.userMs); tu.style.textAlign = 'right';
        const tt = document.createElement('span'); tt.textContent = fmt(tk.agentMs + tk.userMs); tt.style.cssText = 'text-align:right;font-weight:600;color:#cbd5e1;';
        tr.append(tn, ta, tu, tt, document.createElement('span'), document.createElement('span'));
        table.appendChild(tr);
      }
    }
  }
  body.appendChild(table);

  overlay.querySelector('.dash-csv').onclick = () => exportCsv(projects);
}

async function refresh() {
  try {
    const res = await fetch('/api/timetracking');
    if (res.ok) { lastDays = await res.json(); render(); }
  } catch { /* offline */ }
}

function build() {
  overlay = document.createElement('div');
  overlay.id = 'time-dashboard';
  overlay.style.cssText = 'position:absolute;inset:4px 4px 0;z-index:45;display:flex;flex-direction:column;background:#0b1220;pointer-events:auto;overflow:hidden;';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid rgba(100,116,139,0.25);flex-wrap:wrap;';
  const title = document.createElement('span');
  title.textContent = 'Time Tracking';
  title.style.cssText = 'font-size:15px;font-weight:700;color:#e2e8f0;';
  const rangeLabelEl = document.createElement('span');
  rangeLabelEl.className = 'dash-range-label';
  rangeLabelEl.style.cssText = 'font-size:12px;color:#64748b;margin-right:8px;';

  const modes = document.createElement('div');
  modes.style.cssText = 'display:flex;gap:4px;';
  for (const [m, lbl] of [['today', 'Heute'], ['week', '7 Tage'], ['month', 'Monat'], ['all', 'Alles']]) {
    const b = document.createElement('button');
    b.className = 'dash-mode-btn';
    b.dataset.mode = m;
    b.textContent = lbl;
    b.style.cssText = 'font-size:11px;padding:4px 10px;border-radius:6px;background:rgba(30,41,59,0.7);color:#94a3b8;';
    b.addEventListener('click', () => { mode = m; render(); });
    modes.appendChild(b);
  }
  const monthNav = document.createElement('div');
  monthNav.className = 'dash-month-nav';
  monthNav.style.cssText = 'display:flex;gap:2px;align-items:center;';
  const prev = document.createElement('button');
  prev.textContent = '‹';
  prev.style.cssText = 'font-size:15px;padding:0 8px;color:#94a3b8;';
  prev.addEventListener('click', () => { monthDate = new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1); render(); });
  const next = document.createElement('button');
  next.textContent = '›';
  next.style.cssText = 'font-size:15px;padding:0 8px;color:#94a3b8;';
  next.addEventListener('click', () => { monthDate = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1); render(); });
  monthNav.append(prev, next);

  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  const csvBtn = document.createElement('button');
  csvBtn.className = 'dash-csv';
  csvBtn.textContent = '⬇ CSV Export';
  csvBtn.style.cssText = 'font-size:11px;font-weight:600;padding:5px 12px;border-radius:6px;background:rgba(37,99,235,0.9);color:#fff;';
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.title = 'Dashboard schließen';
  closeBtn.style.cssText = 'font-size:13px;padding:4px 10px;color:#94a3b8;';
  closeBtn.addEventListener('click', closeTimeDashboard);

  head.append(title, rangeLabelEl, modes, monthNav, spacer, csvBtn, closeBtn);

  const bodyEl = document.createElement('div');
  bodyEl.className = 'dash-body';
  bodyEl.style.cssText = 'flex:1;overflow-y:auto;padding:18px 20px;';

  overlay.append(head, bodyEl);
  document.getElementById('main').appendChild(overlay);

  // Any other rail icon closes the dashboard (capture-phase so it fires even for
  // icons whose own handlers stopPropagation). The time icon itself is exempt.
  document.getElementById('nav-rail')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.rail-btn');
    if (!btn || btn.id === 'rail-time') return;
    if (overlay && overlay.style.display !== 'none') closeTimeDashboard();
  }, true);
  // Esc closes it too
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay && overlay.style.display !== 'none') { e.stopPropagation(); closeTimeDashboard(); }
  }, true);
}

export function openTimeDashboard() {
  if (!overlay) build();
  overlay.style.display = 'flex';
  monthDate = new Date();
  refresh();
  if (!timer) timer = setInterval(() => { if (overlay && overlay.style.display !== 'none') refresh(); }, 30000);
}

export function closeTimeDashboard() {
  if (overlay) overlay.style.display = 'none';
}
