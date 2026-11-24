# Floating Clawd — Backend + Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Supabase "today" task list and a Windows Electron app with a floating, draggable pixel Clawd that opens a glass to-do panel, synced live.

**Architecture:** Supabase Postgres holds `tasks` (RLS per user, realtime on). The Electron **main process** owns the Supabase client, the session, the local cache and the offline queue, and pushes a computed view to two renderers over IPC: the transparent Clawd window and the glass panel window. Pure logic (today view, mood, sprite, placement, merge) lives in `desktop/src/core/` and is unit-tested with Vitest.

**Tech Stack:** Electron (latest), @supabase/supabase-js v2, Vitest, electron-builder (NSIS), vanilla ESM JS + CSS, Figtree + Silkscreen fonts (bundled, OFL).

**Spec:** `docs/superpowers/specs/2026-11-24-floating-clawd-design.md` · **Visual reference:** `design/mockup.html` (approved)

**Follow-up plan (not this one):** Android app + Glance widget, reusing the same database.

## Global Constraints

- Windows 11 only for desktop. Node 24.
- `desktop/package.json` has `"type": "module"`; preload is `preload.cjs` (sandboxed preloads must be CommonJS).
- Only the Supabase **anon key** and URL may appear in client config, in untracked `desktop/config.local.json`; commit `desktop/config.example.json`. Repo is public.
- Session stored encrypted with Electron `safeStorage`.
- Task title: 1–200 chars after trimming.
- "Today" = device local date `YYYY-MM-DD`. Visible = `for_date == today` OR (`!done` AND `for_date < today`), never `deleted`.
- Conflicts: last write wins on client-stamped `updated_at`; the server ignores an update whose `updated_at` is older than the stored one.
- Clawd window ~104×66 px sprite area, transparent, frameless, always-on-top, skip-taskbar; transparent pixels click through.
- Design tokens exactly as `design/mockup.html` `:root` (terracotta `#D97757`, shade `#B85C3E`, highlight `#E58A68`, ink `#1A1410`, cream `#F5EFE6`, dark glass default).
- Global shortcut `Ctrl+Alt+Space` toggles the panel. Start with Windows on by default.
- Clawd art is original (sprite engine from `design/mockup.html`); never copy art from other Clawd projects.

## Review Focus

1. **Clawd ends up off-screen** (monitor unplugged, resolution change, saved position from another setup) → he reappears inside the nearest visible work area. Test in Task 4 (`clampToWorkArea`).
2. **Midnight passes while running** → list regroups: yesterday's unfinished tasks get a "FROM MON" tag, yesterday's finished ones disappear, counts reset. Test in Task 2 + timer in Task 7.
3. **Offline / laptop asleep, then back** → edits made offline are kept, sent on reconnect, and a newer edit from the phone is not overwritten by an older offline one. Tests in Task 5.
4. **Session can't be refreshed** → panel shows the sign-in form and Clawd shows OFFLINE, never a silently empty list. Test in Task 6.
5. **Long / blank / emoji titles** → blank rejected, >200 rejected with a message, long ones ellipsize in the row and show fully while editing. Test in Task 2 (`validateTitle`).

---

## File Structure

```
.gitignore                              node_modules, dist, config.local.json, *.log
supabase/migrations/0001_tasks.sql      table, RLS, trigger, realtime
supabase/SETUP.md                       owner's 2-minute setup steps
desktop/
  package.json  config.example.json  electron-builder.yml
  assets/fonts/Figtree-*.woff2 Silkscreen-Regular.woff2   assets/icon.ico (generated from sprite)
  src/core/today.js       buildView, validateTitle, localDateISO, rolloverTag
  src/core/mood.js        pickMood
  src/core/sprite.js      clawdPixels, spriteSVG, isOpaque, SPRITE_BOX
  src/core/placement.js   panelPlacement, clampToWorkArea
  src/core/merge.js       mergeRemote, applyLocal, pendingRows
  src/main/main.js        app lifecycle, tray, shortcut, autostart, midnight timer
  src/main/windows.js     createClawdWindow, createPanelWindow, IPC wiring
  src/main/settings.js    JSON settings + encrypted secret storage
  src/main/sync.js        TaskSync class (supabase client, realtime, flush)
  src/preload/preload.cjs window.clawd API
  src/renderer/tokens.css shared tokens + @font-face
  src/renderer/clawd/{index.html,clawd.js,clawd.css}
  src/renderer/panel/{index.html,panel.js,panel.css}
  test/*.test.js
```

Shared task row shape (JS, used everywhere):
`{ id: string(uuid), title: string, done: boolean, done_at: string|null, for_date: 'YYYY-MM-DD', position: number, created_at: string, updated_at: string(ISO), deleted: boolean }`

---

### Task 1: Supabase schema + setup guide

**Files:** Create `supabase/migrations/0001_tasks.sql`, `supabase/SETUP.md`, `.gitignore`

- [ ] **Step 1: Write `0001_tasks.sql`**: table `public.tasks` with the columns from the spec (`user_id uuid not null default auth.uid() references auth.users on delete cascade`, `title text not null check (char_length(title) between 1 and 200)`, `position double precision not null default 0`, `deleted boolean not null default false`, `updated_at timestamptz not null default now()`), index on `(user_id, for_date)`, RLS enabled with select/insert/update policies `using/with check (user_id = (select auth.uid()))` (no delete policy: soft delete only), and `alter publication supabase_realtime add table public.tasks`. Stale-write guard (exact logic):

```sql
create or replace function public.tasks_reject_stale() returns trigger
language plpgsql as $$
begin
  if new.updated_at < old.updated_at then return null; end if;  -- skip older write
  return new;
end $$;
create trigger tasks_reject_stale before update on public.tasks
for each row execute function public.tasks_reject_stale();
```

- [ ] **Step 2: Write `SETUP.md`**: (1) create a free project at supabase.com, (2) SQL Editor → paste `0001_tasks.sql` → Run, (3) Authentication → Users → Add user (email + password, auto-confirm), (4) Authentication → Sign In / Providers → turn off "Allow new users to sign up", (5) Project Settings → API → copy URL + anon key into `desktop/config.local.json` (copy of `config.example.json`).
- [ ] **Step 3: Commit** `feat(db): tasks schema with RLS, stale-write guard, realtime`

### Task 2: Desktop scaffold + today view

**Files:** Create `desktop/package.json`, `desktop/config.example.json`, `desktop/src/core/today.js`, `desktop/test/today.test.js`

**Interfaces — Produces:**
- `localDateISO(date: Date) -> 'YYYY-MM-DD'` (local time, not UTC)
- `buildView(tasks: Task[], today: string) -> { open: Task[], done: Task[], total: number, doneCount: number }`: filters per Global Constraints; `open` sorted by `position` then `created_at`; `done` sorted by `done_at` desc; only today's done tasks count.
- `rolloverTag(forDate: string, today: string) -> string|null`: `null` if same day, `'YESTERDAY'` if 1 day, else 3-letter weekday upper (`'MON'`) within 6 days, else `'NOV 12'`.
- `validateTitle(raw: string) -> { ok: true, title: string } | { ok: false, error: string }`: trims; errors `'Type something first'` / `'Keep it under 200 characters'`.

- [ ] **Step 1: Scaffold**: `npm init`, `npm i @supabase/supabase-js`, `npm i -D electron vitest electron-builder`; scripts `start: electron .`, `test: vitest run`, `dist: electron-builder`; `"main": "src/main/main.js"`, `"type": "module"`.
- [ ] **Step 2: Failing tests** in `today.test.js` (today = `'2026-11-24'`, a Tuesday):
  - unfinished task from `2026-11-23` is in `open`, `rolloverTag` → `'YESTERDAY'`; from `2026-11-23` done → excluded and not counted.
  - from `2026-11-21` → `'SAT'`; from `2026-11-10` → `'NOV 10'`.
  - deleted task excluded everywhere.
  - 2 open today + 3 done today → `total 5, doneCount 3`.
  - `localDateISO(new Date(2026,10,24,23,59))` → `'2026-11-24'`.
  - `validateTitle('   ')` error; 201 chars error; `'  hi 👋 '` → `'hi 👋'`.
- [ ] **Step 3: Run** `npm test`: FAIL (module missing). **Step 4: Implement.** **Step 5: Run**: PASS.
- [ ] **Step 6: Commit** `feat(desktop): scaffold and today view logic`

### Task 3: Mood + sprite

**Files:** Create `src/core/mood.js`, `src/core/sprite.js`, `test/mood.test.js`, `test/sprite.test.js`

**Interfaces — Produces:**
- `pickMood({ open: number, done: number, hour: number, panelOpen: boolean, offline: boolean, idleMinutes: number, justCompleted: boolean }) -> 'idle'|'happy'|'typing'|'celebrate'|'coffee'|'sleepy'|'offline'`. Priority: offline → justCompleted (`'happy'`) → total>0 && open==0 (`'celebrate'`) → panelOpen (`'typing'`) → hour>=23||hour<5||idleMinutes>=30 (`'sleepy'`) → hour 5–11 && done==0 && open>0 (`'coffee'`) → `'idle'`. (`'blink'` is a frame, not a mood.)
- `clawdPixels(mood: string|'blink') -> Map<'x,y', colorKey>` and `COLORS`: port `clawd()` + `C` from `design/mockup.html` unchanged.
- `SPRITE_BOX = { minX: -3, minY: -4, w: 22, h: 14 }`; `spriteSVG(mood, widthPx) -> string`.
- `isOpaque(mood, px: number, py: number, widthPx: number) -> boolean`: maps a point inside the rendered sprite to a grid cell; true if a pixel exists there. Used for click-through.

- [ ] **Step 1: Failing tests**: each priority rule above (one case each, including offline beating everything); `clawdPixels('idle')` has eye `'e'` at `'4,2'` and `'11,3'`; `isOpaque('idle', centerOfBody)` true, `isOpaque('idle', 1, 1, 104)` (top-left corner) false.
- [ ] **Step 2: Run**: FAIL. **Step 3: Implement.** **Step 4: Run**: PASS.
- [ ] **Step 5: Commit** `feat(desktop): Clawd moods and sprite engine`

### Task 4: Placement

**Files:** Create `src/core/placement.js`, `test/placement.test.js`

**Interfaces — Produces:** (Rect = `{x,y,width,height}`)
- `panelPlacement(clawd: Rect, panel: {width,height}, workArea: Rect, gap = 12) -> { x, y, side: 'left'|'right' }`: prefer left of Clawd; right if left doesn't fit; vertically align panel bottom with Clawd bottom, then clamp inside workArea.
- `clampToWorkArea(rect: Rect, workAreas: Rect[]) -> {x,y}`: if ≥ 50% of rect lies in some area keep it (clamped fully inside it); else move to bottom-right of the primary (first) area with 24px margin.

- [ ] **Step 1: Failing tests**: Clawd at right edge → side `'left'`; Clawd at x=10 → `'right'`; Clawd near top → panel y clamped to workArea.y; saved position on a removed second monitor (x=3000, areas only 0–1920) → moved to `{x:1920-104-24, ...}` primary bottom-right.
- [ ] **Step 2–4:** Run FAIL → implement → run PASS. **Step 5: Commit** `feat(desktop): panel placement and on-screen clamping`

### Task 5: Merge + offline queue

**Files:** Create `src/core/merge.js`, `test/merge.test.js`

**Interfaces — Produces:**
- State: `{ rows: Record<id, Task>, pending: Record<id, Task> }`
- `applyLocal(state, row: Task) -> state`: writes row into `rows` and `pending` (caller stamps `updated_at = new Date().toISOString()`).
- `mergeRemote(state, remote: Task) -> state`: accept only if no local row or `remote.updated_at >= local.updated_at`; if accepted and `pending[id]` is not newer, drop it from `pending`.
- `pendingRows(state) -> Task[]`; `ackPending(state, rows: Task[]) -> state` removes pending entries whose `updated_at` equals the acked one.

- [ ] **Step 1: Failing tests**: offline tick (local 10:05) then remote older edit (10:00) arrives → local kept, still pending; remote newer (10:10) → remote wins, pending cleared; two local edits to the same task → one pending row (latest); ack of an older version doesn't clear a newer pending edit.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(desktop): last-write-wins merge and offline queue`

### Task 6: Settings + TaskSync (main process)

**Files:** Create `src/main/settings.js`, `src/main/sync.js`, `test/sync.test.js`

**Interfaces:**
- Consumes: Task 2 `buildView`, `validateTitle`, `localDateISO`; Task 5 merge functions.
- Produces:
  - `settings.get(key)`, `settings.set(key, value)` (JSON at `app.getPath('userData')/settings.json`), `settings.getSecret(key)`, `settings.setSecret(key, value|null)` (safeStorage-encrypted). Keys: `clawdPos`, `cache` (merge state), `autostart`, secret `sb-session`.
  - `class TaskSync extends EventEmitter` — `constructor({ client, settings, now = () => new Date() })`; methods `start()`, `signIn(email, password) -> {ok, error?}`, `signOut()`, `add(title) -> {ok, error?}` (new uuid via `crypto.randomUUID()`, `for_date` today, `position` = max open + 1), `toggle(id)`, `rename(id, title)`, `remove(id)` (soft delete), `reorder(ids: string[])`, `refresh()`, `flush()`; emits `'state'` with `{ view, status: 'synced'|'syncing'|'offline'|'signed-out', lastSyncedAt }`.
  - Supabase client is created in `main.js` with `auth: { storage: { getItem/setItem/removeItem → settings secret }, persistSession: true, autoRefreshToken: true }` and injected, so tests pass a fake.
  - Realtime: `client.channel('tasks').on('postgres_changes', {event:'*', schema:'public', table:'tasks'}, p => mergeRemote(p.new))`; on `SUBSCRIBED` → `refresh()` + `flush()`.
  - `flush()` upserts `pendingRows` with `onConflict: 'id'`; network error → status `'offline'`, retry with backoff 2s→60s; on success `ackPending`.
  - Auth `SIGNED_OUT` / refresh failure → status `'signed-out'` (cache kept on disk, not shown as empty).
- [ ] **Step 1: Failing tests** with a fake client (records upserts, can be made to throw): `add('  ')` returns error and writes nothing; `add('Buy milk')` emits state with 1 open task and status `'syncing'` then `'synced'`; failing upsert → status `'offline'` and row stays pending; fake auth emitting `TOKEN_REFRESH_FAILED`/`SIGNED_OUT` → status `'signed-out'` and `view` still holds cached tasks.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(desktop): TaskSync with realtime, offline queue, encrypted session`

### Task 7: Windows, tray, shortcut (main + preload)

**Files:** Create `src/main/main.js`, `src/main/windows.js`, `src/preload/preload.cjs`

**Interfaces — Produces** `window.clawd` (preload, via `contextBridge`):
`onState(cb)`, `onMood(cb)`, `add(title)`, `toggle(id)`, `rename(id,title)`, `remove(id)`, `reorder(ids)`, `signIn(email,pw)`, `signOut()`, `setIgnoreMouse(bool)`, `dragStart()`, `dragMove()`, `dragEnd()`, `clawdClick()`, `closePanel()`.

- Clawd window: `transparent: true, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true` (level `'screen-saver'`), `focusable: false`, size = sprite box + 16px padding for the hop; `setIgnoreMouseEvents(true, { forward: true })` until the renderer reports it is over an opaque pixel. Drag uses `screen.getCursorScreenPoint()` in main during `dragMove` (no renderer coordinates). Saves `clawdPos` on drag end; on start and on `screen` `display-removed`/`display-metrics-changed` → `clampToWorkArea`.
- Panel window: 340×520, `frame: false, show: false, skipTaskbar: true, alwaysOnTop: true, backgroundMaterial: 'acrylic', roundedCorners: true`, background `#00000000`. If acrylic renders badly, set `transparent: true` and rely on `.glass` CSS fallback (spec allows either). Positioned with `panelPlacement`. Hidden on Esc / Clawd click / shortcut. Not hidden on blur (v1).
- Tray: icon from sprite; menu Show/Hide Clawd, Start with Windows (checkbox → `app.setLoginItemSettings`, default on first run), Sign out, Quit. Single-instance lock.
- Mood loop in main: recompute `pickMood` on every state change, panel toggle, every minute, and set `justCompleted` for 1.2s after a tick; send via `'mood'`. Midnight timer: `setTimeout` to next local 00:00:05 → re-emit view; also on `powerMonitor` `resume` → `refresh()` + `flush()`.
- [ ] **Step 1: Implement** the above. **Step 2: Verify manually** `npm start` with a filled `config.local.json`: Clawd visible bottom-right; clicking empty corners of his window hits the desktop behind; drag moves him and the position persists across restart; `Ctrl+Alt+Space` toggles the panel; tray items work.
- [ ] **Step 3: Commit** `feat(desktop): floating Clawd window, panel window, tray, shortcut`

### Task 8: Clawd renderer

**Files:** Create `src/renderer/tokens.css`, `src/renderer/clawd/{index.html,clawd.js,clawd.css}`, `desktop/assets/fonts/*`

- Renders `spriteSVG(mood, 104)`; blink: every 3–6 s (random) show `'blink'` frame for 140 ms when mood is idle/coffee/typing; `bob` (2-step, 1.2 s) always; `hop` (3-step, 0.9 s, once) on `'happy'`; `celebrate` loops hop + sparkle until mood changes. Respect `prefers-reduced-motion`.
- Pointer: on `mousemove` call `setIgnoreMouse(!isOpaque(...))`; `mousedown` on opaque → `dragStart`; moves → `dragMove`; `mouseup` → `dragEnd`, and if total movement < 4 px → `clawdClick`.
- Small dot overlay when status is `'offline'` is covered by the OFFLINE mood; no extra UI.
- [ ] **Step 1: Implement. Step 2: Verify manually**: blinking visible, tick a task → hop, finish all → celebrate, disconnect Wi-Fi → OFFLINE drop. **Step 3: Commit** `feat(desktop): animated Clawd renderer with pixel hit-testing`

### Task 9: Panel renderer

**Files:** Create `src/renderer/panel/{index.html,panel.js,panel.css}`

Matches `design/mockup.html` section 3 exactly (header date in Silkscreen `TUE · NOV 24`, `Today`, `3/5` count, segmented bar one segment per task capped at 12 then becomes continuous, "What's next?" input focused on open, open tasks, `DONE · n` divider, done tasks, footer status `Synced · just now` / `Syncing…` / `Offline — changes saved` / and the shortcut hint).
- Row: checkbox toggles; click title → inline input (Enter saves via `validateTitle`, Esc cancels); hover shows grip + trash; drag grip to reorder (HTML5 DnD) → `reorder(ids)`; `tag` chip from `rolloverTag`.
- Empty state: Clawd `idle` small + "Nothing yet. What's first?". All done: "All done for today" line under the bar.
- Signed-out state: same glass card with email + password fields, "Sign in" (terracotta) button, inline error text.
- Error from `add`/`rename` shows under the input for 3 s.
- Keyboard: Tab order input → rows; Space toggles focused row; visible `:focus-visible` ring (terracotta 2px).
- [ ] **Step 1: Implement. Step 2: Verify manually** against the mockup side by side, then: add/edit/delete/reorder/tick; edit a row in the Supabase Table Editor → panel updates within ~2 s; sign out → sign-in form; wrong password → error text. **Step 3: Commit** `feat(desktop): glass to-do panel`

### Task 10: Package + docs + push

**Files:** Create `desktop/electron-builder.yml`, `README.md`, `desktop/assets/icon.ico` (script `scripts/make-icon.js` renders sprite → PNG → ICO)

- [ ] **Step 1:** electron-builder NSIS target, appId `com.floatingclawd.desktop`, productName `Floating Clawd`, bundle `config.local.json` as `extraResources` if present (read from `process.resourcesPath` in packaged builds, else repo path).
- [ ] **Step 2: Run** `npm test` (all PASS) and `npm run dist` → `desktop/dist/Floating Clawd Setup *.exe` exists; install it, confirm autostart entry and that Clawd appears after sign-in.
- [ ] **Step 3:** README: what it is, Supabase setup link, run/build commands, screenshot of mockup.
- [ ] **Step 4: Commit + push** `git push -u origin main` (confirm `config.local.json` is not tracked first: `git ls-files | grep config.local` → empty).
