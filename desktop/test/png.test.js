import { describe, it, expect } from 'vitest';
import { clawdIconPNG, encodeICO } from '../src/core/png.js';

describe('icons', () => {
  it('writes a PNG with the right size header', () => {
    const png = clawdIconPNG(32);
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(32);
    expect(png.readUInt32BE(20)).toBe(32);
  });

  it('packs PNGs into an ICO directory', () => {
    const ico = encodeICO([{ size: 32, png: clawdIconPNG(32) }, { size: 256, png: clawdIconPNG(256) }]);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico[6 + 16]).toBe(0); // 256 is stored as 0
  });
});
