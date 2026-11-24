// The two windows: floating Clawd and the glass panel.
import { BrowserWindow, screen } from 'electron';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { spriteHeight } from '../core/sprite.js';
import { clampToWorkArea, panelPlacement } from '../core/placement.js';

const here = dirname(fileURLToPath(import.meta.url));
const preload = join(here, '..', 'preload', 'preload.cjs');
const page = name => join(here, '..', 'renderer', name, 'index.html');

export const PANEL_SIZE = { width: 340, height: 560 };
const PAD_X = 8, PAD_TOP = 18, PAD_BOTTOM = 8; // room for the hop and drop shadow

export const clawdWindowSize = size => ({ width: size + PAD_X * 2, height: spriteHeight(size) + PAD_TOP + PAD_BOTTOM });

const workAreas = () => {
  const primary = screen.getPrimaryDisplay();
  const others = screen.getAllDisplays().filter(d => d.id !== primary.id);
  return [primary, ...others].map(d => d.workArea);
};

export function onScreenPosition(pos, size) {
  const { width, height } = clawdWindowSize(size);
  const start = pos ?? { x: Number.MAX_SAFE_INTEGER, y: 0 }; // no saved position → primary bottom-right
  return clampToWorkArea({ ...start, width, height }, workAreas());
}

const common = {
  frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
  skipTaskbar: true, alwaysOnTop: true, show: false,
  webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
};

export function createClawdWindow({ size, pos }) {
  const { width, height } = clawdWindowSize(size);
  const { x, y } = onScreenPosition(pos, size);
  const win = new BrowserWindow({
    ...common, x, y, width, height, transparent: true, hasShadow: false, focusable: false,
    backgroundColor: '#00000000', title: 'Clawd',
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(page('clawd'));
  win.once('ready-to-show', () => win.showInactive());
  return win;
}

export function resizeClawdWindow(win, size) {
  const old = win.getBounds();
  const { width, height } = clawdWindowSize(size);
  const pos = clampToWorkArea(
    { x: old.x + old.width - width, y: old.y + old.height - height, width, height }, workAreas());
  win.setBounds({ ...pos, width, height });
  return pos;
}

export function createPanelWindow() {
  const win = new BrowserWindow({
    ...common, ...PANEL_SIZE, title: 'Floating Clawd',
    backgroundColor: '#00000000', backgroundMaterial: 'acrylic', roundedCorners: true,
  });
  win.setAlwaysOnTop(true, 'floating');
  win.loadFile(page('panel'));
  return win;
}

export function placePanel(panel, clawdWin) {
  const c = clawdWin.getBounds();
  const area = screen.getDisplayMatching(c).workArea;
  const { x, y, side } = panelPlacement(c, PANEL_SIZE, area);
  panel.setBounds({ x, y, ...PANEL_SIZE });
  return side;
}
