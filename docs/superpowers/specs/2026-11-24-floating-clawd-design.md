# Floating Clawd — Design

Date: 2026-11-24
Status: draft, awaiting owner approval

## Intent

One personal "today" to-do list, always one tap away on both devices, fronted by a
pixel Clawd (the Claude mascot look-alike) in a glassmorphism UI.

- **Laptop (Windows 11):** a small Clawd floats on top of everything. Tap him and a glass
  to-do panel opens beside him.
- **Phone (Android):** a home-screen widget (stationary, not floating) with Clawd on it,
  where tasks can be ticked and added without opening an app.
- Both read and write the **same list**. A change on one shows on the other.

Single user (the owner). Personal use, not for distribution or sale.

## Goals

- Glance at today's tasks and tick them off in one tap, from either device.
- Change on phone appears on laptop within ~2 seconds (laptop listens live).
- Fully custom look: our own Clawd art, glass panels, warm Claude palette.
- Clawd feels alive: blinks, reacts when a task is done, celebrates when all are done.

## Non-goals

- iPhone / macOS support.
- Multiple users, shared lists, projects, tags, due times, reminders/notifications.
- Floating bubble on the phone (owner explicitly does not need it).
- Publishing to Play Store / Microsoft Store.

## Anti-goals (would be a failure even if it "works")

- Clawd gets in the way: steals focus, blocks clicks on the area around him, or can't be moved.
- The two devices show different lists and the owner can't tell which is right.
- Logging in again and again. Sign in once per device, then never again.
- Any secret (password, service key) committed to the public GitHub repo.

## Constraints

- Repo: https://github.com/Romeo-04/floating-clawd (public). Only the Supabase **anon** key
  may appear in client config; everything is protected by Row Level Security.
- Laptop already has Node 24 and Android Studio + Android SDK.
- Android widgets cannot blur what is behind them. The phone widget uses a frosted,
  translucent card instead of true backdrop blur. The phone app screen can use real blur
  (Android 12+).
- Clawd art is drawn from scratch for this project (pixel grid in code). We do **not** copy
  artwork from other Clawd projects (their art licenses forbid modification).

## Approaches considered

1. **Google Tasks as backend + Google's own phone widget + custom laptop Clawd.**
   Least work, but the phone widget can't look like Clawd or glass, and needs Google Cloud
   OAuth setup. Rejected: owner wants it fully customizable.
2. **KWGT/Tasker phone widget.** Paid apps, fragile scripting, still limited interactivity.
   Rejected.
3. **Fully custom: Supabase + Electron (laptop) + native Android app with Glance widget.**
   **Chosen** by the owner for full control over look and behavior.

## Architecture

```
 Laptop (Electron)                 Supabase (free tier)              Phone (Android, Kotlin)
 ┌───────────────────┐   realtime  ┌──────────────────────┐  REST    ┌──────────────────────┐
 │ Clawd window      │◄───────────►│ Postgres: tasks      │◄────────►│ Glance home widget   │
 │ Glass panel window│   REST      │ Auth: email+password │          │ Compose app (glass)  │
 └───────────────────┘             │ RLS: user_id = me    │  FCM?    └──────────────────────┘
                                   └──────────────────────┘ (see Open questions)
```

### Data model (Supabase Postgres)

`tasks`
| column       | type        | notes                                       |
|--------------|-------------|---------------------------------------------|
| id           | uuid pk     | generated client-side so offline adds work  |
| user_id      | uuid        | default `auth.uid()`, RLS key               |
| title        | text        | 1–200 chars                                 |
| done         | boolean     | default false                               |
| done_at      | timestamptz | set when ticked, cleared when unticked      |
| for_date     | date        | the day the task belongs to (local date)    |
| position     | double      | manual ordering                              |
| created_at   | timestamptz | default now()                               |
| updated_at   | timestamptz | trigger-maintained; last write wins         |
| deleted      | boolean     | soft delete so the other device learns of it|

RLS: a user can select/insert/update only rows where `user_id = auth.uid()`.
Realtime enabled on `tasks`.

### "Today" rules (proposed)

- The list shows tasks whose `for_date` is today, **plus any unfinished task from an
  earlier day** (it rolls over automatically and shows a small "from yesterday"/"from Mon" tag).
- Finished tasks from earlier days are hidden (kept in the database, not deleted).
- "Today" uses each device's local timezone (both devices are in the same timezone).

### Sign-in

Supabase email + password, created once by the owner. Each device signs in once; the
session is stored (laptop: encrypted with Electron `safeStorage`; phone: EncryptedSharedPreferences)
and refreshed automatically.

### Laptop app (Electron, Windows)

- **Clawd window:** transparent, frameless, always-on-top, skip-taskbar, ~96×96 px.
  Only Clawd's pixels catch the mouse; the empty corners click through.
  - Drag anywhere to move; position is remembered and kept on-screen if monitors change.
  - Click (press and release without moving) toggles the panel.
- **Panel window:** glass card (~340×480) that opens beside Clawd, on whichever side has room.
  Native Windows 11 acrylic blur behind it, rounded corners, warm tint.
  - Header: date, "3 of 5 done" with a small progress bar.
  - Add field at top ("What's next?", Enter to add).
  - Task rows: checkbox, title, rolled-over tag. Click title to edit, hover shows delete.
    Drag to reorder.
  - Done tasks sink to the bottom with strikethrough.
  - Closes on Esc or clicking Clawd again. Optional: close when clicking elsewhere.
- **Clawd moods (animations):** idle with blinking, happy `^ ^` eyes plus a small hop when a task
  is ticked, a celebration (confetti/sparkles) when everything is done, sleepy at night
  or after long idle, and typing at a tiny laptop while the panel is open.
- **Tray icon:** show/hide Clawd, start with Windows (on by default), sign out, quit.
- **Global shortcut:** `Ctrl+Alt+Space` opens/closes the panel.
- **Offline:** last list cached locally; changes made offline are queued and sent when
  back online. A small dot on Clawd shows "offline/not synced".

### Phone (Android, Kotlin)

- **Home-screen widget (Jetpack Glance), resizable:**
  - Clawd in the corner (mood reflects progress), date, "3/5".
  - Scrollable list with checkboxes; tapping a checkbox ticks it immediately on the widget
    and syncs in the background.
  - "+" button opens a small glass pop-up to type a new task (doesn't open the full app).
  - Refresh button.
  - Frosted translucent card with the Claude warm palette.
- **App screen (Jetpack Compose):** the same list as the laptop panel, with real glass blur:
  add, tick, edit, delete, reorder. Live updates while open.
- **Keeping the widget fresh:** refreshed whenever you interact with it, open the app, unlock
  the phone (if allowed), and every 15 minutes in the background (Android's minimum).
  See Open questions for instant updates.
- Minimum Android 8 (API 26); blur effects on Android 12+, plain translucency below.

### Visual style

- Palette: Claude terracotta `#D97757` for Clawd and accents, cream `#F5EFE6` text on
  dark glass (panel default) — a light glass variant can follow the Windows theme.
- Glass: translucent fill, 1px light inner border, soft shadow, 16–20px corner radius.
- Clawd: a pixel-grid character drawn in code: square terracotta body, two black block eyes,
  stubby side arms, four little legs. Inspired by the owner's reference images.

### Conflicts

Last write wins per task, using `updated_at`. With one user this is rarely visible.

## Open questions for the owner

1. **Instant phone updates.** As designed, the laptop sees phone changes instantly, but the
   phone *widget* sees laptop changes when you touch it, open the app, or within 15 minutes.
   Making the widget update instantly needs Firebase Cloud Messaging (one more free account
   + a small Supabase function to send a push). Worth adding?

## Calls made during review (builder's, owner can override)

- **Supabase project:** the owner creates the free Supabase project and their one account
  (needs their email). The builder supplies the SQL migration (run via Supabase CLI or pasted into
  the SQL editor). New sign-ups are disabled after the owner's account exists.
  The anon key and project URL live in an untracked local config file (`config.local.json`
  / `local.properties`), with a committed `.example` template.
- **Conflict timestamps:** clients stamp `updated_at` with their own edit time; the server
  accepts an update only if it is newer than the stored one (conditional upsert). Server
  arrival order is not used, so an old offline edit can't overwrite a newer one.
- **`for_date`:** always "today" when a task is added (no picking other days in v1). It powers
  the rollover tag and history. Both apps re-query at local midnight (laptop timer; widget
  scheduled update at 00:01).
- **Android session:** one encrypted token store and one data layer shared by the app, the
  widget actions and the background refresh worker; supabase-kt refreshes tokens. A refresh
  failure shows "Tap to sign in" on the widget, never a silently empty list.
- **Clawd click-through:** hit-test on the sprite's alpha (transparent pixels pass clicks to
  whatever is behind). Pixel-accurate enough; no need for a vector outline.
- **Panel glass on Windows:** try native Windows 11 acrylic (`backgroundMaterial`). If it
  misbehaves with rounded corners, fall back to a translucent tinted panel with a subtle
  noise texture. Either is acceptable.
- **Widget "+":** opens a small transparent dialog Activity with a text field over the home
  screen (Glance can't host text input).
- **FCM:** out of scope for v1 unless the owner says otherwise; the sync layer keeps a
  single "refresh widget" entry point so a push can be added later.

## Left to the builder

- Exact pixel art, animation timings, and the confetti effect.
- Project layout (`desktop/`, `android/`, `supabase/`), libraries within the chosen stacks,
  installer format (electron-builder NSIS), APK signing for sideloading.
- Error and empty-state copy.
