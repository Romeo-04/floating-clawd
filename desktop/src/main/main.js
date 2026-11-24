// Floating Clawd — app entry. Wires sync, windows, tray, shortcut, mood and timers.
import { app, ipcMain, Tray, Menu, nativeImage, globalShortcut, screen, safeStorage, powerMonitor, dialog } from 'electron';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSettings } from './settings.js';
import { TaskSync } from './sync.js';
import { pickMood } from '../core/mood.js';
import { clampSize, SIZE_PRESETS, SIZE_DEFAULT } from '../core/placement.js';
import { clawdIconPNG } from '../core/png.js';
import { createClawdWindow, createPanelWindow, placePanel, resizeClawdWindow, onScreenPosition } from './windows.js';

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHORTCUT = 'Control+Alt+Space';

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('com.floatingclawd.desktop');

let settings, sync, tray, clawdWin, panelWin;
let panelOpen = false;
let lastState = { view: { open: [], done: [], total: 0, doneCount: 0 }, status: 'signed-out' };
let justCompletedUntil = 0;
let dragTimer = null;
let blurClosedAt = 0; // clicking Clawd or the tray blurs the panel first; don't let that click reopen it

function loadConfig() {
  const candidates = [
    join(app.getPath('userData'), 'config.local.json'),
    app.isPackaged ? join(process.resourcesPath, 'config.local.json') : join(appRoot, 'config.local.json'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const c = JSON.parse(readFileSync(file, 'utf8'));
      if (c.supabaseUrl && c.supabaseAnonKey && !c.supabaseUrl.includes('YOUR-PROJECT')) return c;
    } catch { /* fall through */ }
  }
  return null;
}

function makeClient({ supabaseUrl, supabaseAnonKey }) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: {
        getItem: k => settings.getSecret(`sb:${k}`),
        setItem: (k, v) => settings.setSecret(`sb:${k}`, v),
        removeItem: k => settings.setSecret(`sb:${k}`, null),
      },
      persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
    },
  });
}

const send = (channel, value) => {
  for (const w of [clawdWin, panelWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, value);
};

function broadcastState(state) {
  lastState = state;
  send('state', state);
  updateMood();
  refreshTray();
}

function updateMood() {
  const { view, status } = lastState;
  const mood = pickMood({
    open: view.open.length, done: view.doneCount, hour: new Date().getHours(), panelOpen,
    offline: status !== 'synced' && status !== 'syncing',
    idleMinutes: powerMonitor.getSystemIdleTime() / 60,
    justCompleted: Date.now() < justCompletedUntil,
  });
  send('mood', mood);
}

// ---------- panel ----------
function setPanel(open) {
  if (!panelWin || panelWin.isDestroyed()) return;
  panelOpen = open;
  if (open) {
    placePanel(panelWin, clawdWin);
    panelWin.show();
    panelWin.focus();
  } else {
    panelWin.hide();
  }
  send('panel', open);
  updateMood();
}
const togglePanel = () => {
  if (!panelOpen && Date.now() - blurClosedAt < 300) return;
  setPanel(!panelOpen);
};

// ---------- size + position ----------
const currentSize = () => clampSize(settings.get('clawdSize') ?? SIZE_DEFAULT);

function setClawdSize(px) {
  const size = clampSize(px);
  settings.set('clawdSize', size);
  const pos = resizeClawdWindow(clawdWin, size);
  settings.set('clawdPos', pos);
  send('size', size);
  if (panelOpen) placePanel(panelWin, clawdWin);
  refreshTray();
}

function keepClawdOnScreen() {
  const { x, y } = clawdWin.getBounds();
  const pos = onScreenPosition({ x, y }, currentSize());
  clawdWin.setPosition(pos.x, pos.y);
  settings.set('clawdPos', pos);
}

// ---------- tray ----------
function refreshTray() {
  if (!tray) return;
  const size = currentSize();
  const signedIn = lastState.status !== 'signed-out' && lastState.status !== 'not-configured';
  const autostart = app.getLoginItemSettings().openAtLogin;
  tray.setToolTip(`Floating Clawd · ${lastState.view.doneCount}/${lastState.view.total} done`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open list', accelerator: SHORTCUT, click: () => setPanel(true) },
    { label: clawdWin.isVisible() ? 'Hide Clawd' : 'Show Clawd', click: () => {
      if (clawdWin.isVisible()) { setPanel(false); clawdWin.hide(); } else clawdWin.showInactive();
      refreshTray();
    } },
    { label: 'Size', submenu: Object.entries(SIZE_PRESETS).map(([label, px]) => ({
      label, type: 'radio', checked: size === px, click: () => setClawdSize(px),
    })) },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: autostart, enabled: app.isPackaged,
      click: item => { app.setLoginItemSettings({ openAtLogin: item.checked }); settings.set('autostart', item.checked); } },
    { label: 'Sign out', enabled: signedIn && !!sync, click: () => signOut() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// Signing out wipes the local cache, so warn first if some edits haven't reached Supabase.
async function signOut() {
  const unsent = sync.pendingCount();
  if (unsent > 0) {
    const { response } = await dialog.showMessageBox({
      type: 'warning', buttons: ['Sign out anyway', 'Cancel'], defaultId: 1, cancelId: 1,
      title: 'Floating Clawd', message: `${unsent} change${unsent === 1 ? " hasn't" : "s haven't"} synced yet.`,
      detail: 'Signing out now will lose them. Connect to the internet first to keep them.',
    });
    if (response !== 0) return { ok: false, error: 'Sign-out cancelled' };
  }
  await sync.signOut();
  return { ok: true };
}

// ---------- IPC ----------
function wireIPC() {
  const needSync = fn => async (...args) => (sync ? fn(...args) : { ok: false, error: 'Supabase is not set up yet' });
  ipcMain.handle('tasks:add', needSync((_e, t) => sync.add(t)));
  ipcMain.handle('tasks:toggle', needSync(async (_e, id) => {
    const r = await sync.toggle(id);
    if (r.done) { justCompletedUntil = Date.now() + 1200; updateMood(); setTimeout(updateMood, 1300); }
    return r;
  }));
  ipcMain.handle('tasks:rename', needSync((_e, id, t) => sync.rename(id, t)));
  ipcMain.handle('tasks:remove', needSync((_e, id) => sync.remove(id)));
  ipcMain.handle('tasks:reorder', needSync((_e, ids) => sync.reorder(ids)));
  ipcMain.handle('auth:sign-in', needSync((_e, email, pw) => sync.signIn(email, pw)));
  ipcMain.handle('auth:sign-out', needSync(() => signOut()));

  ipcMain.on('renderer:ready', e => {
    e.sender.send('state', lastState);
    e.sender.send('size', currentSize());
    e.sender.send('panel', panelOpen);
    updateMood();
  });
  ipcMain.on('clawd:ignore', (_e, ignore) => clawdWin.setIgnoreMouseEvents(!!ignore, { forward: true }));
  ipcMain.on('clawd:resize-by', (_e, delta) => setClawdSize(currentSize() + Number(delta || 0)));
  ipcMain.on('clawd:click', togglePanel);
  ipcMain.on('panel:close', () => setPanel(false));

  ipcMain.on('clawd:drag-start', () => {
    const start = screen.getCursorScreenPoint();
    const origin = clawdWin.getBounds();
    clearInterval(dragTimer);
    dragTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      clawdWin.setPosition(origin.x + p.x - start.x, origin.y + p.y - start.y);
      if (panelOpen) placePanel(panelWin, clawdWin);
    }, 16);
  });
  ipcMain.on('clawd:drag-end', () => {
    clearInterval(dragTimer);
    dragTimer = null;
    keepClawdOnScreen();
    if (panelOpen) placePanel(panelWin, clawdWin);
  });
}

// ---------- timers ----------
function scheduleMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
  setTimeout(() => {
    if (sync) sync.emitState(); // view is rebuilt with the new "today"
    scheduleMidnight();
  }, next - now);
}

// ---------- start ----------
app.whenReady().then(async () => {
  settings = createSettings({ dir: app.getPath('userData'), crypto: safeStorage });

  if (app.isPackaged && settings.get('autostart') === undefined) {
    app.setLoginItemSettings({ openAtLogin: true });
    settings.set('autostart', true);
  }

  clawdWin = createClawdWindow({ size: currentSize(), pos: settings.get('clawdPos') });
  panelWin = createPanelWindow();
  panelWin.on('close', e => { if (!app.isQuitting) { e.preventDefault(); setPanel(false); } });
  panelWin.on('blur', () => { if (panelOpen) { blurClosedAt = Date.now(); setPanel(false); } });

  tray = new Tray(nativeImage.createFromBuffer(clawdIconPNG(32)));
  tray.on('click', togglePanel);

  wireIPC();
  globalShortcut.register(SHORTCUT, togglePanel);

  screen.on('display-removed', keepClawdOnScreen);
  screen.on('display-metrics-changed', keepClawdOnScreen);
  powerMonitor.on('resume', () => sync?.wake());
  setInterval(updateMood, 60_000);
  scheduleMidnight();

  const config = loadConfig();
  if (!config) {
    broadcastState({ ...lastState, status: 'not-configured' });
  } else {
    sync = new TaskSync({ client: makeClient(config), settings, clearSession: () => settings.clearSecrets('sb:') });
    sync.on('state', broadcastState);
    broadcastState(sync.snapshot());
    await sync.start();
  }
  refreshTray();
});

app.on('second-instance', () => { clawdWin?.showInactive(); setPanel(true); });
app.on('before-quit', () => { app.isQuitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', e => e.preventDefault());
