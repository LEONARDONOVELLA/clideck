# CliDeck UX Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Leonardo's CliDeck fork (base v1.31.23) as the production dashboard and add five sidebar UX features: alphabetical project sort, pinnable projects with manual drag order, quick-delete X, multi-select bulk actions, and hideable sessions — plus automated data backups and an upstream-update script.

**Architecture:** Fork of rustykuntz/clideck. `main` mirrors upstream exactly; every feature is its own branch off the current `leo` tip; `leo` is the running branch (systemd user service points at `~/clideck/server.js`). Frontend is vanilla ES modules in `public/js/` (no build step; Tailwind classes are pre-generated — reuse existing utility classes only). Backend is CommonJS Node (`server.js`, `handlers.js`, `sessions.js`). Client/server talk over one WebSocket with `{type: ...}` messages.

**Tech Stack:** Node.js 24 (nvm), node-pty, ws, xterm.js, vanilla JS, systemd user units, bash + rsync for ops scripts.

## Global Constraints

- Base: upstream tag `v1.31.23` (commit `a0a91af`). `main` never gets own commits.
- Working dir: `~/clideck`. Remotes: `origin` = LEONARDONOVELLA/clideck, `upstream` = rustykuntz/clideck.
- User data is sacred: nothing in this plan may write to, migrate, or delete `~/.clideck`, `~/.claude`, or `~/.codex` contents (reading is fine; the backup task only *copies* them). "Delete session" only ever removes CliDeck's own entry (pty kill + `sessions.json` entry) — never agent transcripts.
- Keep diffs small and additive (merge-friendly with upstream). No new npm dependencies. No file renames of upstream files.
- UI copy stays English (matches the app). Commit messages: short imperative subject, no body needed (repo style, e.g. "Add terminal jump to latest button").
- New Tailwind utility classes are NOT available (prebuilt CSS). Only reuse class strings that already appear in `public/index.html` / existing JS templates, or use inline `style=`.
- Unit tests: plain `node --test` files under `tests/unit/` (new dir; `.test.mjs` for ESM imports of `public/js/*`, `.test.js` for CJS requires). Run with `node --test tests/unit/`.
- After merging a feature into `leo`: `systemctl --user restart clideck` and verify in the real UI at http://localhost:4000. **Warning to surface to Leonardo before the first restart of a work session: restarting turns active sessions into dormant "Resume" entries (normal CliDeck behavior).** Batch restarts where possible.
- Config compatibility: new fields (`sortProjectsAlphabetically`, `pinned`, `pinOrder`, `hidden`) must be optional — absent field = current upstream behavior, except `sortProjectsAlphabetically` where absent = **enabled** (Leonardo's default).

---

### Task 1: Run the fork as the production service

> **EXECUTION DEVIATION (2026-07-02):** The executing session runs *inside* clideck.service (verified via `/proc/$$/cgroup`) — a service restart kills it mid-work. Therefore: steps 1-3 run now; steps 4-6 (unit switch + restart + live verify) move to the very END (after Task 9 verification), executed as the session's final action. Feature verification during Tasks 2-8 happens against a **sandbox instance** instead: `HOME=<scratch>/clideck-sandbox CLIDECK_PORT=4001 node server.js` (isolated data dir via os.homedir(); seeded test config; production `~/.clideck` untouched). Restart-per-feature merges into one final restart.

**Files:**
- Modify: `~/.config/systemd/user/clideck.service` (outside repo)
- Create: `docs/superpowers/specs/2026-07-02-clideck-fork-design.md` + this plan (commit both)

**Interfaces:**
- Produces: running CliDeck at http://localhost:4000 served from `~/clideck` on branch `leo`. All later tasks verify against this instance.

- [ ] **Step 1: Install dependencies (node-pty compiles natively)**

```bash
cd ~/clideck && npm ci
```
Expected: exits 0, `node_modules/node-pty/build/Release/pty.node` exists.

- [ ] **Step 2: Commit spec + plan on `leo`**

```bash
cd ~/clideck && git add docs/ && git commit -m "Add fork design spec and implementation plan"
```

- [ ] **Step 3: Verify the server boots from the fork (service still running → single-instance lock must refuse)**

```bash
cd ~/clideck && timeout 10 node server.js; echo "exit: $?"
```
Expected: refuses to start (single-instance lock held by the running npm-package service — output mentions the lock/port) OR if it prints a port conflict, that's equally fine. This proves deps load. If it *boots cleanly*, the service was not running — check `systemctl --user status clideck`.

- [ ] **Step 4: Switch systemd unit to the fork**

Edit `~/.config/systemd/user/clideck.service`, replace the ExecStart line:

```ini
ExecStart=/home/leonardo/.nvm/versions/node/v24.12.0/bin/node /home/leonardo/clideck/server.js
```
(keep everything else). Then:

```bash
systemctl --user daemon-reload && systemctl --user restart clideck && sleep 3 && curl -sf -o /dev/null -w '%{http_code}\n' http://localhost:4000
```
Expected: `200`.

- [ ] **Step 5: Verify data integrity in the UI**

```bash
tail -20 ~/.clideck/clideck.log
```
Expected: log shows `Loaded <n> resumable session(s)` with n ≈ 139, no stack traces. In the browser (http://localhost:4000): all 22 projects visible, sessions listed, Unread tab works. **Rollback if broken:** revert ExecStart to `/home/leonardo/.nvm/versions/node/v24.12.0/bin/clideck`, daemon-reload, restart.

- [ ] **Step 6: Verify the v1.31.20 unread fix (Leonardo's original complaint)**

In the UI: with ≥2 unread sessions, switch to the Unread tab, click one. Expected: tab stays on Unread while other unread sessions remain; only clicking the *last* unread one returns to All.

---

### Task 2: Port the July-1 session-ID hotfix

**Files:**
- Modify: `claude-session.js:6-8`
- Test: `tests/unit/claude-session-guard.test.js`
- Reference: original hotfix in `~/.clideck/rescue-backups/20260701-225008/` and the live-patched `/home/leonardo/.nvm/versions/node/v24.12.0/lib/node_modules/clideck/claude-session.js`

**Interfaces:**
- Consumes: `updateClaudeSessionToken(sess, token, clideckId, options)` (CJS export of `claude-session.js`)
- Produces: same signature; new behavior: an already-captured token is never overwritten unless `options.replace === true`.

- [ ] **Step 1: Branch off leo**

```bash
cd ~/clideck && git checkout leo && git checkout -b fix/claude-session-id-guard
```

- [ ] **Step 2: Write the failing test**

`tests/unit/claude-session-guard.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { updateClaudeSessionToken } = require('../../claude-session.js');

const ID_A = '11111111-2222-3333-4444-555555555555';
const ID_B = '99999999-8888-7777-6666-555555555555';

test('first token is captured', () => {
  const sess = { presetId: 'claude-code', sessionToken: undefined };
  assert.strictEqual(updateClaudeSessionToken(sess, ID_A, 'clideck01'), true);
  assert.strictEqual(sess.sessionToken, ID_A);
});

test('a different token does NOT replace an existing one', () => {
  const sess = { presetId: 'claude-code', sessionToken: ID_A };
  assert.strictEqual(updateClaudeSessionToken(sess, ID_B, 'clideck01'), false);
  assert.strictEqual(sess.sessionToken, ID_A);
});

test('options.replace=true allows replacement', () => {
  const sess = { presetId: 'claude-code', sessionToken: ID_A };
  assert.strictEqual(updateClaudeSessionToken(sess, ID_B, 'clideck01', { replace: true }), true);
  assert.strictEqual(sess.sessionToken, ID_B);
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd ~/clideck && node --test tests/unit/claude-session-guard.test.js
```
Expected: FAIL — test 2 fails (upstream replaces the token and returns true).

- [ ] **Step 4: Apply the guard**

In `claude-session.js`, after `const prev = sess.sessionToken;` (before `sess.sessionToken = next;`) insert:

```js
  if (prev && prev !== next && options.replace !== true) {
    const label = options.label || 'Claude';
    const source = options.source ? ` via ${options.source}` : '';
    console.log(`${label}: ignored Claude session ID change for ${clideckId.slice(0, 8)}${source}: keeping ${prev.slice(0, 12)}..., ignored ${next.slice(0, 12)}...`);
    return false;
  }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd ~/clideck && node --test tests/unit/claude-session-guard.test.js
```
Expected: 3 pass. Also confirm no caller relies on replacement: `grep -rn 'updateClaudeSessionToken' --include='*.js' . | grep -v node_modules | grep -v tests` — expected: no call site passes `replace:`; known tradeoff (documented in spec): a genuinely new conversation in the same terminal keeps resuming the first one. That is the rescue-fix behavior Leonardo already runs.

- [ ] **Step 6: Commit and merge into leo**

```bash
git add claude-session.js tests/unit/claude-session-guard.test.js
git commit -m "Keep first captured Claude session ID unless replace is requested"
git checkout leo && git merge --no-ff fix/claude-session-id-guard -m "Merge fix/claude-session-id-guard"
systemctl --user restart clideck
```

---

### Task 3: Alphabetical project sorting

**Files:**
- Create: `public/js/project-order.js`
- Test: `tests/unit/project-order.test.mjs`
- Modify: `public/js/terminals.js:1156-1158` (regroupSessions), `public/js/drag.js:22-24` (block drag), `public/index.html` (settings checkbox), `public/js/settings.js:86,626` (load/save toggle)

**Interfaces:**
- Produces: `sortProjectsForDisplay(projects, cfg)` (ESM export of `public/js/project-order.js`) — returns a **new array**; pinned projects first ordered by `pinOrder` ascending, then the rest alphabetical when `cfg.sortProjectsAlphabetically !== false`, else in given order. Also exports `isSortEnabled(cfg)` → boolean. Task 4 reuses both.

- [ ] **Step 1: Branch off leo**

```bash
cd ~/clideck && git checkout leo && git checkout -b feat/project-sort
```

- [ ] **Step 2: Write the failing test**

`tests/unit/project-order.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert';
import { sortProjectsForDisplay, isSortEnabled } from '../../public/js/project-order.js';

const P = (name, extra = {}) => ({ id: name.toLowerCase(), name, ...extra });

test('sorts alphabetically, case-insensitive and numeric-aware', () => {
  const input = [P('zebra'), P('Alpha'), P('v10'), P('v2')];
  const out = sortProjectsForDisplay(input, {});
  assert.deepStrictEqual(out.map(p => p.name), ['Alpha', 'v2', 'v10', 'zebra']);
});

test('sort disabled keeps config order', () => {
  const input = [P('zebra'), P('Alpha')];
  const out = sortProjectsForDisplay(input, { sortProjectsAlphabetically: false });
  assert.deepStrictEqual(out.map(p => p.name), ['zebra', 'Alpha']);
});

test('pinned projects come first, by pinOrder', () => {
  const input = [P('Alpha'), P('Mid', { pinned: true, pinOrder: 2 }), P('Zulu', { pinned: true, pinOrder: 1 })];
  const out = sortProjectsForDisplay(input, {});
  assert.deepStrictEqual(out.map(p => p.name), ['Zulu', 'Mid', 'Alpha']);
});

test('pinned first even when sort disabled', () => {
  const input = [P('zebra'), P('pin', { pinned: true, pinOrder: 1 })];
  const out = sortProjectsForDisplay(input, { sortProjectsAlphabetically: false });
  assert.deepStrictEqual(out.map(p => p.name), ['pin', 'zebra']);
});

test('does not mutate the input array', () => {
  const input = [P('b'), P('a')];
  sortProjectsForDisplay(input, {});
  assert.deepStrictEqual(input.map(p => p.name), ['b', 'a']);
});

test('isSortEnabled defaults to true', () => {
  assert.strictEqual(isSortEnabled({}), true);
  assert.strictEqual(isSortEnabled({ sortProjectsAlphabetically: false }), false);
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd ~/clideck && node --test tests/unit/project-order.test.mjs
```
Expected: FAIL — `Cannot find module '.../public/js/project-order.js'`.

- [ ] **Step 4: Implement `public/js/project-order.js`**

```js
// Display ordering for sidebar project groups. Pure module — no DOM, no state.
export function isSortEnabled(cfg) {
  return cfg?.sortProjectsAlphabetically !== false;
}

export function sortProjectsForDisplay(projects, cfg) {
  const pinned = projects.filter(p => p.pinned);
  const rest = projects.filter(p => !p.pinned);
  pinned.sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0));
  if (isSortEnabled(cfg)) {
    rest.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true }));
  }
  return [...pinned, ...rest];
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd ~/clideck && node --test tests/unit/project-order.test.mjs
```
Expected: 6 pass.

- [ ] **Step 6: Use it in regroupSessions**

`public/js/terminals.js` — add to the import block at the top:
```js
import { sortProjectsForDisplay, isSortEnabled } from './project-order.js';
```
In `regroupSessions()` (line ~1158) change:
```js
  const projects = state.cfg.projects || [];
```
to:
```js
  const projects = sortProjectsForDisplay(state.cfg.projects || [], state.cfg);
```

- [ ] **Step 7: Block manual project drag while auto-sort is on (pinned drag comes in Task 4)**

`public/js/drag.js` — add to the import block: `import { isSortEnabled } from './project-order.js';`
In the `pointerdown` handler, inside `if (projHeader) {` before `if (document.querySelectorAll('.project-group').length <= 1) return;` insert:
```js
      const proj = (state.cfg.projects || []).find(p => p.id === projHeader.dataset.projectId);
      if (isSortEnabled(state.cfg) && !proj?.pinned) return; // alphabetical order is authoritative
```

- [ ] **Step 8: Settings toggle**

`public/index.html` — locate the General settings block containing `id="cfg-confirm-close"`; duplicate that whole labeled row directly below it, with id `cfg-sort-projects` and label text `Sort projects alphabetically` (keep the exact same classes as the confirm-close row).

`public/js/settings.js` — next to line 86 (`cfg-confirm-close` load) add:
```js
  document.getElementById('cfg-sort-projects').checked = state.cfg.sortProjectsAlphabetically !== false;
```
Next to line 626 (save) add:
```js
  state.cfg.sortProjectsAlphabetically = document.getElementById('cfg-sort-projects').checked;
```
Re-render after save is already covered: the `case 'config':` handler in `public/js/app.js:54-58` sets `state.cfg` and calls `regroupSessions()` — no change needed there.

- [ ] **Step 9: Verify in the real UI**

```bash
git checkout leo && git merge --no-ff feat/project-sort -m "Merge feat/project-sort" && systemctl --user restart clideck
```
In the browser: projects appear A→Z regardless of stored order; dragging a project header does nothing; Settings → toggle off → projects return to stored order and drag works again; toggle back on.

- [ ] **Step 10: Commit happened per change? Final check & push**

Commits on the branch before merge (steps 2-8 should have been committed as):
```bash
git add tests/unit/project-order.test.mjs public/js/project-order.js && git commit -m "Add project display-order module"
git add public/js/terminals.js public/js/drag.js && git commit -m "Sort sidebar projects alphabetically"
git add public/index.html public/js/settings.js && git commit -m "Add settings toggle for alphabetical project sort"
git push origin leo feat/project-sort
```

---

### Task 4: Pinnable projects with manual drag order

**Files:**
- Modify: `public/js/app.js:646-694` (project ⋮ menu), `public/js/terminals.js` (pin icon in project header, inside regroupSessions template), `public/js/drag.js` (pinned-zone reorder), `tests/unit/project-order.test.mjs` (already covers pinned ordering — extend with re-pin case)

**Interfaces:**
- Consumes: `sortProjectsForDisplay` / `isSortEnabled` from Task 3; existing `send({type:'config.update', config: state.cfg})` persistence; project objects `{id, name, path, color, collapsed}` gain optional `pinned: boolean`, `pinOrder: number`.
- Produces: pin state persisted in `~/.clideck/config.json` project entries.

- [ ] **Step 1: Branch off leo (needs Task 3 merged)**

```bash
cd ~/clideck && git checkout leo && git checkout -b feat/project-pin
```

- [ ] **Step 2: Extend the unit test (failing first)**

Append to `tests/unit/project-order.test.mjs`:
```js
test('newly pinned project (highest pinOrder) lands at the end of the pinned zone', () => {
  const input = [P('a', { pinned: true, pinOrder: 1 }), P('b', { pinned: true, pinOrder: 5 }), P('c')];
  const out = sortProjectsForDisplay(input, {});
  assert.deepStrictEqual(out.map(p => p.name), ['a', 'b', 'c']);
});
```
Run `node --test tests/unit/project-order.test.mjs` — expected: passes already (module from Task 3 handles it). If it passes, fine — this is a regression pin, not new logic.

- [ ] **Step 3: Add Pin/Unpin to the project menu**

`public/js/app.js` — in the project-menu HTML template (before the `data-action="rename"` button at line ~646) insert:
```js
    <button class="pm-action flex items-center gap-2 w-full px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors text-left" data-action="pin">
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76V7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3.76a2 2 0 0 0 .59 1.42L17 13.6a1 1 0 0 1 .3.7V16H6.7v-1.7a1 1 0 0 1 .3-.7l1.41-1.42A2 2 0 0 0 9 10.76Z"/></svg>
      ${proj?.pinned ? 'Unpin project' : 'Pin project'}
    </button>`
```
(`proj` is already in scope — the delete handler uses `proj?.name`.)

In the menu click handler (same block as `clear-dormant` / `delete` at ~line 687) add:
```js
    if (btn.dataset.action === 'pin') {
      const p = (state.cfg.projects || []).find(x => x.id === projectId);
      if (!p) return;
      if (p.pinned) { delete p.pinned; delete p.pinOrder; }
      else {
        p.pinned = true;
        p.pinOrder = Math.max(0, ...(state.cfg.projects || []).filter(x => x.pinned && x.id !== p.id).map(x => x.pinOrder ?? 0)) + 1;
      }
      send({ type: 'config.update', config: state.cfg });
      regroupSessions();
      return;
    }
```

- [ ] **Step 4: Pin icon in the project header**

`public/js/terminals.js`, in the `regroupSessions()` header template, directly after the color dot `<span class="w-2 h-2 rounded-full flex-shrink-0" ...></span>` line, add:
```js
        ${proj.pinned ? '<svg class="w-3 h-3 flex-shrink-0 text-slate-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17v5M9 10.76V7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3.76a2 2 0 0 0 .59 1.42L17 13.6a1 1 0 0 1 .3.7V16H6.7v-1.7a1 1 0 0 1 .3-.7l1.41-1.42A2 2 0 0 0 9 10.76Z"/></svg>' : ''}
```

- [ ] **Step 5: Drag inside the pinned zone reassigns pinOrder**

`public/js/drag.js`, in `endDrag()` replace the project-reorder branch:
```js
  } else if (ds.mode === 'project' && ds.dropTarget.type === 'reorder') {
    const projects = state.cfg.projects || [];
    const fromIdx = projects.findIndex(p => p.id === ds.projectId);
    if (fromIdx < 0) return;
    const dragged = projects[fromIdx];

    if (dragged.pinned) {
      // Reorder within the pinned zone using DISPLAY order, then rewrite pinOrder 1..n
      const display = sortProjectsForDisplay(projects, state.cfg);
      const pinnedDisplay = display.filter(p => p.pinned && p.id !== dragged.id);
      // insertBefore is a display index over ALL groups; clamp into the pinned zone
      const target = Math.min(ds.dropTarget.insertBefore, pinnedDisplay.length);
      pinnedDisplay.splice(target > pinnedDisplay.length ? pinnedDisplay.length : target, 0, dragged);
      pinnedDisplay.forEach((p, i) => { p.pinOrder = i + 1; });
      send({ type: 'config.update', config: state.cfg });
      regroupSessions();
      return;
    }

    const [moved] = projects.splice(fromIdx, 1);
    let toIdx = ds.dropTarget.insertBefore;
    if (toIdx > fromIdx) toIdx--;
    projects.splice(toIdx, 0, moved);
    send({ type: 'config.update', config: state.cfg });
    regroupSessions();
  }
```
Add to the drag.js import from Task 3: `import { isSortEnabled, sortProjectsForDisplay } from './project-order.js';`

Note the display/config index mismatch: `insertBefore` indexes rendered `.project-group` elements (display order). For the pinned branch this is correct because pinned groups render first. For the unpinned branch (sort OFF only, since sort ON blocks the drag) display order = config order except pinned floated up — acceptable known quirk when mixing pins with sort-off manual order; verify behavior manually in Step 6 and note anything odd for a follow-up.

- [ ] **Step 6: Merge, restart, verify in the UI**

```bash
git add public/js/app.js public/js/terminals.js public/js/drag.js tests/unit/project-order.test.mjs
git commit -m "Add pinnable projects with manual pin order"
git checkout leo && git merge --no-ff feat/project-pin -m "Merge feat/project-pin" && systemctl --user restart clideck
```
Verify: pin 2-3 projects via ⋮ → they jump to the top with pin icon; drag a pinned one within the pinned zone → order sticks after reload (F5) and after service restart (persisted `pinOrder` in `~/.clideck/config.json`); unpin returns the project to its alphabetical slot; `git push origin leo feat/project-pin`.

---

### Task 5: Quick-delete X on session rows

**Files:**
- Modify: `public/js/terminals.js:579-610` (active row template + handler), `buildResumableRow` (~line 1285) and its click wiring, `public/js/app.js:472-478` (reuse `session-delete` event)

**Interfaces:**
- Consumes: `confirmClose(message, confirmLabel)` from `./confirm.js` (already imported in app.js); existing `session-delete` CustomEvent → `send({type:'close', id})`. Server `close` verified to remove BOTH live ptys and dormant `sessions.json` entries (sessions.js:372-378).
- Produces: `.quick-delete-btn` on every session row (active + resumable).

- [ ] **Step 1: Branch off leo**

```bash
cd ~/clideck && git checkout leo && git checkout -b feat/quick-delete
```

- [ ] **Step 2: X button on active session rows**

`public/js/terminals.js`, in `addTerminal()` row template, directly after the `menu-btn` button element add:
```js
        <button class="quick-delete-btn opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 flex-shrink-0 transition-opacity pointer-events-auto" title="Delete session">
          <svg class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
```
Find where the row's click handling is wired (the same place `menu-btn` clicks are intercepted — search `menu-btn` usages near `addTerminal`); add equivalent handling:
```js
  item.querySelector('.quick-delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('session-list').dispatchEvent(
      new CustomEvent('session-delete', { detail: { id } })
    );
  });
```
The existing `session-delete` listener in app.js already confirms with `confirmClose()` — make its message explicit while there (app.js:472):
```js
sessionList.addEventListener('session-delete', async (e) => {
  const id = e.detail.id;
  const name = state.terms.get(id)?.name || document.querySelector(`.group[data-id="${id}"] .name`)?.textContent || 'this session';
  const ok = await confirmClose(`Delete session "${name}"? The terminal process will be killed.`, 'Delete');
  if (!ok) return;
  send({ type: 'close', id });
});
```
Check first whether `state.terms` entries carry `.name`; if not, keep only the DOM lookup.

- [ ] **Step 3: X button on dormant "Resume" rows**

In `buildResumableRow(s)`, after the `resume-btn` button add:
```js
        <button class="quick-delete-btn opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 flex-shrink-0 transition-opacity" title="Remove from list (conversation data stays on disk)">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
```
Resumable rows resume via a delegated click listener in `public/js/app.js` (~line 441: `const resumableRow = e.target.closest('[data-resumable-id]')` → `session.resume`). The whole row is the resume trigger, so the X must be intercepted **before** that block. In the same delegated handler, directly above the `// Resumable session click` block, insert:
```js
  // Quick-delete X on a resumable row — must come before the resume trigger
  const dormantDelBtn = e.target.closest('.quick-delete-btn');
  if (dormantDelBtn && dormantDelBtn.closest('[data-resumable-id]')) {
    const row = dormantDelBtn.closest('[data-resumable-id]');
    const name = row.querySelector('.resumable-name')?.textContent || 'this session';
    confirmClose(`Remove dormant session "${name}"? (Conversation data stays on disk.)`, 'Remove').then(ok => {
      if (ok) send({ type: 'close', id: row.dataset.resumableId });
    });
    return;
  }
```

- [ ] **Step 4: Merge, restart, verify**

```bash
git add public/js/terminals.js public/js/app.js
git commit -m "Add hover quick-delete button to session rows"
git checkout leo && git merge --no-ff feat/quick-delete -m "Merge feat/quick-delete" && systemctl --user restart clideck
```
Verify in UI: hover an active session → X appears → click → confirm dialog names the session → confirmed → row gone. Same for a dormant row (create a throwaway shell session first and let it go dormant via restart — do NOT test on a real work session). Cancel leaves everything untouched. `git push origin leo feat/quick-delete`.

---

### Task 6: Multi-select mode (bulk delete)

**Files:**
- Create: `public/js/selection.js`
- Modify: `public/index.html:244-252` (toolbar button + action bar), `public/js/app.js` (init + wire), `public/js/hotkeys.js` (Esc), `public/js/terminals.js` (row click guard)

**Interfaces:**
- Consumes: `confirmClose`, `send`, `state`; rows `.group[data-id]` (active) and `[data-resumable-id]` (dormant).
- Produces: `initSelection()`, `isSelectionActive()`, `exitSelection()`, `getSelectedIds()` (ESM exports of `public/js/selection.js`). Task 7 adds a Hide button to the same bar.

- [ ] **Step 1: Branch off leo**

```bash
cd ~/clideck && git checkout leo && git checkout -b feat/multi-select
```

- [ ] **Step 2: Toolbar button + selection bar markup**

`public/index.html` — inside the filter-tab flex container (line ~244, `<div class="flex bg-slate-800/30 rounded-lg p-[3px]">`), after the Unread button add:
```html
          <button id="btn-select-mode" class="flex-none text-[11px] font-medium py-[5px] px-2 rounded-md transition-all text-slate-500 hover:text-slate-400" title="Select multiple sessions">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/></svg>
          </button>
```
Directly after `<div id="session-list" ...></div>` add:
```html
      <div id="selection-bar" class="hidden items-center gap-2 px-2.5 py-2 border-t border-slate-700/50 text-xs">
        <span id="selection-count" class="text-slate-400 flex-1">0 selected</span>
        <button id="selection-delete" class="px-2 py-1 rounded-md text-red-400 hover:bg-slate-700 transition-colors font-medium">Delete</button>
        <button id="selection-cancel" class="px-2 py-1 rounded-md text-slate-400 hover:bg-slate-700 transition-colors">Cancel</button>
      </div>
```

- [ ] **Step 3: Implement `public/js/selection.js`**

```js
import { state, send } from './state.js';
import { confirmClose } from './confirm.js';

let active = false;
const selected = new Set();

export function isSelectionActive() { return active; }
export function getSelectedIds() { return [...selected]; }

function rowId(row) { return row.dataset.id || row.dataset.resumableId; }
function allRows() { return document.querySelectorAll('.group[data-id], [data-resumable-id]'); }

function renderBar() {
  document.getElementById('selection-count').textContent = `${selected.size} selected`;
  document.getElementById('selection-delete').style.opacity = selected.size ? '' : '0.4';
}

function paintRow(row) {
  const on = selected.has(rowId(row));
  row.style.outline = on ? '1px solid rgba(59,130,246,0.6)' : '';
  row.style.background = on ? 'rgba(59,130,246,0.08)' : '';
}

export function enterSelection() {
  active = true;
  selected.clear();
  const bar = document.getElementById('selection-bar');
  bar.classList.remove('hidden'); bar.classList.add('flex');
  document.getElementById('btn-select-mode').classList.add('text-blue-400');
  renderBar();
}

export function exitSelection() {
  active = false;
  selected.clear();
  allRows().forEach(paintRow);
  const bar = document.getElementById('selection-bar');
  bar.classList.add('hidden'); bar.classList.remove('flex');
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
}
```
Add `import { showToast } from './toast.js';` to the imports (export verified at `public/js/toast.js:29`).

- [ ] **Step 4: Wire it up**

`public/js/app.js` — add `import { initSelection, isSelectionActive, exitSelection } from './selection.js';` and call `initSelection();` next to the other init calls (search `initDrag()` for the spot).
`public/js/hotkeys.js` — in the existing keydown handler add early:
```js
  if (e.key === 'Escape' && isSelectionActive()) { exitSelection(); return; }
```
with the matching import. Check hotkeys.js's import style first and mirror it.

- [ ] **Step 5: Merge, restart, verify**

```bash
git add public/index.html public/js/selection.js public/js/app.js public/js/hotkeys.js
git commit -m "Add multi-select mode with bulk delete"
git checkout leo && git merge --no-ff feat/multi-select -m "Merge feat/multi-select" && systemctl --user restart clideck
```
Verify: select-mode button toggles the bar; clicking rows selects (highlight) without opening the session; count updates; Delete → single confirm with count → all selected rows disappear; Esc/Cancel exits and clears highlights; while inactive, clicking rows opens sessions normally. Test bulk delete only on 2-3 throwaway shell sessions. `git push origin leo feat/multi-select`.

---

### Task 7: Hide sessions

**Files:**
- Modify: `sessions.js` (setHidden + persistence: lines 366-370 pattern, 490-518 saveSessions, `list()`, `resume()`, exports at 560), `handlers.js:515-519` pattern (new case), `public/js/state.js` (QUEUEABLE_TYPES), `public/js/terminals.js` (menu entry ~line 453, regroupSessions hidden section, updateUnreadBadge:1378, markUnread), `public/js/app.js` (broadcast handling), `public/js/selection.js` (Hide button), `public/index.html` (Hide button in selection bar)

**Interfaces:**
- Consumes: `session.mute` patterns on both sides.
- Produces: WS message `{type:'session.hide', id, hidden}` (client→server and broadcast); `hidden` field on live session objects, `list()` output, and `sessions.json` entries; `sessions.setHidden(id, hidden)` (CJS export).

- [ ] **Step 1: Branch off leo**

```bash
cd ~/clideck && git checkout leo && git checkout -b feat/hide-sessions
```

- [ ] **Step 2: Server side**

`sessions.js` — after `setMute` (line 370) add:
```js
function setHidden(id, hidden) {
  const s = sessions.get(id);
  if (s) { s.hidden = !!hidden; return true; }
  const r = resumable.find(x => x.id === id);
  if (r) { r.hidden = !!hidden; return true; }
  return false;
}
```
- Add `setHidden` to `module.exports`.
- In `saveSessions()` live-session `.map()`, extend the object with `hidden: !!s.hidden,` (next to `muted`).
- In `list()`, extend the mapped object with `hidden: !!s.hidden,` (next to `muted`).
- In `resume()`: where the new live session object is created from `saved` fields, ensure `hidden` is NOT carried over (resuming unhides — the user explicitly opened it). Verify by reading the object literal there; if it spreads `saved`, add `hidden: false`.

`handlers.js` — after the `session.mute` case (line 519) add:
```js
      case 'session.hide': {
        const ok = sessions.setHidden(msg.id, msg.hidden);
        if (ok) sessions.broadcast({ type: 'session.hide', id: msg.id, hidden: !!msg.hidden });
        break;
      }
```

`public/js/state.js` — add `'session.hide',` to `QUEUEABLE_TYPES` (alphabetical slot, before `'session.mute'`).

- [ ] **Step 3: Client — track and render**

`public/js/app.js`:
- `state.terms` is populated via `addTerminal(...)` at line 91 (initial `msg.list.forEach`) and line 101 (single-session message). After each call set the flag on the entry:
```js
          const en = state.terms.get(s.id); if (en) en.hidden = !!s.hidden;   // line-91 loop (then one regroupSessions() after the forEach)
```
```js
        const en2 = state.terms.get(msg.id); if (en2) en2.hidden = !!msg.hidden;  // after the line-101 call
```
(check whether the server includes `hidden` in that single-session message; it comes from `list()`/session events — if the event lacks it, default falsy is correct for a brand-new session.)
- `state.resumable` entries carry `hidden` automatically from the server (`getResumable` passes fields through).
- Add a broadcast case next to the existing `session.mute` case:
```js
      case 'session.hide': {
        const entry = state.terms.get(msg.id);
        if (entry) entry.hidden = !!msg.hidden;
        const r = state.resumable.find(x => x.id === msg.id);
        if (r) r.hidden = !!msg.hidden;
        regroupSessions();
        break;
      }
```

`public/js/terminals.js` — in `regroupSessions()`:
- Where active rows are placed into groups, skip hidden entries (leave the DOM node detached) and count them; same for `state.resumable` placement (`if (s.hidden) { hiddenCount++; continue; }` — plus collect the hidden ones into an array).
- After the resumable/ungrouped section, render a bottom section when `hiddenCount > 0`:
```js
  if (hiddenEntries.length) {
    const section = document.createElement('div');
    section.id = 'hidden-section';
    section.innerHTML = `<div class="hidden-header group flex items-center gap-1.5 px-2.5 py-2 mt-1 border-t border-slate-700/50 cursor-pointer select-none">
      <span class="flex-1 text-[11px] font-semibold uppercase tracking-wider text-slate-600">Hidden</span>
      <span class="text-[10px] text-slate-600">${hiddenEntries.length}</span>
    </div><div class="hidden-body hidden"></div>`;
    const body = section.querySelector('.hidden-body');
    section.querySelector('.hidden-header').addEventListener('click', () => body.classList.toggle('hidden'));
    for (const h of hiddenEntries) body.appendChild(h.row); // detached active rows and freshly built resumable rows
    list.appendChild(section);
  }
```
(`hiddenEntries` items: `{row}` — for active sessions reuse the detached row from the `rows` map; for dormant ones call `buildResumableRow(s)`. Rows inside the hidden body stay fully functional — the context menu Unhide works there.)
- `updateUnreadBadge()` (line 1378): change the count loop to `if (entry.unread && !entry.hidden) count++;`
- `markUnread()`: early-return when `entry.hidden` (`if (!entry || id === state.active || entry.unread || entry.hidden) return;`).

- [ ] **Step 4: Client — menu entries**

`public/js/terminals.js` session dropdown (next to the mute button, ~line 453) add:
```js
    <button class="menu-action flex items-center gap-2.5 w-full px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 transition-colors text-left" data-action="hide">
      <span class="flex-shrink-0 text-slate-400"><svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${entry?.hidden
        ? '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>'
        : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>'}</svg></span>
      ${entry?.hidden ? 'Unhide' : 'Hide'}
    </button>
```
and in the action handler: `else if (action === 'hide') { const en = state.terms.get(sessionId); send({ type: 'session.hide', id: sessionId, hidden: !en?.hidden }); }`

- [ ] **Step 5: Hide button in the selection bar**

`public/index.html` selection bar — before the Delete button:
```html
        <button id="selection-hide" class="px-2 py-1 rounded-md text-slate-300 hover:bg-slate-700 transition-colors font-medium">Hide</button>
```
`public/js/selection.js` in `initSelection()`:
```js
  document.getElementById('selection-hide').addEventListener('click', () => {
    for (const id of selected) send({ type: 'session.hide', id, hidden: true });
    exitSelection();
  });
```

- [ ] **Step 6: Merge, restart, verify**

```bash
git add sessions.js handlers.js public/js/state.js public/js/terminals.js public/js/app.js public/js/selection.js public/index.html
git commit -m "Add hideable sessions with bottom Hidden section"
git checkout leo && git merge --no-ff feat/hide-sessions -m "Merge feat/hide-sessions" && systemctl --user restart clideck
```
Verify: hide an active session via menu → disappears from its project, appears under "Hidden (n)" at the bottom (collapsed by default); hidden session keeps running (its terminal still opens from the hidden section); Unhide restores it; hide a dormant row → survives service restart (persisted in sessions.json); resuming a hidden dormant session unhides it; unread badge ignores hidden sessions; multi-select Hide works. `git push origin leo feat/hide-sessions`.

---

### Task 8: Backup automation + update script

**Files:**
- Create: `tools/clideck-backup.sh`, `tools/clideck-update.sh`, `tools/systemd/clideck-backup.service`, `tools/systemd/clideck-backup.timer`
- Modify (outside repo): install symlinks/units into `~/.config/systemd/user/`

**Interfaces:**
- Produces: daily timer writing to `~/CliDeck-Backups/` (+ My Book when mounted); `tools/clideck-update.sh` as the one-command upstream update.

- [ ] **Step 1: Branch off leo**

```bash
cd ~/clideck && git checkout leo && git checkout -b feat/ops-scripts
```

- [ ] **Step 2: `tools/clideck-backup.sh`**

```bash
#!/bin/bash
# Backup CliDeck + agent session data. Data is sacred — copies only, never deletes sources.
set -uo pipefail
LOCAL=~/CliDeck-Backups
EXTERN="/media/leonardo/My Book/CliDeck-Backups"
STAMP=$(date +%Y-%m-%d_%H%M)
KEEP=14

mkdir -p "$LOCAL"
tar czf "$LOCAL/clideck-data_$STAMP.tar.gz" -C "$HOME" .clideck
rsync -a --delete "$HOME/.claude/projects/" "$LOCAL/claude-projects-mirror/"
rsync -a --delete "$HOME/.codex/sessions/"  "$LOCAL/codex-sessions-mirror/"
cp -f "$HOME/.codex/history.jsonl" "$LOCAL/codex-history.jsonl" 2>/dev/null

# Rotate tar snapshots, keep newest $KEEP
ls -1t "$LOCAL"/clideck-data_*.tar.gz 2>/dev/null | tail -n +$((KEEP+1)) | xargs -r rm -f

if [ -d "$EXTERN" ] || mkdir -p "$EXTERN" 2>/dev/null; then
  rsync -a --delete "$LOCAL/" "$EXTERN/" && echo "extern: ok"
else
  echo "extern: My Book nicht gemountet — nur lokales Backup" >&2
fi
echo "backup ok: $STAMP"
```

- [ ] **Step 3: `tools/clideck-update.sh`**

```bash
#!/bin/bash
# Pull upstream updates into the running fork. Aborts on conflicts, leaving the service untouched.
set -euo pipefail
cd ~/clideck
"$(dirname "$0")/clideck-backup.sh"
git fetch upstream --tags
git checkout main
git merge --ff-only upstream/main
git checkout leo
if ! git merge --no-ff main -m "Merge upstream $(git describe --tags main 2>/dev/null || git rev-parse --short main)"; then
  git merge --abort
  git checkout leo
  echo "MERGE-KONFLIKT: leo unverändert, Dienst läuft weiter. Konflikt manuell lösen." >&2
  exit 1
fi
git push origin main leo
systemctl --user restart clideck
echo "update ok: $(git log --oneline -1)"
```

- [ ] **Step 4: systemd units**

`tools/systemd/clideck-backup.service`:
```ini
[Unit]
Description=CliDeck data backup

[Service]
Type=oneshot
ExecStart=/home/leonardo/clideck/tools/clideck-backup.sh
StandardOutput=append:/home/leonardo/CliDeck-Backups/backup.log
StandardError=append:/home/leonardo/CliDeck-Backups/backup.log
```
`tools/systemd/clideck-backup.timer`:
```ini
[Unit]
Description=Daily CliDeck data backup

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 5: Install and test**

```bash
chmod +x tools/clideck-backup.sh tools/clideck-update.sh
ln -sf ~/clideck/tools/systemd/clideck-backup.service ~/.config/systemd/user/
ln -sf ~/clideck/tools/systemd/clideck-backup.timer ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now clideck-backup.timer
systemctl --user start clideck-backup.service && tail -3 ~/CliDeck-Backups/backup.log
systemctl --user list-timers clideck-backup.timer
```
Expected: log ends with `backup ok: <stamp>`, a second `clideck-data_*.tar.gz` exists, timer listed with next run. Note: symlinked units work for user managers; if `systemctl --user enable` complains about symlinks, copy the files instead of linking.

- [ ] **Step 6: Commit, merge, push**

```bash
git add tools/ && git commit -m "Add backup automation and upstream update script"
git checkout leo && git merge --no-ff feat/ops-scripts -m "Merge feat/ops-scripts"
git push origin leo feat/ops-scripts
```

---

### Task 9: Final verification & wrap-up

- [ ] **Step 1: Full unit test run**

```bash
cd ~/clideck && node --test tests/unit/
```
Expected: all pass.

- [ ] **Step 2: Full UI walkthrough (real data)**

At http://localhost:4000, one pass over everything: alphabetical order ✓, pin/unpin + pinned drag ✓, quick-delete X active+dormant (throwaway session) ✓, multi-select delete + hide ✓, hidden section + unhide + persistence over restart ✓, unread tab behavior ✓, and the untouched basics: create session, resume, rename, theme, search filter, project create/delete.

- [ ] **Step 3: Confirm data untouched**

```bash
python3 -c "import json; print(len(json.load(open('/home/leonardo/.clideck/sessions.json'))), 'sessions')"
```
Expected: session count plausible vs. before (minus intentionally deleted throwaways). Projects intact in the UI.

- [ ] **Step 4: Push everything, summarize PR candidates for Leonardo**

```bash
git push origin main leo fix/claude-session-id-guard feat/project-sort feat/project-pin feat/quick-delete feat/multi-select feat/hide-sessions feat/ops-scripts
```
Report to Leonardo which branches are good upstream-PR candidates (likely: project-sort, project-pin, quick-delete, multi-select, hide-sessions — NOT ops-scripts/hotfix which are personal). Do not open PRs without his explicit OK.
