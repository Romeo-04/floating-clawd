// Tiny PNG/ICO writer for Clawd icons (no image libraries needed).
import { deflateSync, crc32 } from 'node:zlib';
import { clawdPixels, colorsFor } from './sprite.js';

const hexToRGBA = hex => {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return [245, 239, 230, 140];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
};

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

export function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Square icon of Clawd's body (grid x 0..15, y 0..9), centred.
export function clawdIconPNG(size, mood = 'idle', color = 'orange') {
  const colors = colorsFor(color);
  const scale = Math.floor(size / 16);
  const rgba = Buffer.alloc(size * size * 4);
  const offX = Math.floor((size - 16 * scale) / 2);
  const offY = Math.floor((size - 10 * scale) / 2);
  for (const [key, col] of clawdPixels(mood)) {
    const [gx, gy] = key.split(',').map(Number);
    if (gx < 0 || gx > 15 || gy < 0 || gy > 9) continue;
    const [r, g, b, a] = hexToRGBA(colors[col]);
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const x = offX + gx * scale + dx, y = offY + gy * scale + dy;
      const i = (y * size + x) * 4;
      rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = a;
    }
  }
  return encodePNG(size, size, rgba);
}

export function encodeICO(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map(p => p.png)]);
}
