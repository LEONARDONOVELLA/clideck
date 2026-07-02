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
  // Make room: sidebar toggle + 4 split buttons now live in the toolbar
  const pluginBar = document.getElementById('plugin-toolbar');
  if (pluginBar) pluginBar.style.right = '188px';

  btn.addEventListener('click', () => { collapsed = !collapsed; apply(); });

  // Clicking a nav-rail item while collapsed re-opens the sidebar
  document.getElementById('nav-rail')?.addEventListener('click', () => {
    if (collapsed) { collapsed = false; apply(); }
  });

  collapsed = localStorage.getItem(KEY) === '1';
  if (collapsed) apply();
}
