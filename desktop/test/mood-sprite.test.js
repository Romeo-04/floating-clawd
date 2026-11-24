import { describe, it, expect } from 'vitest';
import { pickMood } from '../src/core/mood.js';
import { clawdPixels, isOpaque, spriteSVG, spriteRects, SPRITE_BOX, PALETTES } from '../src/core/sprite.js';

const base = { open: 2, done: 1, hour: 14, panelOpen: false, offline: false, idleMinutes: 0, justCompleted: false };
const mood = over => pickMood({ ...base, ...over });

describe('pickMood', () => {
  it('is idle by default', () => expect(mood({})).toBe('idle'));
  it('offline beats everything', () =>
    expect(mood({ offline: true, justCompleted: true, open: 0, panelOpen: true })).toBe('offline'));
  it('is happy right after a tick', () => expect(mood({ justCompleted: true, panelOpen: true })).toBe('happy'));
  it('celebrates when everything is done', () => expect(mood({ open: 0, done: 4, panelOpen: true })).toBe('celebrate'));
  it('does not celebrate an empty list', () => expect(mood({ open: 0, done: 0 })).toBe('idle'));
  it('types while the panel is open', () => expect(mood({ panelOpen: true, hour: 23 })).toBe('typing'));
  it('is sleepy late at night', () => expect(mood({ hour: 23 })).toBe('sleepy'));
  it('is sleepy before 5am', () => expect(mood({ hour: 3 })).toBe('sleepy'));
  it('is sleepy after 30 idle minutes', () => expect(mood({ idleMinutes: 30 })).toBe('sleepy'));
  it('fidgets only when it would otherwise be idle', () => {
    expect(mood({ fidget: 'wave' })).toBe('wave');
    expect(mood({ fidget: 'wave', panelOpen: true })).toBe('typing');
    expect(mood({ fidget: 'wave', hour: 23 })).toBe('sleepy');
    expect(mood({ fidget: 'wave', offline: true })).toBe('offline');
  });
  it('has coffee in the morning before the first tick', () => expect(mood({ hour: 8, done: 0 })).toBe('coffee'));
  it('stops the coffee once something is done', () => expect(mood({ hour: 8, done: 1 })).toBe('idle'));
});

describe('sprite', () => {
  it('draws idle eyes as 1x2 blocks', () => {
    const px = clawdPixels('idle');
    expect(px.get('4,2')).toBe('e');
    expect(px.get('11,3')).toBe('e');
  });

  it('has a blink frame without open eyes', () => {
    const px = clawdPixels('blink');
    expect(px.get('4,2')).not.toBe('e');
    expect(px.get('4,3')).toBe('e');
  });

  it('treats the body centre as opaque', () => {
    const w = 104, cell = w / SPRITE_BOX.w;
    expect(isOpaque('idle', (7 - SPRITE_BOX.minX + 0.5) * cell, (4 - SPRITE_BOX.minY + 0.5) * cell, w)).toBe(true);
  });

  it('treats the empty top-left corner as transparent', () => {
    expect(isOpaque('idle', 1, 1, 104)).toBe(false);
  });

  it('treats points outside the sprite as transparent', () => {
    expect(isOpaque('idle', -5, 10, 104)).toBe(false);
    expect(isOpaque('idle', 500, 10, 104)).toBe(false);
  });

  it('renders an svg at the requested width', () => {
    expect(spriteSVG('idle', 144)).toContain('width="144"');
  });
});

describe('blink overlay', () => {
  it('closes the eyes but keeps the laptop while typing', () => {
    const px = clawdPixels('typing', { blink: true });
    expect(px.get('2,6')).toBe('k');          // laptop still there
    expect(px.get('3,4')).toBe('e');          // eye line
    expect(px.get('4,3')).toBe('o');          // open eye pixel back to body
  });
  it('idle blink matches the blink frame', () => {
    expect([...clawdPixels('idle', { blink: true })]).toEqual([...clawdPixels('blink')]);
  });
});

describe('spriteRects (window shape)', () => {
  const MOODS = ['idle', 'happy', 'celebrate', 'typing', 'coffee', 'sleepy', 'offline', 'wave', 'look-left', 'look-right'];
  const inside = (rects, x, y) => rects.some(r => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);

  for (const m of MOODS) for (const w of [72, 104, 160]) {
    it(`covers exactly the drawn pixels for ${m} at ${w}px`, () => {
      const rects = spriteRects(m, w);
      const cell = w / SPRITE_BOX.w;
      for (const r of rects) for (const v of [r.x, r.y, r.width, r.height]) expect(Number.isInteger(v)).toBe(true);
      for (let gy = SPRITE_BOX.minY; gy < SPRITE_BOX.minY + SPRITE_BOX.h; gy++) {
        for (let gx = SPRITE_BOX.minX; gx < SPRITE_BOX.minX + SPRITE_BOX.w; gx++) {
          const cx = (gx - SPRITE_BOX.minX + 0.5) * cell, cy = (gy - SPRITE_BOX.minY + 0.5) * cell;
          expect(inside(rects, cx, cy)).toBe(clawdPixels(m).has(`${gx},${gy}`));
        }
      }
    });
  }

  it('merges each row into runs instead of one rect per pixel', () => {
    expect(spriteRects('idle', 104).length).toBeLessThan(clawdPixels('idle').size / 3);
  });
});

describe('fidgets and colours', () => {
  it('waves with the right arm raised', () => {
    const px = clawdPixels('wave');
    expect(px.has('15,1')).toBe(true);
    expect(px.has('15,5')).toBe(false);
    expect(px.has('0,4')).toBe(true); // left arm stays down
  });
  it('looks left and right by moving the eyes', () => {
    expect(clawdPixels('look-left').get('3,2')).toBe('e');
    expect(clawdPixels('look-right').get('5,2')).toBe('e');
    expect(clawdPixels('look-left').get('4,2')).not.toBe('e');
  });
  it('draws orange by default and pink on request', () => {
    expect(spriteSVG('idle', 104)).toContain(PALETTES.orange.o);
    const pink = spriteSVG('idle', 104, { color: 'pink' });
    expect(pink).toContain(PALETTES.pink.o);
    expect(pink).not.toContain(PALETTES.orange.o);
  });
  it('falls back to orange for an unknown colour', () =>
    expect(spriteSVG('idle', 104, { color: 'nope' })).toContain(PALETTES.orange.o));
});
