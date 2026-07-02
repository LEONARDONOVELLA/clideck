import { state } from './state.js';

// Split view: show 1-3 terminals side by side. Pure frontend — pane geometry is
// applied as inline styles on the .term-wrap elements; each terminal's own
// ResizeObserver handles refitting and PTY resize automatically.

let splitCount = 1;
let panes = [];        // session ids, index = pane position (left to right)
let focusedPane = 0;

const SPLIT_KEY = 'clideck.splitView';

export function isSplitActive() { return splitCount > 1; }
export function isInSplit(id) { return (isSplitActive() && panes.includes(id)) || id === soloId; }

// Solo view: one session fullscreen ON TOP of an untouched split (peek & return)
let soloId = null;

// --- Web panes: a pane can hold a browser view instead of a terminal ---
// Pane value shape: session id (string) or { web: url, wid: uniqueKey }

const webPanes = new Map(); // wid -> detached-able DOM element
let webSeq = 1;
let fullWeb = null;         // fullscreen browser view while in single (non-split) mode
let detachedWeb = null;     // independent fullscreen browser overlay (own rail icon),
                            // decoupled from split state — covers everything while open

function isWebPane(v) { return !!(v && typeof v === 'object' && v.wid); }

// Local URLs load through the dashboard's /webview proxy: same origin (no
// X-Frame-Options blocking) and it reaches localhost-only dev servers remotely.
function toIframeSrc(u) {
  try {
    const url = new URL(u);
    const sameHost = ['localhost', '127.0.0.1', location.hostname].includes(url.hostname);
    if (sameHost && url.port && url.protocol === 'http:' && url.port !== location.port) {
      return `/webview/${url.port}${url.pathname}${url.search}`;
    }
  } catch { /* relative or invalid — use as-is */ }
  return u;
}

function buildWebPane(p) {
  let el = webPanes.get(p.wid);
  if (el) return el;
  el = document.createElement('div');
  el.className = 'web-pane absolute z-[5] flex-col';
  el.style.cssText = 'display:none;pointer-events:auto;background:var(--color-project-header-bg,#0b1220);';

  const bar = document.createElement('div');
  bar.className = 'web-bar';
  bar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:4px 6px;background:rgba(15,23,42,0.95);border-bottom:1px solid rgba(100,116,139,0.25);';
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'URL or port (e.g. 5173)';
  input.value = p.web || '';
  input.style.cssText = 'flex:1;background:rgba(30,41,59,0.8);border:1px solid rgba(100,116,139,0.3);border-radius:6px;color:#e2e8f0;font-size:12px;padding:3px 8px;outline:none;';
  const reload = document.createElement('button');
  reload.textContent = '⟳';
  reload.title = 'Reload';
  reload.style.cssText = 'color:#94a3b8;font-size:15px;padding:0 6px;';
  const close = document.createElement('button');
  close.className = 'web-close';
  close.textContent = '✕';
  close.title = 'Close browser view';
  close.style.cssText = 'display:none;color:#94a3b8;font-size:12px;padding:0 6px;';
  close.addEventListener('click', () => {
    if (fullWeb && fullWeb.wid === p.wid) {
      destroyWebPane(fullWeb);
      fullWeb = null;
    } else if (detachedWeb && detachedWeb.wid === p.wid) {
      destroyWebPane(detachedWeb);
      detachedWeb = null;
    }
    persist();
    renderButtons();
  });
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'flex:1;border:0;width:100%;background:#fff;';

  const navigate = () => {
    let u = input.value.trim();
    if (!u) return;
    if (/^\d+$/.test(u)) u = `http://${location.hostname}:${u}`;
    else if (!/^https?:\/\//.test(u)) u = 'http://' + u;
    input.value = u;
    p.web = u;
    iframe.src = toIframeSrc(u);
    persist();
    layoutSplit(); // refresh badge host
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); navigate(); } });
  reload.addEventListener('click', () => { if (iframe.src) iframe.src = iframe.src; });

  bar.append(input, reload, close);
  el.append(bar, iframe);
  if (p.web) iframe.src = toIframeSrc(p.web);
  document.getElementById('terminals').appendChild(el);
  webPanes.set(p.wid, el);
  return el;
}

function destroyWebPane(p) {
  webPanes.get(p.wid)?.remove();
  webPanes.delete(p.wid);
}

function persist() {
  if (splitCount > 1 || fullWeb || detachedWeb) {
    localStorage.setItem(SPLIT_KEY, JSON.stringify({
      n: splitCount,
      panes: splitCount > 1 ? panes.slice(0, splitCount) : [],
      focused: focusedPane,
      fullWeb,
      detached: detachedWeb,
    }));
  } else {
    localStorage.removeItem(SPLIT_KEY);
  }
}

// Keep new wids unique even after restoring persisted ones like "w3"
function bumpWebSeq(wid) {
  const n = parseInt(String(wid).slice(1), 10);
  if (Number.isInteger(n) && n >= webSeq) webSeq = n + 1;
}

// Re-apply the persisted split after the initial session list has arrived.
// Returns a session id the caller should select (to align keyboard focus), or null.
export function restoreSplit() {
  if (isSplitActive() || fullWeb || detachedWeb) return null; // live state wins (e.g. websocket reconnect)
  try {
    const saved = JSON.parse(localStorage.getItem(SPLIT_KEY) || 'null');
    if (!saved) return null;
    if (isWebPane(saved.fullWeb)) {
      fullWeb = saved.fullWeb;
      bumpWebSeq(fullWeb.wid);
    }
    if (isWebPane(saved.detached)) {
      detachedWeb = saved.detached;
      bumpWebSeq(detachedWeb.wid);
    }
    if (!(saved.n > 1)) {
      if (fullWeb || detachedWeb) layoutSplit();
      return null;
    }
    splitCount = Math.min(4, Math.max(2, saved.n));
    panes = (saved.panes || []).slice(0, splitCount).map(v => {
      if (isWebPane(v)) { bumpWebSeq(v.wid); return v; }
      return (v && state.terms.has(v)) ? v : undefined;
    });
    focusedPane = Math.min(saved.focused || 0, splitCount - 1);
    layoutSplit();
    const sessionPanes = panes.filter(x => x && !isWebPane(x));
    if (!sessionPanes.includes(state.active)) return sessionPanes[0] || null;
    return null;
  } catch { return null; }
}

function wrapOf(id) { return state.terms.get(id)?.el || null; }

function clearPaneStyles() {
  for (const [, entry] of state.terms) {
    const el = entry.el;
    if (!el) continue;
    el.style.visibility = '';
    el.style.left = '';
    el.style.right = '';
    el.style.top = '';
    el.style.bottom = '';
    el.style.zIndex = '';
    el.style.outline = '';
    el.style.outlineOffset = '';
  }
  document.querySelectorAll('.split-placeholder, .split-label').forEach(el => el.remove());
  for (const [wid, el] of webPanes) {
    if (detachedWeb && wid === detachedWeb.wid) continue; // managed by layoutDetached
    el.style.display = 'none';
  }
}

// Pane geometry: up to 3 = columns, 4 = 2x2 grid.
function paneRect(i, n) {
  if (n === 4) {
    const row = Math.floor(i / 2), col = i % 2;
    return {
      left: col === 0 ? '4px' : 'calc(50% + 2px)',
      right: col === 1 ? '4px' : 'calc(50% + 2px)',
      top: row === 0 ? '4px' : 'calc(50% + 2px)',
      bottom: row === 1 ? '0' : 'calc(50% + 2px)',
    };
  }
  return {
    left: `calc(${(i * 100) / n}% + 4px)`,
    right: `calc(${((n - 1 - i) * 100) / n}% + 4px)`,
    top: '4px',
    bottom: '0',
  };
}

function sessionName(id) {
  return document.querySelector(`.group[data-id="${id}"] .name`)?.textContent || '';
}

// Badge centered at the pane's top edge; onClose frees the pane.
function makeBadge(i, r, kicker, title, onClose) {
  const centerX = splitCount === 4
    ? (i % 2 === 0 ? '25%' : '75%')
    : `${((i + 0.5) * 100) / splitCount}%`;
  const paneMax = splitCount === 4
    ? 'calc(50% - 48px)'
    : `calc(${100 / splitCount}% - 48px)`;
  const focused = i === focusedPane;
  const label = document.createElement('div');
  label.className = 'split-label absolute text-[12px] font-semibold select-none flex items-center gap-2';
  // z-index 30: above the floating plugin/split toolbars (z-10) so the ✕ stays clickable
  label.style.cssText = `z-index:30;top:calc(${r.top} + 6px);left:${centerX};transform:translateX(-50%);max-width:${paneMax};padding:3px 12px;border-radius:8px;`
    + (focused
      ? 'background:rgba(29,78,216,0.92);border:1px solid rgba(147,197,253,0.5);color:#ffffff;'
      : 'background:rgba(15,23,42,0.95);border:1px solid rgba(251,191,36,0.35);color:#fbbf24;')
    + 'box-shadow:0 2px 10px rgba(0,0,0,0.45);pointer-events:none;';
  const nameSpan = document.createElement('span');
  nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  if (kicker) {
    const kickerSpan = document.createElement('span');
    kickerSpan.textContent = kicker.toUpperCase() + ' · ';
    kickerSpan.style.cssText = 'font-size:10px;letter-spacing:0.05em;opacity:0.75;font-weight:600;';
    nameSpan.appendChild(kickerSpan);
  }
  nameSpan.appendChild(document.createTextNode(title));
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close pane';
  closeBtn.style.cssText = 'pointer-events:auto;display:flex;align-items:center;font-size:10px;opacity:0.65;color:inherit;';
  closeBtn.addEventListener('pointerenter', () => { closeBtn.style.opacity = '1'; });
  closeBtn.addEventListener('pointerleave', () => { closeBtn.style.opacity = '0.65'; });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); onClose(); });
  label.append(nameSpan, closeBtn);
  return label;
}

function paneOutline(el, i) {
  el.style.outline = i === focusedPane
    ? '1px solid rgba(59,130,246,0.55)'
    : '1px solid rgba(100,116,139,0.25)';
  el.style.outlineOffset = '-1px';
}

// Solo overlay: the chosen session's terminal covers the whole area (z 20),
// while the split stays intact underneath.
function layoutSolo() {
  if (!soloId) return;
  const entry = state.terms.get(soloId);
  if (!entry?.el) { soloId = null; return; }
  const el = entry.el;
  el.style.visibility = 'visible';
  el.style.left = '4px';
  el.style.right = '4px';
  el.style.top = '4px';
  el.style.bottom = '0';
  el.style.zIndex = '20';
  el.style.outline = '1px solid rgba(59,130,246,0.55)';
  el.style.outlineOffset = '-1px';

  const label = document.createElement('div');
  label.className = 'split-label absolute text-[12px] font-semibold select-none flex items-center gap-2';
  label.style.cssText = 'z-index:30;top:10px;left:50%;transform:translateX(-50%);max-width:50%;padding:3px 12px;border-radius:8px;'
    + 'background:rgba(29,78,216,0.92);border:1px solid rgba(147,197,253,0.5);color:#ffffff;'
    + 'box-shadow:0 2px 10px rgba(0,0,0,0.45);pointer-events:none;';
  const nameSpan = document.createElement('span');
  nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  const kicker = document.createElement('span');
  kicker.textContent = 'SOLO · ';
  kicker.style.cssText = 'font-size:10px;letter-spacing:0.05em;opacity:0.75;font-weight:600;';
  nameSpan.append(kicker, document.createTextNode(sessionName(soloId)));
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.title = 'Back to split';
  closeBtn.style.cssText = 'pointer-events:auto;display:flex;align-items:center;font-size:10px;opacity:0.65;color:inherit;';
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeSolo(); });
  label.append(nameSpan, closeBtn);
  document.getElementById('terminals').appendChild(label);
}

export function openSolo(id) {
  if (!isSplitActive() || !state.terms.has(id)) return;
  soloId = id;
  layoutSplit();
}

function closeSolo() {
  const closed = soloId;
  soloId = null;
  layoutSplit();
  // Hand keyboard focus back to a visible pane if the solo session isn't in one
  if (state.active === closed && !panes.includes(closed)) {
    const other = panes.find(x => x && !isWebPane(x));
    if (other) document.getElementById('session-list').dispatchEvent(
      new CustomEvent('split-focus', { detail: { id: other } })
    );
  }
}

// The detached browser overlay: full main area, above split panes and toolbars.
function layoutDetached() {
  if (!detachedWeb) return;
  const el = buildWebPane(detachedWeb);
  if (detachedWeb.min) { el.style.display = 'none'; return; }
  el.style.display = 'flex';
  el.style.left = '4px';
  el.style.right = '4px';
  el.style.top = '4px';
  el.style.bottom = '0';
  el.style.outline = '';
  el.style.zIndex = '40';
  el.querySelector('.web-close').style.display = '';
  el.querySelector('.web-bar').style.paddingRight = '';
}

function layoutFullWeb() {
  if (!fullWeb || fullWeb.min) return;
  const el = buildWebPane(fullWeb);
  el.style.display = 'flex';
  el.style.left = '4px';
  el.style.right = '4px';
  el.style.top = '4px';
  el.style.bottom = '0';
  el.style.outline = '';
  el.style.zIndex = '6';
  el.querySelector('.web-close').style.display = '';
  // Keep the bar's buttons clear of the floating top-right overlays (split toolbar,
  // plugin toolbar) — measure their leftmost edge instead of hardcoding widths.
  const overlays = ['split-toolbar', 'plugin-toolbar']
    .map(oid => document.getElementById(oid))
    .filter(t => t && t.children.length && t.offsetParent !== null)
    .map(t => t.getBoundingClientRect().left);
  const rightEdge = el.getBoundingClientRect().right;
  const pad = overlays.length ? Math.max(0, rightEdge - Math.min(...overlays) + 10) : 0;
  el.querySelector('.web-bar').style.paddingRight = pad + 'px';
}

function layoutSplit() {
  clearPaneStyles();
  if (!isSplitActive()) { layoutFullWeb(); layoutDetached(); renderButtons(); persist(); return; }

  // While split, terminals outside the panes must stay hidden even if they carry
  // the .active class (e.g. the active session's pane was just closed).
  for (const [id, entry] of state.terms) {
    if (entry.el && id !== soloId && !panes.slice(0, splitCount).includes(id)) entry.el.style.visibility = 'hidden';
  }

  const terminals = document.getElementById('terminals');
  for (let i = 0; i < splitCount; i++) {
    const v = panes[i];
    const r = paneRect(i, splitCount);

    if (isWebPane(v)) {
      const el = buildWebPane(v);
      el.style.display = 'flex';
      el.style.left = r.left;
      el.style.right = r.right;
      el.style.top = r.top;
      el.style.bottom = r.bottom;
      el.style.zIndex = '5';
      el.querySelector('.web-close').style.display = 'none';
      el.querySelector('.web-bar').style.paddingRight = '';
      paneOutline(el, i);
      el.onpointerdown = () => { if (focusedPane !== i) { focusedPane = i; layoutSplit(); } };
      let host = 'Browser';
      try { if (v.web) host = new URL(v.web).host; } catch { /* keep default */ }
      terminals.appendChild(makeBadge(i, r, 'web', host, () => {
        destroyWebPane(v);
        panes[i] = undefined;
        focusedPane = i;
        layoutSplit();
      }));
      continue;
    }

    const el = v ? wrapOf(v) : null;
    if (el) {
      el.style.visibility = 'visible';
      el.style.left = r.left;
      el.style.right = r.right;
      el.style.top = r.top;
      el.style.bottom = r.bottom;
      paneOutline(el, i);
      const entry = state.terms.get(v);
      const projName = (state.cfg.projects || []).find(p => p.id === entry?.projectId)?.name || '';
      terminals.appendChild(makeBadge(i, r, projName, sessionName(v), () => {
        const closedId = panes[i];
        panes[i] = undefined;
        focusedPane = i; // freed pane awaits the next sidebar click
        layoutSplit();
        // Don't leave keyboard input on a now-hidden session
        if (state.active === closedId) {
          const other = panes.find(x => x && !isWebPane(x));
          if (other) document.getElementById('session-list').dispatchEvent(
            new CustomEvent('split-focus', { detail: { id: other } })
          );
        }
      }));
    } else {
      const ph = document.createElement('div');
      ph.className = 'split-placeholder absolute flex items-center justify-center text-xs text-slate-600 select-none';
      ph.style.cssText = `top:${r.top};bottom:${r.bottom};left:${r.left};right:${r.right};outline:1px dashed rgba(100,116,139,0.35);outline-offset:-1px;pointer-events:auto;`;
      ph.dataset.pane = i;
      ph.textContent = 'Click a session in the sidebar';
      ph.addEventListener('click', () => { focusedPane = i; layoutSplit(); });
      terminals.appendChild(ph);
    }
  }
  layoutSolo();
  layoutDetached();
  renderButtons();
  persist();
}

// Re-render the pane name badges (e.g. after a session rename)
export function refreshSplitLabels() {
  if (isSplitActive()) layoutSplit();
}

// Called by select() in terminals.js whenever a session is picked in the sidebar.
// Returns the id whose pane got focused (the caller proceeds with normal select).
export function assignToPane(id) {
  // While a solo view is open, sidebar clicks switch the solo session instead
  if (soloId) {
    if (state.terms.has(id)) { soloId = id; layoutSplit(); }
    return;
  }
  if (!isSplitActive()) return;
  const existing = panes.indexOf(id);
  if (existing >= 0 && existing < splitCount) {
    focusedPane = existing;
  } else {
    // Prefer the first empty pane, otherwise replace the focused one
    let target = -1;
    for (let i = 0; i < splitCount; i++) if (!panes[i]) { target = i; break; }
    if (target < 0) target = focusedPane;
    if (isWebPane(panes[target])) destroyWebPane(panes[target]);
    panes[target] = id;
    focusedPane = target;
    // Auto-advance focus to the next empty pane (blue outline = "next click lands
    // here") so consecutive sidebar clicks fill the split left to right.
    for (let i = 0; i < splitCount; i++) if (!panes[i]) { focusedPane = i; break; }
  }
  layoutSplit();
}

export function removeFromPanes(id) {
  const wasSolo = soloId === id;
  if (wasSolo) soloId = null;
  const idx = panes.indexOf(id);
  if (idx >= 0) panes[idx] = undefined;
  if ((wasSolo || idx >= 0) && isSplitActive()) layoutSplit();
}

function setSplit(n) {
  soloId = null; // changing the layout ends any solo peek
  if (n === 1) {
    // Leaving split: the focused web pane survives as fullscreen browser view
    const keepWeb = isWebPane(panes[focusedPane]) ? panes[focusedPane] : null;
    for (const v of panes) if (isWebPane(v) && v !== keepWeb) destroyWebPane(v);
    if (keepWeb && !fullWeb) fullWeb = keepWeb;
    else if (keepWeb) destroyWebPane(keepWeb);
    splitCount = 1;
    focusedPane = 0;
    panes = [];
    layoutSplit(); // single-mode path renders fullWeb and persists
    return;
  }

  // Entering or resizing split: drop panes beyond n (destroying their web views)
  for (const v of panes.slice(n)) if (isWebPane(v)) destroyWebPane(v);
  panes = panes.slice(0, n);
  splitCount = n;
  focusedPane = 0;
  if (!panes[0] && state.active) panes[0] = state.active;
  // A fullscreen browser view moves into the first free pane
  if (fullWeb) {
    let slot = -1;
    for (let i = 0; i < n; i++) if (!panes[i]) { slot = i; break; }
    if (slot >= 0) panes[slot] = fullWeb;
    else destroyWebPane(fullWeb);
    fullWeb = null;
  }
  // Focus the first empty pane so the next sidebar click fills it
  for (let i = 0; i < n; i++) if (!panes[i]) { focusedPane = i; break; }
  layoutSplit();
}

function focusWebInput(p) {
  webPanes.get(p.wid)?.querySelector('input')?.focus();
}

function addWebPane() {
  if (!isSplitActive()) {
    if (!fullWeb) fullWeb = { web: '', wid: 'w' + (webSeq++) };
    fullWeb.min = false;
    layoutSplit();
    focusWebInput(fullWeb);
    return;
  }
  let target = -1;
  for (let i = 0; i < splitCount; i++) if (!panes[i]) { target = i; break; }
  if (target < 0) target = focusedPane;
  if (isWebPane(panes[target])) {
    focusedPane = target;
    layoutSplit();
    focusWebInput(panes[target]);
    return;
  }
  const p = { web: '', wid: 'w' + (webSeq++) };
  panes[target] = p;
  focusedPane = target;
  layoutSplit();
  focusWebInput(p);
}

const ICONS = {
  1: '<rect x="3" y="4" width="18" height="16" rx="2"/>',
  2: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/>',
  3: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/>',
  4: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="3" y1="12" x2="21" y2="12"/>',
};

function renderButtons() {
  document.querySelectorAll('#split-toolbar button[data-split]').forEach(btn => {
    const n = Number(btn.dataset.split);
    btn.style.color = n === splitCount ? '#60a5fa' : '';
  });
  const webBtn = document.getElementById('btn-web-pane');
  const webOn = (fullWeb && !fullWeb.min) || panes.some(isWebPane);
  if (webBtn) webBtn.style.color = webOn ? '#60a5fa' : '';
  const railBtn = document.getElementById('rail-browser');
  if (railBtn) railBtn.style.color = webOn ? '#60a5fa' : '';
  const detOn = detachedWeb && !detachedWeb.min;
  const detBtn = document.getElementById('rail-browser-detached');
  if (detBtn) detBtn.style.color = detOn ? '#60a5fa' : '';
  const termBtn = document.getElementById('rail-terminals');
  if (termBtn) termBtn.style.color = (!(fullWeb && !fullWeb.min) && !detOn) ? '#60a5fa' : '';
}

// Rail icon: toggle the browser view on/off (URL survives while toggled off)
function toggleFullWeb() {
  if (isSplitActive()) { addWebPane(); return; }
  if (!fullWeb) fullWeb = { web: '', wid: 'w' + (webSeq++) };
  else fullWeb.min = !fullWeb.min;
  layoutSplit();
  if (fullWeb && !fullWeb.min) focusWebInput(fullWeb);
}

// Terminal rail icon: hide any browser overlay and return to the terminal view
function showTerminals() {
  if (fullWeb && !fullWeb.min) fullWeb.min = true;
  if (detachedWeb && !detachedWeb.min) detachedWeb.min = true;
  layoutSplit(); // re-renders with overlays hidden, persists, updates buttons
  // Let the app take you to your work: sessions panel, Favorites tab
  document.getElementById('session-list').dispatchEvent(new CustomEvent('terminals-view'));
}

// Second rail icon: the detached fullscreen browser, decoupled from splits
function toggleDetached() {
  if (!detachedWeb) detachedWeb = { web: '', wid: 'w' + (webSeq++) };
  else detachedWeb.min = !detachedWeb.min;
  layoutDetached();
  renderButtons();
  persist();
  if (!detachedWeb.min) focusWebInput(detachedWeb);
}

export function initSplit() {
  const main = document.getElementById('main');
  const bar = document.createElement('div');
  bar.id = 'split-toolbar';
  bar.className = 'absolute z-10 flex gap-1';
  bar.style.cssText = 'top:8px;right:12px;';
  bar.innerHTML = [1, 2, 3, 4].map(n => `
    <button data-split="${n}" title="${n === 1 ? 'Single view' : n === 4 ? '4 terminals in a 2x2 grid' : n + ' terminals side by side'}"
      class="flex items-center justify-center w-7 h-7 rounded-md bg-slate-800/80 border border-slate-700 text-slate-500 hover:text-slate-200 transition-colors">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">${ICONS[n]}</svg>
    </button>`).join('');
  const webBtn = document.createElement('button');
  webBtn.id = 'btn-web-pane';
  webBtn.title = 'Browser view (fullscreen, or into a split pane)';
  webBtn.className = 'flex items-center justify-center w-7 h-7 rounded-md bg-slate-800/80 border border-slate-700 text-slate-500 hover:text-slate-200 transition-colors';
  webBtn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  bar.appendChild(webBtn);
  main.appendChild(bar);
  // Shift the plugin toolbar left so both fit (runtime tweak, no upstream HTML diff)
  const pluginBar = document.getElementById('plugin-toolbar');
  if (pluginBar) pluginBar.style.right = '184px';

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-split]');
    if (btn) setSplit(Number(btn.dataset.split));
  });
  webBtn.addEventListener('click', addWebPane);

  // Browser view as its own icon in the left rail — independent of terminals
  const railBtn = document.createElement('button');
  railBtn.id = 'rail-browser';
  railBtn.className = 'rail-btn w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-colors';
  railBtn.title = 'Browser view';
  railBtn.innerHTML = '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>';
  const railSpacer = document.querySelector('#nav-rail .flex-1');

  // Terminal view icon — always brings you back from any browser overlay
  const termBtn = document.createElement('button');
  termBtn.id = 'rail-terminals';
  termBtn.className = 'rail-btn w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-colors';
  termBtn.title = 'Terminal view';
  termBtn.innerHTML = '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 9l3 3-3 3"/><path d="M12 15h5"/></svg>';
  if (railSpacer) railSpacer.parentNode.insertBefore(termBtn, railSpacer);
  // No stopPropagation: bubbling to the rail re-opens a collapsed sidebar
  termBtn.addEventListener('click', () => showTerminals());

  if (railSpacer) railSpacer.parentNode.insertBefore(railBtn, railSpacer);
  railBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFullWeb(); });

  // Second icon: detached fullscreen browser (its own window, ignores splits)
  const detBtn = document.createElement('button');
  detBtn.id = 'rail-browser-detached';
  detBtn.className = 'rail-btn w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 transition-colors';
  detBtn.title = 'Detached browser (fullscreen window)';
  detBtn.innerHTML = '<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20"/><circle cx="5.5" cy="6.5" r="0.5" fill="currentColor"/><circle cx="8" cy="6.5" r="0.5" fill="currentColor"/></svg>';
  if (railSpacer) railSpacer.parentNode.insertBefore(detBtn, railSpacer);
  detBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleDetached(); });

  // Clicking inside a visible pane focuses it (and makes its session active)
  document.getElementById('terminals').addEventListener('pointerdown', (e) => {
    if (!isSplitActive()) return;
    const wrap = e.target.closest('.term-wrap');
    if (!wrap) return;
    for (let i = 0; i < splitCount; i++) {
      if (panes[i] && wrapOf(panes[i]) === wrap) {
        focusedPane = i;
        layoutSplit();
        document.getElementById('session-list').dispatchEvent(
          new CustomEvent('split-focus', { detail: { id: panes[i] } })
        );
        break;
      }
    }
  }, true);

  renderButtons();
}
