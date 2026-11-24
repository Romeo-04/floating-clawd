// Local cache + offline queue. Last write wins on updated_at (compared as instants).
// State: { rows: { [id]: Task }, pending: { [id]: Task } }  — pending = not yet confirmed by the server.

const t = iso => Date.parse(iso);

export const emptyState = () => ({ rows: {}, pending: {} });

export function applyLocal(state, row) {
  return {
    rows: { ...state.rows, [row.id]: row },
    pending: { ...state.pending, [row.id]: row },
  };
}

export function mergeRemote(state, remote) {
  const local = state.rows[remote.id];
  if (local && t(remote.updated_at) < t(local.updated_at)) return state;
  const pending = { ...state.pending };
  const p = pending[remote.id];
  if (p && t(p.updated_at) <= t(remote.updated_at)) delete pending[remote.id];
  return { rows: { ...state.rows, [remote.id]: remote }, pending };
}

export const pendingRows = state => Object.values(state.pending);

export function ackPending(state, sent) {
  const pending = { ...state.pending };
  for (const r of sent) {
    const p = pending[r.id];
    if (p && t(p.updated_at) === t(r.updated_at)) delete pending[r.id];
  }
  return { rows: state.rows, pending };
}
