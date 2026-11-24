import { describe, it, expect } from 'vitest';
import { buildView, rolloverTag, validateTitle, localDateISO } from '../src/core/today.js';

const TODAY = '2026-11-24'; // a Tuesday

let n = 0;
const task = (over = {}) => ({
  id: `t${++n}`, title: 'x', done: false, done_at: null, for_date: TODAY,
  position: n, created_at: `2026-11-24T08:00:0${n % 10}Z`, updated_at: '2026-11-24T08:00:00Z',
  deleted: false, ...over,
});

describe('buildView', () => {
  it('rolls an unfinished task from yesterday into open', () => {
    const t = task({ for_date: '2026-11-23' });
    const v = buildView([t], TODAY);
    expect(v.open.map(x => x.id)).toEqual([t.id]);
  });

  it('hides a finished task from yesterday and does not count it', () => {
    const t = task({ for_date: '2026-11-23', done: true, done_at: '2026-11-23T10:00:00Z' });
    const v = buildView([t], TODAY);
    expect(v.open).toEqual([]);
    expect(v.done).toEqual([]);
    expect(v.total).toBe(0);
  });

  it('excludes deleted tasks everywhere', () => {
    const v = buildView([task({ deleted: true }), task({ deleted: true, done: true, done_at: '2026-11-24T09:00:00Z' })], TODAY);
    expect(v.open).toEqual([]);
    expect(v.done).toEqual([]);
    expect(v.total).toBe(0);
  });

  it('counts 2 open + 3 done today as 3 of 5', () => {
    const tasks = [task(), task(),
      task({ done: true, done_at: '2026-11-24T09:00:00Z' }),
      task({ done: true, done_at: '2026-11-24T10:00:00Z' }),
      task({ done: true, done_at: '2026-11-24T11:00:00Z' })];
    const v = buildView(tasks, TODAY);
    expect(v.total).toBe(5);
    expect(v.doneCount).toBe(3);
  });

  it('sorts open by position and done by most recent first', () => {
    const a = task({ position: 2 }), b = task({ position: 1 });
    const d1 = task({ done: true, done_at: '2026-11-24T09:00:00Z' });
    const d2 = task({ done: true, done_at: '2026-11-24T11:00:00Z' });
    const v = buildView([a, b, d1, d2], TODAY);
    expect(v.open.map(x => x.id)).toEqual([b.id, a.id]);
    expect(v.done.map(x => x.id)).toEqual([d2.id, d1.id]);
  });

  it('counts a rolled-over task finished today as done today', () => {
    const t = task({ for_date: '2026-11-22', done: true, done_at: '2026-11-24T07:00:00' });
    const v = buildView([t], TODAY);
    expect(v.done.map(x => x.id)).toEqual([t.id]);
    expect(v.doneCount).toBe(1);
  });
});

describe('rolloverTag', () => {
  it('is null for today', () => expect(rolloverTag(TODAY, TODAY)).toBeNull());
  it('says YESTERDAY for one day back', () => expect(rolloverTag('2026-11-23', TODAY)).toBe('YESTERDAY'));
  it('uses the weekday within a week', () => expect(rolloverTag('2026-11-21', TODAY)).toBe('SAT'));
  it('uses month and day when older', () => expect(rolloverTag('2026-11-10', TODAY)).toBe('NOV 10'));
});

describe('localDateISO', () => {
  it('uses local time, not UTC', () => {
    expect(localDateISO(new Date(2026, 10, 24, 23, 59))).toBe('2026-11-24');
    expect(localDateISO(new Date(2026, 10, 24, 0, 1))).toBe('2026-11-24');
  });
});

describe('validateTitle', () => {
  it('rejects blank', () => expect(validateTitle('   ')).toEqual({ ok: false, error: 'Type something first' }));
  it('rejects over 200 characters', () =>
    expect(validateTitle('a'.repeat(201))).toEqual({ ok: false, error: 'Keep it under 200 characters' }));
  it('accepts exactly 200', () => expect(validateTitle('a'.repeat(200)).ok).toBe(true));
  it('trims and keeps emoji', () => expect(validateTitle('  hi 👋 ')).toEqual({ ok: true, title: 'hi 👋' }));
});
