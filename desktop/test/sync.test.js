import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskSync } from '../src/main/sync.js';
import { createSettings } from '../src/main/settings.js';

const NOW = new Date(2026, 10, 24, 9, 30);

function memorySettings() {
  const data = {}, secrets = {};
  return {
    get: k => data[k], set: (k, v) => { data[k] = v; },
    getSecret: k => secrets[k] ?? null, setSecret: (k, v) => { if (v == null) delete secrets[k]; else secrets[k] = v; },
  };
}

function fakeClient({ session = { user: { email: 'me@example.com' } }, sessionError = null } = {}) {
  let authCb = null;
  const client = {
    upserts: [], failUpserts: false, failSelect: false, remoteRows: [], holdUpsert: null, filters: [],
    signOutCalls: [], signOutError: null,
    auth: {
      getSession: async () => ({ data: { session }, error: sessionError }),
      onAuthStateChange: cb => { authCb = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithPassword: async ({ email, password }) => password === 'right'
        ? { data: { session: { user: { email } } }, error: null }
        : { data: { session: null }, error: { message: 'Invalid login credentials' } },
      signOut: async opts => {
        client.signOutCalls.push(opts);
        if (client.signOutError) return { error: client.signOutError };
        authCb?.('SIGNED_OUT', null);
        return { error: null };
      },
    },
    emitAuth: (event, s) => authCb(event, s),
    from: () => ({
      upsert: async rows => {
        if (client.holdUpsert) await client.holdUpsert;
        if (client.failUpserts) return { error: { message: 'TypeError: fetch failed' } };
        client.upserts.push(rows);
        return { error: null };
      },
      select: () => ({ or: async f => {
        client.filters.push(f);
        return client.failSelect ? { data: null, error: { message: 'fetch failed' } } : { data: client.remoteRows, error: null };
      } }),
    }),
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel() {},
  };
  return client;
}

const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };

async function started(client = fakeClient(), settings = memorySettings(), extra = {}) {
  const sync = new TaskSync({ client, settings, now: () => NOW, timers: noTimers, ...extra });
  const states = [];
  sync.on('state', s => states.push(s));
  await sync.start();
  return { sync, client, settings, states, last: () => states.at(-1) };
}

describe('TaskSync', () => {
  it('rejects a blank task and writes nothing', async () => {
    const { sync, client, last } = await started();
    expect(await sync.add('   ')).toEqual({ ok: false, error: 'Type something first' });
    expect(client.upserts).toHaveLength(0);
    expect(last().view.total).toBe(0);
  });

  it('adds a task for today, shows syncing then synced', async () => {
    const { sync, client, states, last } = await started();
    const before = states.length;
    expect(await sync.add('Buy milk')).toEqual({ ok: true });
    const statuses = states.slice(before).map(s => s.status);
    expect(statuses).toContain('syncing');
    expect(last().status).toBe('synced');
    expect(last().view.open.map(t => t.title)).toEqual(['Buy milk']);
    expect(client.upserts.at(-1)[0]).toMatchObject({ title: 'Buy milk', for_date: '2026-11-24', done: false });
  });

  it('goes offline and keeps the change queued when the upload fails', async () => {
    const { sync, client, settings, last } = await started();
    client.failUpserts = true;
    await sync.add('Pay bill');
    expect(last().status).toBe('offline');
    expect(Object.keys(settings.get('cache').pending)).toHaveLength(1);
    client.failUpserts = false;
    await sync.flush();
    expect(last().status).toBe('synced');
    expect(Object.keys(settings.get('cache').pending)).toHaveLength(0);
  });

  it('shows signed-out but keeps cached tasks when the session ends', async () => {
    const { sync, client, last } = await started();
    await sync.add('Keep me');
    client.emitAuth('SIGNED_OUT', null);
    expect(last().status).toBe('signed-out');
    expect(last().view.open.map(t => t.title)).toEqual(['Keep me']);
  });

  it('starts signed-out without a session', async () => {
    const { last } = await started(fakeClient({ session: null }));
    expect(last().status).toBe('signed-out');
  });

  it('reports a wrong password', async () => {
    const { sync } = await started(fakeClient({ session: null }));
    expect(await sync.signIn('me@example.com', 'nope')).toEqual({ ok: false, error: 'Invalid login credentials' });
  });

  it('signs in and syncs', async () => {
    const { sync, last } = await started(fakeClient({ session: null }));
    expect(await sync.signIn('me@example.com', 'right')).toEqual({ ok: true });
    expect(last().status).toBe('synced');
  });

  it('toggles done and back', async () => {
    const { sync, last } = await started();
    await sync.add('Run');
    const id = last().view.open[0].id;
    await sync.toggle(id);
    expect(last().view.done[0]).toMatchObject({ id, done: true });
    expect(last().view.done[0].done_at).toBeTruthy();
    await sync.toggle(id);
    expect(last().view.open[0]).toMatchObject({ id, done: false, done_at: null });
  });

  it('renames with validation and soft-deletes', async () => {
    const { sync, client, last } = await started();
    await sync.add('Old');
    const id = last().view.open[0].id;
    expect((await sync.rename(id, '')).ok).toBe(false);
    await sync.rename(id, 'New');
    expect(last().view.open[0].title).toBe('New');
    await sync.remove(id);
    expect(last().view.total).toBe(0);
    expect(client.upserts.at(-1)[0]).toMatchObject({ id, deleted: true });
  });

  it('reorders open tasks', async () => {
    const { sync, last } = await started();
    await sync.add('A'); await sync.add('B'); await sync.add('C');
    const ids = last().view.open.map(t => t.id);
    await sync.reorder([ids[2], ids[0], ids[1]]);
    expect(last().view.open.map(t => t.title)).toEqual(['C', 'A', 'B']);
  });

  it('merges rows from the server on refresh', async () => {
    const client = fakeClient();
    client.remoteRows = [{ id: 'r1', title: 'From phone', done: false, done_at: null, for_date: '2026-11-24',
      position: 1, created_at: '2026-11-24T01:00:00Z', updated_at: '2026-11-24T01:00:00Z', deleted: false }];
    const { last } = await started(client);
    expect(last().view.open.map(t => t.title)).toEqual(['From phone']);
  });
});

describe('TaskSync review fixes', () => {
  it('sends an edit made while another upload is in flight', async () => {
    const { sync, client, settings, last } = await started();
    let release;
    client.holdUpsert = new Promise(r => { release = r; });
    const first = sync.add('First');
    const second = sync.add('Second');
    client.holdUpsert = null;
    release();
    await Promise.all([first, second]);
    expect(client.upserts.flat().map(r => r.title)).toEqual(['First', 'Second']);
    expect(Object.keys(settings.get('cache').pending)).toHaveLength(0);
    expect(last().status).toBe('synced');
  });

  it('stays offline when the refresh fails and nothing is queued', async () => {
    const client = fakeClient();
    client.failSelect = true;
    const { states, last } = await started(client);
    expect(last().status).toBe('offline');
    expect(states.map(s => s.status)).not.toContain('synced');
    expect(last().lastSyncedAt).toBeNull();
  });

  it('keeps the cached list offline when the session cannot refresh at boot, then reconnects', async () => {
    const settings = memorySettings();
    settings.set('cache', { rows: { a: { id: 'a', title: 'Cached', done: false, done_at: null, for_date: '2026-11-24',
      position: 1, created_at: '2026-11-24T01:00:00Z', updated_at: '2026-11-24T01:00:00Z', deleted: false } }, pending: {} });
    const client = fakeClient({ session: null, sessionError: { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 } });
    const { last } = await started(client, settings);
    expect(last().status).toBe('offline');
    expect(last().view.open.map(t => t.title)).toEqual(['Cached']);
    client.emitAuth('TOKEN_REFRESHED', { user: { email: 'me@example.com' } });
    await new Promise(r => setTimeout(r, 0));
    expect(last().status).toBe('synced');
  });

  it('ignores a null INITIAL_SESSION event instead of signing out', async () => {
    const { client, last } = await started();
    client.emitAuth('INITIAL_SESSION', null);
    expect(last().status).toBe('synced');
  });

  it('signs out of this device only, and forgets the session even when offline', async () => {
    let cleared = 0;
    const client = fakeClient();
    const { sync, last } = await started(client, memorySettings(), { clearSession: () => { cleared++; } });
    client.signOutError = { name: 'AuthRetryableFetchError', message: 'fetch failed', status: 0 };
    await sync.signOut();
    expect(client.signOutCalls.at(-1)).toEqual({ scope: 'local' });
    expect(cleared).toBe(1);
    expect(last().status).toBe('signed-out');
  });

  it('counts unsent edits so sign-out can warn', async () => {
    const { sync, client } = await started();
    client.failUpserts = true;
    await sync.add('Unsent');
    expect(sync.pendingCount()).toBe(1);
  });

  it('refresh also fetches recently changed old tasks', async () => {
    const { client } = await started();
    expect(client.filters.at(-1)).toMatch(/updated_at\.gte\.2026-11-10T/);
  });

  it('treats unknown ids (including __proto__) as not found', async () => {
    const { sync } = await started();
    expect(await sync.toggle('__proto__')).toEqual({ ok: false, error: 'Task not found' });
    expect(await sync.remove('constructor')).toEqual({ ok: false, error: 'Task not found' });
  });
});

describe('createSettings', () => {
  const fakeCrypto = {
    isEncryptionAvailable: () => true,
    encryptString: s => Buffer.from([...s].reverse().join(''), 'utf8'),
    decryptString: b => [...b.toString('utf8')].reverse().join(''),
  };

  it('persists values and secrets across instances, secrets not in plain text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawd-'));
    const a = createSettings({ dir, crypto: fakeCrypto });
    a.set('clawdSize', 144);
    a.setSecret('sb-session', 'TOPSECRET');
    const b = createSettings({ dir, crypto: fakeCrypto });
    expect(b.get('clawdSize')).toBe(144);
    expect(b.getSecret('sb-session')).toBe('TOPSECRET');
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).not.toContain('TOPSECRET');
  });

  it('clears secrets by prefix', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawd-'));
    const a = createSettings({ dir, crypto: fakeCrypto });
    a.setSecret('sb:token', 'x'); a.setSecret('other', 'y');
    a.clearSecrets('sb:');
    expect(a.getSecret('sb:token')).toBeNull();
    expect(a.getSecret('other')).toBe('y');
  });

  it('starts empty when the file is corrupt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawd-'));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'settings.json'), '{oops');
    expect(createSettings({ dir, crypto: fakeCrypto }).get('clawdSize')).toBeUndefined();
  });
});
