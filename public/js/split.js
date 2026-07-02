import { state } from './state.js';

// Split view: show 1-3 terminals side by side. Pure frontend — pane geometry is
// applied as inline styles on the .term-wrap elements; each terminal's own
// ResizeObserver handles refitting and PTY resize automatically.

let splitCount = 1;
let panes = [];        // session ids, index = pane position (left to right)
let focusedPane = 0;

export function isSplitActive() { return splitCount > 1; }
export function isInSplit(id) { return isSplitActive() && panes.includes(id); }

function wrapOf(id) { return state.terms.get(id)?.el || null; }

function clearPaneStyles() {
  for (const [, entry] of state.terms) {
    const el = entry.el;
    if (!el) continue;
    el.style.visibility = '';
    el.style.left = '';
    el.style.right = '';
    el.style.outline = '';
    el.style.outlineOffset = '';
  }
  document.querySelectorAll('.split-placeholder').forEach(el => el.remove());
}

function layoutSplit() {
  clearPaneStyles();
  if (!isSplitActive()) return;

  const terminals = document.getElementById('terminals');
  for (let i = 0; i < splitCount; i++) {
    const id = panes[i];
    const leftPct = (i * 100) / splitCount;
    const rightPct = ((splitCount - 1 - i) * 100) / splitCount;
    const left = `calc(${leftPct}% + 4px)`;
    const right = `calc(${rightPct}% + 4px)`;
    const el = id ? wrapOf(id) : null;
    if (el) {
      el.style.visibility = 'visible';
      el.style.left = left;
      el.style.right = right;
      el.style.outline = i === focusedPane
        ? '1px solid rgba(59,130,246,0.55)'
        : '1px solid rgba(100,116,139,0.25)';
      el.style.outlineOffset = '-1px';
    } else {
      const ph = document.createElement('div');
      ph.className = 'split-placeholder absolute flex items-center justify-center text-xs text-slate-600 select-none';
      ph.style.cssText = `top:4px;bottom:0;left:${left};right:${right};outline:1px dashed rgba(100,116,139,0.35);outline-offset:-1px;pointer-events:auto;`;
      ph.dataset.pane = i;
      ph.textContent = 'Click a session in the sidebar';
      ph.addEventListener('click', () => { focusedPane = i; layoutSplit(); });
      terminals.appendChild(ph);
    }
  }
  renderButtons();
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
  bar.innerHTML = [1, 2, 3].map(n => `
    <button data-split="${n}" title="${n === 1 ? 'Single view' : n + ' terminals side by side'}"
      class="flex items-center justify-center w-7 h-7 rounded-md bg-slate-800/80 border border-slate-700 text-slate-500 hover:text-slate-200 transition-colors">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">${ICONS[n]}</svg>
    </button>`).join('');
  main.appendChild(bar);
  // Shift the plugin toolbar left so both fit (runtime tweak, no upstream HTML diff)
  const pluginBar = document.getElementById('plugin-toolbar');
  if (pluginBar) pluginBar.style.right = '116px';

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
