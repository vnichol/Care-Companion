// Read-only iCalendar feed of appointments, for "Subscribe in Calendar" on iPhone.
import { b64u } from './webpush.js';
import { localParts, wallMs } from './time.js';

const enc = new TextEncoder();

// The feed's private link token: derived from the family code, so changing the
// code also retires old calendar links. It grants read access to appointments only.
export async function calendarToken(familyCode) {
  const key = await crypto.subtle.importKey('raw', enc.encode(familyCode), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('calendar-feed-v1'));
  return b64u.encode(new Uint8Array(sig).slice(0, 24));
}

// Turn a wall-clock time in timeZone into a real UTC Date (handles DST).
export function zonedToUtc(date, time, timeZone) {
  const target = wallMs(date, time);
  let utc = target;
  for (let i = 0; i < 2; i++) {
    const seen = localParts(new Date(utc), timeZone).ms;
    utc += target - seen;
  }
  return new Date(utc);
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lines longer than 75 bytes must be folded (RFC 5545 §3.1).
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function buildCalendar(appts, timeZone, host) {
  const now = stamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Care Companion//Appointments//EN', 'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH', 'X-WR-CALNAME:Care appointments', `X-WR-TIMEZONE:${timeZone}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const a of appts) {
    const start = zonedToUtc(a.at.slice(0, 10), a.at.slice(11, 16), timeZone);
    const end = new Date(start.getTime() + 60 * 60e3);
    lines.push('BEGIN:VEVENT', `UID:appt-${a.id}@${host}`, `DTSTAMP:${now}`,
      `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`, `SUMMARY:${escape(a.title)}`);
    if (a.location) lines.push(`LOCATION:${escape(a.location)}`);
    if (a.notes) lines.push(`DESCRIPTION:${escape(a.notes)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
