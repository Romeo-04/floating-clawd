// Owns the task list on the laptop: local cache, offline queue, Supabase realtime + upload.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { buildView, localDateISO, validateTitle } from '../core/today.js';
import { emptyState, applyLocal, mergeRemote, pendingRows, ackPending } from '../core/merge.js';

const COLUMNS = ['id', 'title', 'done', 'done_at', 'for_date', 'position', 'created_at', 'updated_at', 'deleted'];
const pick = r => Object.fromEntries(COLUMNS.map(k => [k, r[k] ?? null]));
const HISTORY_DAYS = 14;

export class TaskSync extends EventEmitter {
  constructor({ client, settings, now = () => new Date(), timers = globalThis, retry = { min: 2000, max: 60000 } }) {
    super();
    Object.assign(this, { client, settings, now, timers, retry });
    this.state = settings.get('cache') ?? emptyState();
    this.status = 'signed-out';
    this.session = null;
    this.lastSyncedAt = null;
    this.channel = null;
    this.backoff = retry.min;
    this.retryTimer = null;
    this.flushing = null;
  }

  today() { return localDateISO(this.now()); }
  nowISO() { return this.now().toISOString(); }

  snapshot() {
    return {
      view: buildView(Object.values(this.state.rows), this.today()),
      status: this.status,
      lastSyncedAt: this.lastSyncedAt,
      email: this.session?.user?.email ?? null,
    };
  }

  emitState() { this.emit('state', this.snapshot()); }
  setStatus(s) { this.status = s; this.emitState(); }
  persist() { this.settings.set('cache', this.state); }

  async start() {
    this.client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        this.session = null;
        this.unsubscribe();
        this.setStatus('signed-out');
      } else {
        this.session = session;
      }
    });
    const { data } = await this.client.auth.getSession();
    if (data?.session) {
      this.session = data.session;
      await this.connect();
    } else {
      this.setStatus('signed-out');
    }
  }

  async connect() {
    this.setStatus('syncing');
    this.subscribe();
    await this.refresh();
    await this.flush();
  }

  subscribe() {
    if (this.channel) return;
    this.channel = this.client
      .channel('tasks')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, payload => {
        if (!payload.new?.id) return;
        this.state = mergeRemote(this.state, pick(payload.new));
        this.persist();
        this.emitState();
      })
      .subscribe(status => {
        if (status === 'SUBSCRIBED') { this.refresh().then(() => this.flush()); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { this.goOffline(); }
      });
  }

  unsubscribe() {
    if (this.channel) { this.client.removeChannel(this.channel); this.channel = null; }
  }

  async signIn(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    this.session = data.session;
    await this.connect();
    return { ok: true };
  }

  async signOut() {
    await this.client.auth.signOut();
    this.unsubscribe();
    this.session = null;
    this.state = emptyState();
    this.persist();
    this.setStatus('signed-out');
  }

  async refresh() {
    if (!this.session) return;
    const since = localDateISO(new Date(this.now().getTime() - HISTORY_DAYS * 86400000));
    const { data, error } = await this.client.from('tasks').select('*').or(`done.eq.false,for_date.gte.${since}`);
    if (error) { this.goOffline(); return; }
    for (const row of data ?? []) this.state = mergeRemote(this.state, pick(row));
    this.persist();
    this.emitState();
  }

  async flush() {
    if (!this.session) return;
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const rows = pendingRows(this.state);
      if (rows.length) {
        if (this.status !== 'syncing') this.setStatus('syncing');
        const { error } = await this.client.from('tasks').upsert(rows, { onConflict: 'id' });
        if (error) { this.goOffline(); return; }
        this.state = ackPending(this.state, rows);
        this.persist();
      }
      this.backoff = this.retry.min;
      this.lastSyncedAt = this.nowISO();
      this.setStatus('synced');
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  goOffline() {
    if (!this.session) return;
    this.setStatus('offline');
    if (this.retryTimer) return;
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      this.refresh().then(() => this.flush());
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, this.retry.max);
  }

  // Called by the app when the laptop wakes up or the network comes back.
  async wake() {
    if (this.retryTimer) { this.timers.clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.backoff = this.retry.min;
    await this.refresh();
    await this.flush();
  }

  async write(row) {
    this.state = applyLocal(this.state, { ...row, updated_at: this.nowISO() });
    this.persist();
    this.emitState();
    await this.flush();
  }

  async add(rawTitle) {
    const v = validateTitle(rawTitle);
    if (!v.ok) return v;
    const open = buildView(Object.values(this.state.rows), this.today()).open;
    const position = open.reduce((m, t) => Math.max(m, t.position), 0) + 1;
    const ts = this.nowISO();
    await this.write({
      id: randomUUID(), title: v.title, done: false, done_at: null, for_date: this.today(),
      position, created_at: ts, updated_at: ts, deleted: false,
    });
    return { ok: true };
  }

  async toggle(id) {
    const r = this.state.rows[id];
    if (!r) return { ok: false, error: 'Task not found' };
    const done = !r.done;
    await this.write({ ...r, done, done_at: done ? this.nowISO() : null });
    return { ok: true, done };
  }

  async rename(id, rawTitle) {
    const r = this.state.rows[id];
    if (!r) return { ok: false, error: 'Task not found' };
    const v = validateTitle(rawTitle);
    if (!v.ok) return v;
    if (v.title !== r.title) await this.write({ ...r, title: v.title });
    return { ok: true };
  }

  async remove(id) {
    const r = this.state.rows[id];
    if (!r) return { ok: false, error: 'Task not found' };
    await this.write({ ...r, deleted: true });
    return { ok: true };
  }

  async reorder(ids) {
    const ts = this.nowISO();
    ids.forEach((id, i) => {
      const r = this.state.rows[id];
      if (r && r.position !== i + 1) this.state = applyLocal(this.state, { ...r, position: i + 1, updated_at: ts });
    });
    this.persist();
    this.emitState();
    await this.flush();
    return { ok: true };
  }
}
