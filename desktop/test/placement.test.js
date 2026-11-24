import { describe, it, expect } from 'vitest';
import { panelPlacement, clampToWorkArea, clampSize } from '../src/core/placement.js';

const WA = { x: 0, y: 0, width: 1920, height: 1040 };
const PANEL = { width: 340, height: 520 };

describe('panelPlacement', () => {
  it('opens to the left when Clawd is at the right edge', () => {
    const p = panelPlacement({ x: 1780, y: 900, width: 120, height: 90 }, PANEL, WA);
    expect(p.side).toBe('left');
    expect(p.x).toBe(1780 - 12 - 340);
    expect(p.y).toBe(900 + 90 - 520);
  });

  it('opens to the right when there is no room on the left', () => {
    const p = panelPlacement({ x: 10, y: 600, width: 120, height: 90 }, PANEL, WA);
    expect(p.side).toBe('right');
    expect(p.x).toBe(10 + 120 + 12);
  });

  it('keeps the panel inside the top of the work area', () => {
    const p = panelPlacement({ x: 1000, y: 20, width: 120, height: 90 }, PANEL, WA);
    expect(p.y).toBe(0);
  });

  it('respects a work area that does not start at 0 (second monitor)', () => {
    const wa2 = { x: 1920, y: 0, width: 1280, height: 1000 };
    const p = panelPlacement({ x: 1930, y: 500, width: 120, height: 90 }, PANEL, wa2);
    expect(p.side).toBe('right');
    expect(p.x).toBeGreaterThanOrEqual(1920);
  });
});

describe('clampToWorkArea', () => {
  const R = { width: 104, height: 66 };

  it('keeps a position that is fully visible', () => {
    expect(clampToWorkArea({ ...R, x: 500, y: 500 }, [WA])).toEqual({ x: 500, y: 500 });
  });

  it('nudges a mostly visible Clawd fully inside', () => {
    expect(clampToWorkArea({ ...R, x: 1850, y: 500 }, [WA])).toEqual({ x: 1920 - 104, y: 500 });
  });

  it('moves Clawd from a removed monitor to the primary bottom-right', () => {
    expect(clampToWorkArea({ ...R, x: 3000, y: 400 }, [WA])).toEqual({ x: 1920 - 104 - 24, y: 1040 - 66 - 24 });
  });

  it('keeps Clawd on a second monitor that still exists', () => {
    const wa2 = { x: 1920, y: 0, width: 1280, height: 1000 };
    expect(clampToWorkArea({ ...R, x: 2500, y: 300 }, [WA, wa2])).toEqual({ x: 2500, y: 300 });
  });
});

describe('clampSize', () => {
  it('raises tiny sizes to 56', () => expect(clampSize(30)).toBe(56));
  it('caps huge sizes at 240', () => expect(clampSize(300)).toBe(240));
  it('keeps sizes in range', () => expect(clampSize(110)).toBe(110));
  it('rounds', () => expect(clampSize(110.6)).toBe(111));
  it('falls back to the default for junk', () => expect(clampSize(NaN)).toBe(104));
});
