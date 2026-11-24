// Clawd pixel art: original, drawn on a 16x10 body grid with accessories around it.
// Same engine as design/mockup.html.

export const COLORS = {
  o: '#D97757', s: '#B85C3E', h: '#E58A68', e: '#1A1410', k: '#2A2420', K: '#3B332F',
  w: '#F5EFE6', W: 'rgba(245,239,230,.55)', m: '#F1E6D2', M: '#D9C3A5', c: '#4A2C1D',
  y: '#F7C96B', Y: '#F29E6B', b: '#8EC5E8',
};

// Grid cells span x -3..18 and y -4..9.
export const SPRITE_BOX = { minX: -3, minY: -4, w: 22, h: 14 };

export function clawdPixels(mood, { blink = false } = {}) {
  const px = new Map();
  const put = (x, y, k) => px.set(`${x},${y}`, k);

  for (let y = 0; y < 8; y++) for (let x = 2; x < 14; x++) put(x, y, 'o');
  for (let x = 2; x < 13; x++) put(x, 0, 'h');
  for (let y = 0; y < 8; y++) put(13, y, 's');
  for (let x = 2; x < 14; x++) put(x, 7, 's');
  for (const x of [3, 5, 10, 12]) { put(x, 8, 'o'); put(x, 9, 's'); }

  if (mood === 'celebrate') {
    for (const y of [1, 2, 3]) { put(0, y, 'o'); put(1, y, 'o'); put(14, y, 'o'); put(15, y, 's'); }
    put(0, 0, 'o'); put(15, 0, 's');
  } else {
    put(0, 4, 'o'); put(1, 4, 'o'); put(0, 5, 's'); put(1, 5, 's');
    put(14, 4, 'o'); put(15, 4, 's'); put(14, 5, 's'); put(15, 5, 's');
  }

  const eyes = [4, 11];
  const vert = (dy = 0) => eyes.forEach(x => { put(x, 2 + dy, 'e'); put(x, 3 + dy, 'e'); });
  const line = (y = 3) => eyes.forEach(x => { put(x - 1, y, 'e'); put(x, y, 'e'); put(x + 1, y, 'e'); });
  const caret = () => eyes.forEach(x => { put(x, 2, 'e'); put(x - 1, 3, 'e'); put(x + 1, 3, 'e'); });

  switch (mood) {
    case 'blink': line(3); break;
    case 'happy': caret(); break;
    case 'celebrate':
      caret();
      for (const [cx, cy, k] of [[-1, -2, 'y'], [17, -2, 'Y']]) {
        put(cx, cy, k); put(cx - 1, cy, k); put(cx + 1, cy, k); put(cx, cy - 1, k); put(cx, cy + 1, k);
      }
      put(16, 4, 'y'); put(-2, 3, 'Y'); put(7, -3, 'y'); put(9, -4, 'Y');
      break;
    case 'typing':
      if (blink) line(4); else vert(1);
      for (let y = 5; y < 9; y++) for (let x = 1; x < 9; x++) put(x, y, 'k');
      for (let x = 0; x < 10; x++) put(x, 9, 'K');
      put(4, 6, 'w'); put(5, 7, 'w'); put(6, 7, 'w');
      put(9, 6, 'h'); put(10, 6, 'h'); put(9, 7, 's'); put(10, 7, 's');
      break;
    case 'coffee':
      caret();
      for (let y = 3; y < 7; y++) for (let x = -3; x < 0; x++) put(x, y, 'm');
      put(-2, 3, 'c'); put(-1, 4, 'M'); put(-1, 5, 'M'); put(-1, 6, 'M');
      put(-2, 1, 'W'); put(-3, 0, 'W'); put(-2, -1, 'W'); put(-1, -2, 'W');
      break;
    case 'sleepy':
      line(4);
      for (const [x, y] of [[15, -4], [16, -4], [17, -4], [16, -3], [15, -2], [16, -2], [17, -2]]) put(x, y, 'w');
      put(18, 0, 'W');
      break;
    case 'offline':
      vert();
      for (const [x, y] of [[16, -1], [15, 0], [16, 0], [15, 1], [16, 1]]) put(x, y, 'b');
      break;
    default: if (blink) line(3); else vert();
  }
  return px;
}

export const spriteHeight = widthPx => Math.round((widthPx * SPRITE_BOX.h) / SPRITE_BOX.w);

export function spriteSVG(mood, widthPx, opts) {
  let rects = '';
  for (const [key, col] of clawdPixels(mood, opts)) {
    const [x, y] = key.split(',');
    rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${COLORS[col]}"/>`;
  }
  const { minX, minY, w, h } = SPRITE_BOX;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${widthPx}" height="${spriteHeight(widthPx)}" shape-rendering="crispEdges">${rects}</svg>`;
}

// Is the point (in rendered pixels, relative to the sprite's top-left) on a drawn pixel?
export function isOpaque(mood, px, py, widthPx) {
  const cell = widthPx / SPRITE_BOX.w;
  if (px < 0 || py < 0 || px >= widthPx || py >= cell * SPRITE_BOX.h) return false;
  const gx = Math.floor(px / cell) + SPRITE_BOX.minX;
  const gy = Math.floor(py / cell) + SPRITE_BOX.minY;
  return clawdPixels(mood).has(`${gx},${gy}`);
}
