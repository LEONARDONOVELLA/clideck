import { send } from './state.js';
import { confirmClose } from './confirm.js';
import { showToast } from './toast.js';

let active = false;
const selected = new Set();

export function isSelectionActive() { return active; }
export function getSelectedIds() { return [...selected]; }

function rowId(row) { return row.dataset.id || row.dataset.resumableId; }
function allRows() { return document.querySelectorAll('.group[data-id], [data-resumable-id]'); }

function renderBar() {
  document.getElementById('selection-count').textContent = `${selected.size} selected`;
  document.getElementById('selection-delete').style.opacity = selected.size ? '' : '0.4';
  document.getElementById('selection-hide').style.opacity = selected.size ? '' : '0.4';
}

function paintRow(row) {
  const on = selected.has(rowId(row));
  row.style.outline = on ? '1px solid rgba(59,130,246,0.6)' : '';
  row.style.background = on ? 'rgba(59,130,246,0.08)' : '';
}

export function enterSelection() {
  active = true;
  selected.clear();
  allRows().forEach(paintRow);
  const bar = document.getElementById('selection-bar');
  bar.classList.remove('hidden');
  bar.classList.add('flex');
  document.getElementById('btn-select-mode').classList.add('text-blue-400');
  renderBar();
}

export function exitSelection() {
  active = false;
  selected.clear();
  allRows().forEach(paintRow);
  const bar = document.getElementById('selection-bar');
  bar.classList.add('hidden');
  bar.classList.remove('flex');
  document.getElementById('btn-select-mode').classList.remove('text-blue-400');
}

function toggleRow(row) {
  const id = rowId(row);
  if (!id) return;
  if (selected.has(id)) selected.delete(id); else selected.add(id);
  paintRow(row);
  renderBar();
}

export function initSelection() {
  document.getElementById('btn-select-mode').addEventListener('click', () => {
    active ? exitSelection() : enterSelection();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && active) { e.stopPropagation(); exitSelection(); }
  }, true);
  document.getElementById('selection-cancel').addEventListener('click', exitSelection);

  // Capture-phase click so selection preempts select()/resume handlers
  document.getElementById('session-list').addEventListener('click', (e) => {
    if (!active) return;
    const row = e.target.closest('.group[data-id], [data-resumable-id]');
    if (!row) return;
    e.stopPropagation();
    e.preventDefault();
    toggleRow(row);
  }, true);

  document.getElementById('selection-delete').addEventListener('click', async () => {
    if (!selected.size) return;
    const n = selected.size;
    const ok = await confirmClose(`Delete ${n} session${n > 1 ? 's' : ''}? Active terminals will be killed. (Conversation data stays on disk.)`, 'Delete');
    if (!ok) return;
    for (const id of selected) send({ type: 'close', id });
    showToast(`${n} session${n > 1 ? 's' : ''} deleted`, { duration: 2500 });
    exitSelection();
  });

  document.getElementById('selection-hide').addEventListener('click', () => {
    if (!selected.size) return;
    const n = selected.size;
    for (const id of selected) send({ type: 'session.hide', id, hidden: true });
    showToast(`${n} session${n > 1 ? 's' : ''} hidden`, { duration: 2500 });
    exitSelection();
  });
}
