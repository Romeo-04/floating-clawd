import { describe, it, expect } from 'vitest';
import { pickMood } from '../src/core/mood.js';
import { clawdPixels, isOpaque, spriteSVG, SPRITE_BOX } from '../src/core/sprite.js';

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
