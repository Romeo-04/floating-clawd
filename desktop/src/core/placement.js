// Where the panel opens, and keeping Clawd on a screen that exists.

export const SIZE_MIN = 56;
export const SIZE_MAX = 240;
export const SIZE_DEFAULT = 104;
export const SIZE_PRESETS = { Small: 72, Medium: 104, Large: 144, 'Extra large': 200 };

export function clampSize(px) {
  if (!Number.isFinite(px)) return SIZE_DEFAULT;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(px)));
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function panelPlacement(clawd, panel, workArea, gap = 12) {
  const leftX = clawd.x - gap - panel.width;
  const rightX = clawd.x + clawd.width + gap;
  const side = leftX >= workArea.x ? 'left' : 'right';
  const rawX = side === 'left' ? leftX : rightX;
  const x = clamp(rawX, workArea.x, workArea.x + workArea.width - panel.width);
  const y = clamp(clawd.y + clawd.height - panel.height, workArea.y, workArea.y + workArea.height - panel.height);
  return { x, y, side };
}

const overlap = (r, a) =>
  Math.max(0, Math.min(r.x + r.width, a.x + a.width) - Math.max(r.x, a.x)) *
  Math.max(0, Math.min(r.y + r.height, a.y + a.height) - Math.max(r.y, a.y));

export function clampToWorkArea(rect, workAreas, margin = 24) {
  const half = (rect.width * rect.height) / 2;
  const home = workAreas.find(a => overlap(rect, a) >= half);
  if (home) {
    return {
      x: clamp(rect.x, home.x, home.x + home.width - rect.width),
      y: clamp(rect.y, home.y, home.y + home.height - rect.height),
    };
  }
  const p = workAreas[0];
  return { x: p.x + p.width - rect.width - margin, y: p.y + p.height - rect.height - margin };
}
