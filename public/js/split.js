import { state } from './state.js';

// Split view: show 1-3 terminals side by side. Pure frontend — pane geometry is
// applied as inline styles on the .term-wrap elements; each terminal's own
// ResizeObserver handles refitting and PTY resize automatically.

let splitCount = 1;
let panes = [];        // session ids, index = pane position (left to right)
let focusedPane = 0;

const SPLIT_KEY = 'clideck.splitView';

export function isSplitActive() { return splitCount > 1; }
export function isInSplit(id) { return isSplitActive() && panes.includes(id); }

function persist() {
  if (splitCount > 1) {
    localStorage.setItem(SPLIT_KEY, JSON.stringify({ n: splitCount, panes: panes.slice(0, splitCount), focused: focusedPane }));
  } else {
    localStorage.removeItem(SPLIT_KEY);
  }
}

// Re-apply the persisted split after the initial session list has arrived.
// Returns a session id the caller should select (to align keyboard focus), or null.
export function restoreSplit() {
  if (isSplitActive()) return null; // live state wins (e.g. websocket reconnect)
  try {
    const saved = JSON.parse(localStorage.getItem(SPLIT_KEY) || 'null');
    if (!saved || !(saved.n > 1)) return null;
    splitCount = Math.min(4, Math.max(2, saved.n));
    panes = (saved.panes || []).slice(0, splitCount).map(id => (id && state.terms.has(id)) ? id : undefined);
    focusedPane = Math.min(saved.focused || 0, splitCount - 1);
    layoutSplit();
    if (!panes.includes(state.active)) return panes.find(Boolean) || null;
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
    el.style.outline = '';
    el.style.outlineOffset = '';
  }
  document.querySelectorAll('.split-placeholder, .split-label').forEach(el => el.remove());
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

function layoutSplit() {
  clearPaneStyles();
  if (!isSplitActive()) return;

  // While split, terminals outside the panes must stay hidden even if they carry
  // the .active class (e.g. the active session's pane was just closed).
  for (const [id, entry] of state.terms) {
    if (entry.el && !panes.slice(0, splitCount).includes(id)) entry.el.style.visibility = 'hidden';
  }

  const terminals = document.getElementById('terminals');
  for (let i = 0; i < splitCount; i++) {
    const id = panes[i];
    const r = paneRect(i, splitCount);
    const el = id ? wrapOf(id) : null;
    if (el) {
      el.style.visibility = 'visible';
      el.style.left = r.left;
      el.style.right = r.right;
      el.style.top = r.top;
      el.style.bottom = r.bottom;
      el.style.outline = i === focusedPane
        ? '1px solid rgba(59,130,246,0.55)'
        : '1px solid rgba(100,116,139,0.25)';
      el.style.outlineOffset = '-1px';

      // Name badge centered at the pane's top edge
      const centerX = splitCount === 4
        ? (i % 2 === 0 ? '25%' : '75%')
        : `${((i + 0.5) * 100) / splitCount}%`;
      const paneMax = splitCount === 4
        ? 'calc(50% - 48px)'
        : `calc(${100 / splitCount}% - 48px)`;
      const focused = i === focusedPane;
      const label = document.createElement('div');
      label.className = 'split-label absolute z-10 text-[12px] font-semibold select-none flex items-center gap-2';
      label.style.cssText = `top:calc(${r.top} + 6px);left:${centerX};transform:translateX(-50%);max-width:${paneMax};padding:3px 12px;border-radius:8px;`
        + (focused
          ? 'background:rgba(29,78,216,0.92);border:1px solid rgba(147,197,253,0.5);color:#ffffff;'
          : 'background:rgba(15,23,42,0.95);border:1px solid rgba(251,191,36,0.35);color:#fbbf24;')
        + 'box-shadow:0 2px 10px rgba(0,0,0,0.45);pointer-events:none;';
      const entry = state.terms.get(id);
      const projName = (state.cfg.projects || []).find(p => p.id === entry?.projectId)?.name;
      const nameSpan = document.createElement('span');
      nameSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      if (projName) {
        const projSpan = document.createElement('span');
        projSpan.textContent = projName.toUpperCase() + ' · ';
        projSpan.style.cssText = `font-size:10px;letter-spacing:0.05em;opacity:0.75;font-weight:600;`;
        nameSpan.appendChild(projSpan);
      }
      nameSpan.appendChild(document.createTextNode(sessionName(id)));
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.title = 'Close pane (session keeps running)';
      closeBtn.style.cssText = 'pointer-events:auto;display:flex;align-items:center;font-size:10px;opacity:0.65;color:inherit;';
      closeBtn.addEventListener('pointerenter', () => { closeBtn.style.opacity = '1'; });
      closeBtn.addEventListener('pointerleave', () => { closeBtn.style.opacity = '0.65'; });
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const closedId = panes[i];
        panes[i] = undefined;
        focusedPane = i; // freed pane awaits the next sidebar click
        layoutSplit();
        // Don't leave keyboard input on a now-hidden session
        if (state.active === closedId) {
          const other = panes.find(Boolean);
          if (other) document.getElementById('session-list').dispatchEvent(
            new CustomEvent('split-focus', { detail: { id: other } })
          );
        }
      });
      label.append(nameSpan, closeBtn);
      terminals.appendChild(label);
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
  if (!isSplitActive()) return;
  const existing = panes.indexOf(id);
  if (existing >= 0 && existing < splitCount) {
    focusedPane = existing;
  } else {
    // Prefer the first empty pane, otherwise replace the focused one
    let target = -1;
    for (let i = 0; i < splitCount; i++) if (!panes[i]) { target = i; break; }
    if (target < 0) target = focusedPane;
    panes[target] = id;
    focusedPane = target;
    // Auto-advance focus to the next empty pane (blue outline = "next click lands
    // here") so consecutive sidebar clicks fill the split left to right.
    for (let i = 0; i < splitCount; i++) if (!panes[i]) { focusedPane = i; break; }
  }
  layoutSplit();
}

export function removeFromPanes(id) {
  const idx = panes.indexOf(id);
  if (idx < 0) return;
  panes[idx] = undefined;
  if (isSplitActive()) layoutSplit();
}

function setSplit(n) {
  splitCount = n;
  focusedPane = 0;
  if (n === 1) {
    panes = [];
    clearPaneStyles();
    renderButtons();
    persist();
    return;
  }
  panes = panes.slice(0, n);
  if (!panes[0] && state.active) panes[0] = state.active;
  // Focus the first empty pane so the next sidebar click fills it
  for (let i = 0; i < n; i++) if (!panes[i]) { focusedPane = i; break; }
  layoutSplit();
}

const ICONS = {
  1: '<rect x="3" y="4" width="18" height="16" rx="2"/>',
  2: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/>',
  3: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/>',
  4: '<rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="3" y1="12" x2="21" y2="12"/>',
};

function renderButtons() {
  document.querySelectorAll('#split-toolbar button').forEach(btn => {
    const n = Number(btn.dataset.split);
    btn.style.color = n === splitCount ? '#60a5fa' : '';
  });
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
  main.appendChild(bar);
  // Shift the plugin toolbar left so both fit (runtime tweak, no upstream HTML diff)
  const pluginBar = document.getElementById('plugin-toolbar');
  if (pluginBar) pluginBar.style.right = '152px';

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-split]');
    if (btn) setSplit(Number(btn.dataset.split));
  });

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
