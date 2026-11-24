// "Today" rules shared by the panel and Clawd's mood.
// Visible = tasks for today + unfinished tasks from earlier days. Never deleted ones.

const pad = n => String(n).padStart(2, '0');

export function localDateISO(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const isoToUTC = iso => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

const doneToday = (t, today) =>
  t.for_date === today || (t.done_at != null && localDateISO(new Date(t.done_at)) === today);

export function buildView(tasks, today) {
  const live = tasks.filter(t => !t.deleted);
  const open = live
    .filter(t => !t.done && t.for_date <= today)
    .sort((a, b) => a.position - b.position || String(a.created_at).localeCompare(String(b.created_at)));
  const done = live
    .filter(t => t.done && doneToday(t, today))
    .sort((a, b) => String(b.done_at ?? '').localeCompare(String(a.done_at ?? '')));
  return { open, done, total: open.length + done.length, doneCount: done.length };
}

const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function rolloverTag(forDate, today) {
  const days = Math.round((isoToUTC(today) - isoToUTC(forDate)) / 86400000);
  if (days <= 0) return null;
  if (days === 1) return 'YESTERDAY';
  const d = new Date(isoToUTC(forDate));
  if (days <= 6) return WEEKDAYS[d.getUTCDay()];
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

export const MAX_TITLE = 200;

export function validateTitle(raw) {
  const title = String(raw ?? '').trim();
  if (!title) return { ok: false, error: 'Type something first' };
  // Count code points like Postgres char_length, so emoji count once.
  if ([...title].length > MAX_TITLE) return { ok: false, error: 'Keep it under 200 characters' };
  return { ok: true, title };
}
