import { describe, it, expect } from 'vitest';
import { emptyState, applyLocal, mergeRemote, pendingRows, ackPending } from '../src/core/merge.js';

const row = (updated_at, over = {}) => ({
  id: 'a', title: 'Run', done: false, done_at: null, for_date: '2026-11-24', position: 1,
  created_at: '2026-11-24T08:00:00Z', updated_at, deleted: false, ...over,
});

describe('merge', () => {
  it('keeps an offline local edit when an older remote edit arrives', () => {
    let s = applyLocal(emptyState(), row('2026-11-24T10:05:00.000Z', { done: true }));
    s = mergeRemote(s, row('2026-11-24T10:00:00+00:00', { title: 'Old' }));
    expect(s.rows.a.done).toBe(true);
    expect(pendingRows(s)).toHaveLength(1);
  });

  it('lets a newer remote edit win and clears the pending one', () => {
    let s = applyLocal(emptyState(), row('2026-11-24T10:05:00.000Z', { done: true }));
    s = mergeRemote(s, row('2026-11-24T10:10:00+00:00', { done: false, title: 'Phone' }));
    expect(s.rows.a.title).toBe('Phone');
    expect(pendingRows(s)).toHaveLength(0);
  });

  it('treats the same instant in different formats as equal (server echo)', () => {
    let s = applyLocal(emptyState(), row('2026-11-24T10:05:00.123Z', { done: true }));
    s = mergeRemote(s, row('2026-11-24T10:05:00.123+00:00', { done: true }));
    expect(s.rows.a.done).toBe(true);
    expect(pendingRows(s)).toHaveLength(0);
  });

  it('keeps one pending row per task (the latest)', () => {
    let s = applyLocal(emptyState(), row('2026-11-24T10:00:00.000Z', { title: 'A' }));
    s = applyLocal(s, row('2026-11-24T10:01:00.000Z', { title: 'B' }));
    expect(pendingRows(s)).toEqual([expect.objectContaining({ title: 'B' })]);
  });

  it('does not clear a newer pending edit when an older version is acked', () => {
    const v1 = row('2026-11-24T10:00:00.000Z', { title: 'A' });
    let s = applyLocal(emptyState(), v1);
    s = applyLocal(s, row('2026-11-24T10:01:00.000Z', { title: 'B' }));
    s = ackPending(s, [v1]);
    expect(pendingRows(s)).toEqual([expect.objectContaining({ title: 'B' })]);
  });

  it('clears pending when the sent version is acked', () => {
    const v1 = row('2026-11-24T10:00:00.000Z');
    let s = ackPending(applyLocal(emptyState(), v1), [v1]);
    expect(pendingRows(s)).toHaveLength(0);
  });

  it('does not mutate the previous state', () => {
    const s0 = emptyState();
    applyLocal(s0, row('2026-11-24T10:00:00.000Z'));
    expect(s0).toEqual({ rows: {}, pending: {} });
  });
});

describe('timestamp formats from Postgres/Realtime', () => {
  it('compares short +00 offsets and space separators as instants', () => {
    const local = { id: 'a', title: 'Local', updated_at: '2026-11-24T10:00:00.000Z' };
    const state = { rows: { a: local }, pending: {} };
    const older = { id: 'a', title: 'Stale echo', updated_at: '2026-11-24T09:00:00.123456+00' };
    expect(mergeRemote(state, older).rows.a.title).toBe('Local');
    const olderSpaced = { id: 'a', title: 'Stale echo', updated_at: '2026-11-24 09:00:00.123456+00' };
    expect(mergeRemote(state, olderSpaced).rows.a.title).toBe('Local');
  });
});
