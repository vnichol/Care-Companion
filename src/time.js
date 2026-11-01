// Wall-clock helpers. Times are kept as local "YYYY-MM-DD" / "HH:MM" strings in the
// household's time zone; wallMs turns them into comparable numbers (not real UTC).

export function localParts(date, timeZone) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const d = `${p.year}-${p.month}-${p.day}`;
  const t = `${p.hour}:${p.minute}`;
  return { date: d, time: t, ms: wallMs(d, t) };
}

export const wallMs = (d, t) => Date.parse(`${d}T${t.slice(0, 5)}:00Z`);

export const addDays = (d, n) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();

export function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

export function fmtDate(d) {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

// Is this medication scheduled on date d?
export function medOnDate(med, d) {
  if (med.start_date && d < med.start_date) return false;
  if (med.end_date && d > med.end_date) return false;
  // Every N days, counted from the start date (e.g. every other day).
  const every = Number(med.interval_days) || 0;
  if (every > 1 && med.start_date && Math.round((Date.parse(d) - Date.parse(med.start_date)) / 864e5) % every !== 0) return false;
  const days = typeof med.days === 'string' ? JSON.parse(med.days) : med.days;
  return !days.length || days.includes(weekday(d));
}
