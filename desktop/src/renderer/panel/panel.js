// Glass to-do panel. All data comes from main over window.clawd; this file only draws and forwards intents.
import { localDateISO, rolloverTag, validateTitle } from '../../core/today.js';
import { spriteSVG } from '../../core/sprite.js';

const api = window.clawd;
const $ = id => document.getElementById(id);

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  trash: '<path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13"/>',
  power: '<path d="M12 3v8"/><path d="M6.4 7.2a7.5 7.5 0 1 0 11.2 0"/>',
  grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/></g>',
};
const icon = (name, size, stroke = 2.2) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const SEGMENT_CAP = 12;
const ERROR_MS = 3000;

let state = { view: { open: [], done: [], total: 0, doneCount: 0 }, status: 'signed-out', lastSyncedAt: null };
let editingId = null;
let dragId = null;
let errorTimer = null;

document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon, 16); });
$('power').addEventListener('click', () => api.quit());
function drawClawds(color) {
  $('empty-clawd').innerHTML = spriteSVG('idle', 56, { color });
  $('auth-clawd').innerHTML = spriteSVG('sleepy', 88, { color });
}
drawClawds('orange');
const swatches = [...document.querySelectorAll('.swatch')];
swatches.forEach(b => b.addEventListener('click', () => api.setColor(b.dataset.color)));
api.onColor(color => {
  document.documentElement.dataset.color = color;
  drawClawds(color);
  swatches.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === color)));
});

// ---------- helpers ----------
function headerDate(d = new Date()) {
  return `${WEEKDAYS[d.getDay()]} · ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function relative(iso) {
  if (!iso) return 'just now';
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs} h ago` : 'over a day ago';
}

function showError(msg, el = $('error')) {
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { el.hidden = true; }, ERROR_MS);
}

function tagText(forDate) {
  const tag = rolloverTag(forDate, localDateISO(new Date()));
  if (!tag) return null;
  return tag === 'YESTERDAY' ? tag : `FROM ${tag}`;
}

// ---------- rendering ----------
function renderSeg({ total, doneCount }) {
  const seg = $('seg');
  if (total > SEGMENT_CAP) {
    seg.className = 'seg continuous';
    const fill = document.createElement('i');
    fill.style.transform = `scaleX(${doneCount / total})`;
    seg.replaceChildren(fill);
  } else {
    seg.className = 'seg';
    seg.innerHTML = Array.from({ length: total }, (_, i) => `<i${i < doneCount ? ' class="on"' : ''}></i>`).join('');
  }
}

function rowEl(task, isOpen) {
  const li = document.createElement('li');
  li.className = isOpen ? 'row' : 'row done';
  li.dataset.id = task.id;
  li.tabIndex = 0;

  if (isOpen) {
    const grip = document.createElement('span');
    grip.className = 'grip';
    grip.draggable = true;
    grip.title = 'Drag to reorder';
    grip.innerHTML = icon('grip', 12);
    li.append(grip);
  }

  const cb = document.createElement('button');
  cb.className = 'cb';
  cb.tabIndex = -1;
  cb.setAttribute('role', 'checkbox');
  cb.setAttribute('aria-checked', String(!isOpen));
  cb.setAttribute('aria-label', isOpen ? 'Mark done' : 'Mark not done');
  cb.innerHTML = icon('check', 11, 3);
  li.append(cb);

  if (editingId === task.id) {
    const input = document.createElement('input');
    input.className = 'edit';
    input.value = task.title;
    input.setAttribute('aria-label', 'Edit task');
    li.append(input);
  } else {
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = task.title;
    t.title = task.title;
    li.append(t);
  }

  const tag = isOpen ? tagText(task.for_date) : null;
  if (tag) {
    const chip = document.createElement('span');
    chip.className = 'tag';
    chip.textContent = tag;
    li.append(chip);
  }

  const trash = document.createElement('button');
  trash.className = 'trash';
  trash.tabIndex = -1;
  trash.setAttribute('aria-label', 'Delete task');
  trash.innerHTML = icon('trash', 14, 2);
  li.append(trash);
  return li;
}

function renderList() {
  const { view } = state;
  const focusedId = document.activeElement?.closest?.('.row')?.dataset.id;
  const editInput = document.querySelector('.edit');
  const draft = editInput ? { value: editInput.value, start: editInput.selectionStart, end: editInput.selectionEnd } : null;

  $('open-list').replaceChildren(...view.open.map(t => rowEl(t, true)));
  $('done-list').replaceChildren(...view.done.map(t => rowEl(t, false)));
  $('divider').hidden = view.doneCount === 0;
  $('divider').textContent = `DONE · ${view.doneCount}`;
  $('empty').hidden = view.total > 0;

  const edit = document.querySelector('.edit');
  if (edit) {
    if (draft) { edit.value = draft.value; edit.setSelectionRange(draft.start, draft.end); }
    edit.focus();
  } else if (editingId) {
    editingId = null; // the task disappeared while being edited
  } else if (focusedId) {
    document.querySelector(`.row[data-id="${CSS.escape(focusedId)}"]`)?.focus();
  }
}

function renderStatus() {
  const { status, lastSyncedAt } = state;
  const dot = $('dot');
  dot.className = 'dot';
  if (status === 'syncing') { dot.classList.add('syncing'); $('status').textContent = 'Syncing…'; }
  else if (status === 'synced') { $('status').textContent = `Synced · ${relative(lastSyncedAt)}`; }
  else { dot.classList.add('offline'); $('status').textContent = 'Offline — changes saved'; }
}

function render() {
  const signedOut = state.status === 'signed-out' || state.status === 'not-configured';
  $('list-view').hidden = signedOut;
  $('auth-view').hidden = !signedOut;
  $('date').textContent = $('auth-date').textContent = headerDate();

  if (signedOut) {
    const configured = state.status !== 'not-configured';
    $('auth-form').hidden = !configured;
    $('setup').hidden = configured;
    return;
  }

  const { view } = state;
  $('count').innerHTML = `<b>${view.doneCount}</b>/${view.total}`;
  renderSeg(view);
  $('all-done').hidden = !(view.total > 0 && view.open.length === 0);
  renderList();
  renderStatus();
}

// ---------- actions ----------
async function run(promise, errorEl) {
  const r = await promise;
  if (r && r.ok === false && r.error) showError(r.error, errorEl);
  return r;
}

$('add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const input = $('add-input');
  const v = validateTitle(input.value);
  if (!v.ok) return showError(v.error);
  input.value = '';
  const r = await run(api.add(v.title));
  if (r?.ok === false) input.value = v.title; // give the text back so nothing is lost
});

function startEdit(id) {
  editingId = id;
  renderList();
  document.querySelector('.edit')?.select();
}

async function commitEdit(input) {
  const id = editingId;
  if (!id) return;
  const v = validateTitle(input.value);
  if (!v.ok) { showError(v.error); input.focus(); return; }
  editingId = null;
  renderList();
  document.querySelector(`.row[data-id="${CSS.escape(id)}"]`)?.focus();
  await run(api.rename(id, v.title));
}

function cancelEdit() {
  const id = editingId;
  editingId = null;
  renderList();
  if (id) document.querySelector(`.row[data-id="${CSS.escape(id)}"]`)?.focus();
}

for (const list of [$('open-list'), $('done-list')]) {
  list.addEventListener('click', e => {
    const row = e.target.closest('.row');
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest('.cb')) run(api.toggle(id));
    else if (e.target.closest('.trash')) run(api.remove(id));
    else if (e.target.closest('.t')) startEdit(id);
  });

  list.addEventListener('keydown', e => {
    const input = e.target.closest('.edit');
    if (input) {
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(input); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelEdit(); }
      return;
    }
    const row = e.target.closest('.row');
    if (!row || e.target !== row) return;
    const id = row.dataset.id;
    if (e.key === ' ') { e.preventDefault(); run(api.toggle(id)); }
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(id); }
    else if (e.key === 'Delete') { e.preventDefault(); run(api.remove(id)); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const rows = [...document.querySelectorAll('.row')];
      rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
    }
  });

  list.addEventListener('focusout', e => {
    // A re-render swaps the input out; only a real blur (input still in the page) saves.
    if (e.target.classList?.contains('edit') && editingId && e.target.isConnected) commitEdit(e.target);
  });
}

// ---------- drag to reorder (open tasks only) ----------
const openList = $('open-list');
const clearDrop = () => openList.querySelectorAll('.drop-before, .drop-after').forEach(r => r.classList.remove('drop-before', 'drop-after'));

openList.addEventListener('dragstart', e => {
  const row = e.target.closest('.row');
  if (!row || !e.target.closest('.grip')) return e.preventDefault();
  dragId = row.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  e.dataTransfer.setDragImage(row, 16, 19);
  requestAnimationFrame(() => row.classList.add('dragging'));
});

openList.addEventListener('dragover', e => {
  if (!dragId) return;
  const row = e.target.closest('.row');
  e.preventDefault();
  clearDrop();
  if (!row || row.dataset.id === dragId) return;
  const r = row.getBoundingClientRect();
  row.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
});

openList.addEventListener('drop', e => {
  e.preventDefault();
  const target = openList.querySelector('.drop-before, .drop-after');
  if (!dragId || !target) return;
  const ids = state.view.open.map(t => t.id).filter(id => id !== dragId);
  let at = ids.indexOf(target.dataset.id);
  if (target.classList.contains('drop-after')) at += 1;
  ids.splice(at, 0, dragId);
  clearDrop();
  run(api.reorder(ids));
});

openList.addEventListener('dragend', () => {
  dragId = null;
  clearDrop();
  openList.querySelector('.dragging')?.classList.remove('dragging');
});

// ---------- sign in ----------
$('auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = $('sign-in');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  const r = await api.signIn($('email').value.trim(), $('password').value);
  btn.disabled = false;
  btn.textContent = 'Sign in';
  if (r?.ok === false) showError(r.error || 'Could not sign in', $('auth-error'));
  else $('password').value = '';
});

// ---------- window ----------
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !editingId) api.closePanel();
});

function focusEntry() {
  const signedOut = !$('auth-view').hidden;
  if (!signedOut) $('add-input').focus();
  else if (!$('auth-form').hidden) ($('email').value ? $('password') : $('email')).focus();
}

api.onState(s => { state = s; render(); });
api.onPanel(open => {
  if (open) { render(); focusEntry(); }
  else if (editingId) cancelEdit();
});

setInterval(() => { if (!$('list-view').hidden) { renderStatus(); $('date').textContent = headerDate(); } }, 30_000);

render();
api.ready();
