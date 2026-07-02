// Collapsible sidebar: toggle button in the top-right toolbar (desktop).
// Terminals refit automatically via their ResizeObservers when the main area grows.

const KEY = 'clideck.sidebarCollapsed';
let collapsed = false;

function apply() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  sb.style.display = collapsed ? 'none' : '';
  const btn = document.getElementById('btn-sidebar-toggle');
  if (btn) {
    btn.style.color = collapsed ? '#60a5fa' : '';
    btn.title = collapsed ? 'Show sidebar' : 'Hide sidebar';
  }
  localStorage.setItem(KEY, collapsed ? '1' : '0');
}

export function initSidebarToggle() {
  const bar = document.getElementById('split-toolbar');
  if (!bar) return;
  const btn = document.createElement('button');
  btn.id = 'btn-sidebar-toggle';
  btn.className = 'flex items-center justify-center w-7 h-7 rounded-md bg-slate-800/80 border border-slate-700 text-slate-500 hover:text-slate-200 transition-colors';
  btn.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/></svg>';
  btn.title = 'Hide sidebar';
  bar.insertBefore(btn, bar.firstChild);
  // Make room: sidebar toggle + 4 split buttons + browser button live in the toolbar
  const pluginBar = document.getElementById('plugin-toolbar');
  if (pluginBar) pluginBar.style.right = '220px';

  btn.addEventListener('click', () => { collapsed = !collapsed; apply(); });

  // Clicking a nav-rail item while collapsed re-opens the sidebar
  document.getElementById('nav-rail')?.addEventListener('click', () => {
    if (collapsed) { collapsed = false; apply(); }
  });

  collapsed = localStorage.getItem(KEY) === '1';
  if (collapsed) apply();
}

// --- Drag-resize on the sidebar's right edge ---

const WIDTH_KEY = 'clideck.sidebarWidth';
const MIN_W = 220, MAX_W = 640, DEFAULT_W = 354;

function setWidth(sb, w) {
  sb.style.width = w + 'px';
  sb.style.minWidth = w + 'px';
}

export function initSidebarResize() {
  const sb = document.getElementById('sidebar');
  if (!sb) return;
  sb.style.position = 'relative';

  const saved = parseInt(localStorage.getItem(WIDTH_KEY), 10);
  if (saved >= MIN_W && saved <= MAX_W) setWidth(sb, saved);

  const handle = document.createElement('div');
  handle.id = 'sidebar-resize-handle';
  handle.title = 'Drag to resize — double-click to reset';
  handle.style.cssText = 'position:absolute;top:0;bottom:0;right:-3px;width:6px;cursor:col-resize;z-index:30;transition:background 120ms;';
  sb.appendChild(handle);

  let dragging = false, startX = 0, startW = 0;
  const highlight = (on) => { handle.style.background = on ? 'rgba(59,130,246,0.4)' : ''; };

  handle.addEventListener('pointerenter', () => highlight(true));
  handle.addEventListener('pointerleave', () => { if (!dragging) highlight(false); });
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    startX = e.clientX;
    startW = sb.getBoundingClientRect().width;
    handle.setPointerCapture(e.pointerId);
    highlight(true);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    setWidth(sb, Math.min(MAX_W, Math.max(MIN_W, startW + (e.clientX - startX))));
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    highlight(false);
    localStorage.setItem(WIDTH_KEY, String(Math.round(sb.getBoundingClientRect().width)));
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
  handle.addEventListener('dblclick', () => {
    setWidth(sb, DEFAULT_W);
    localStorage.setItem(WIDTH_KEY, String(DEFAULT_W));
  });
}
