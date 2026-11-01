// Care Companion: medications, appointments and notes shared between two people.

import { lookupMedInfo, editDistance } from './medinfo.js';

// ---------- small helpers ----------

const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  }
  return el;
}

const ICONS = {
  today: '<path d="M4 7h16M7 3v4m10-4v4M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm4 9 2 2 4-4"/>',
  meds: '<path d="m10.5 20.5-7-7a4.95 4.95 0 0 1 7-7l7 7a4.95 4.95 0 0 1-7 7ZM7 10l7 7"/>',
  appts: '<path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/>',
  notes: '<path d="M5 4h10l4 4v12H5V4Zm10 0v4h4M8 12h8M8 16h5"/>',
  report: '<path d="M4 20V11m5.3 9V5m5.4 15v-6m5.3 6V8M3 20h18"/>',
  settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
};
function icon(name) {
  const span = h('span', { class: 'icon', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `show${isError ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, isError ? 5000 : 2500);
}

// ---------- time (in the household's time zone) ----------

const deviceTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const tz = () => S.state?.timezone || deviceTz();
const wallMs = (d, t) => Date.parse(`${d}T${t.slice(0, 5)}:00Z`);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const weekday = (d) => new Date(`${d}T00:00:00Z`).getUTCDay();
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function localNow() {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(new Date()).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, time: `${p.hour}:${p.minute}`, seconds: `${p.hour}:${p.minute}:${p.second}`, ms: wallMs(date, `${p.hour}:${p.minute}`), hour: Number(p.hour) };
}

function fmtTime(t) {
  const [hh, mm] = t.split(':').map(Number);
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}
const fmtDate = (d, opts = { weekday: 'long', month: 'long', day: 'numeric' }) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
const fmtStamp = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: tz(), hour: 'numeric', minute: '2-digit' });

function medOnDate(med, d) {
  if (med.start_date && d < med.start_date) return false;
  if (med.end_date && d > med.end_date) return false;
  // Every N days, counted from the start date (e.g. every other day).
  const every = Number(med.interval_days) || 0;
  if (every > 1 && med.start_date && Math.round((Date.parse(d) - Date.parse(med.start_date)) / 864e5) % every !== 0) return false;
  return !med.days.length || med.days.includes(weekday(d));
}

// Pharmacy blister-pack slot codes.
const PACK_NAMES = { BK: 'Breakfast', LU: 'Lunch', SP: 'Supper', BD: 'Bedtime', HS: 'Bedtime' };
const packName = (code) => PACK_NAMES[code] || code;
const slotOf = (med, t) => (med.slots || [])[med.times.indexOf(t)] || '';

function scheduleText(med) {
  if (med.kind === 'clinic') return `Given at the clinic${med.days.length ? ` · ${med.days.map((d) => DAY_NAMES[d]).join(', ')}` : ''}`;
  if (med.as_needed) return 'As needed';
  const every = Number(med.interval_days) || 0;
  const days = every > 1 ? `Every ${every === 2 ? 'other day' : `${every} days`}`
    : !med.days.length ? 'Every day' : med.days.map((d) => DAY_NAMES[d]).join(', ');
  const times = med.times.map((t) => (slotOf(med, t) ? `${fmtTime(t)} (${packName(slotOf(med, t))} pack)` : fmtTime(t)));
  return `${times.join(', ')} · ${days}`;
}

// The day a medication was added, in the household's time zone.
const medStartDay = (m) => new Date(`${m.created_at.replace(' ', 'T')}Z`).toLocaleDateString('en-CA', { timeZone: tz() });

// A day's doses: what the current schedules say, plus anything logged at other times.
function doseSlots(day) {
  const logs = S.state.logs.filter((l) => l.date === day && l.time.length === 5);
  const slots = [];
  for (const med of S.state.meds) {
    if (med.as_needed || !med.active || day < medStartDay(med) || !medOnDate(med, day)) continue;
    for (const t of med.times) slots.push({ med, t, log: logs.find((l) => l.med_id === med.id && l.time === t) });
  }
  for (const log of logs) {
    const med = S.state.meds.find((m) => m.id === log.med_id);
    if (med && !med.as_needed && !slots.some((s) => s.log === log)) slots.push({ med, t: log.time, log });
  }
  return slots.sort((a, b) => a.t.localeCompare(b.t) || a.med.name.localeCompare(b.med.name));
}

// taken | skipped | missed (30+ minutes past with nothing logged) | upcoming
function slotStatus(slot, day, now) {
  if (slot.log) return slot.log.status;
  return now.ms - wallMs(day, slot.t) > 30 * 60e3 ? 'missed' : 'upcoming';
}

const needsRefill =(m) => m.active && m.pills_left != null && m.refill_at != null && m.pills_left <= m.refill_at;
const fmtCount = (n) => (Number.isInteger(n) ? n : Number(n.toFixed(1)));

// ---------- state & API ----------

const params = new URLSearchParams(location.search);
const S = {
  code: store.get('code'),
  name: store.get('name') || '',
  state: (() => { try { return JSON.parse(store.get('state') || 'null'); } catch { return null; } })(),
  tab: ['today', 'meds', 'appts', 'notes', 'report', 'settings'].includes(params.get('tab')) ? params.get('tab') : 'today',
  day: null,
  sub: null,
  noteDraft: { text: '', feeling: null },
  openPain: params.get('pain') === '1',
  needsSetup: false,
};
const who = () => S.state?.patientName || 'the patient';

async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method,
      headers: { Authorization: `Bearer ${S.code}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    signOut();
    throw new Error('That family code was not accepted.');
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

async function refresh({ quiet = true } = {}) {
  if (!S.code) return;
  try {
    S.state = await api('state');
    store.set('state', JSON.stringify(S.state));
    if (!S.state.timezone) {
      await api('settings', { method: 'POST', body: { timezone: deviceTz() } });
      S.state.timezone = deviceTz();
    }
  } catch (e) {
    if (!quiet) toast(e.message, true);
  }
  render();
  // Opened from a "rate your pain" notification: go straight to the rating.
  if (S.openPain && S.state?.pain) {
    S.openPain = false;
    history.replaceState(null, '', '/');
    openPainSheet();
  }
}

async function mutate(path, opts, okMsg) {
  try {
    await api(path, opts);
    await refresh();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    toast(e.message, true);
    return false;
  }
}

function signOut() {
  S.code = null; S.state = null;
  store.set('code', null); store.set('state', null);
  render();
  checkSetup();
}

// ---------- rendering ----------

function render() {
  // Don't yank the page out from under someone who is typing.
  const active = document.activeElement;
  if (S.code && S.state && active && $('#app main')?.contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return;

  const app = $('#app');
  const scroll = window.scrollY;
  app.replaceChildren();
  if (!S.code) { app.append(S.needsSetup ? viewSetup() : viewLogin()); return; }
  if (!S.state) { app.append(h('div', { class: 'loading' }, 'Loading…')); return; }
  const views = { today: viewToday, meds: viewMeds, appts: viewAppts, notes: viewNotes, report: viewReport, settings: viewSettings };
  app.append(h('main', { class: 'main' }, views[S.tab]()), tabbar());
  window.scrollTo(0, scroll);
}

function setTab(tab) {
  S.tab = tab;
  if (tab !== 'today') S.day = null;
  history.replaceState(null, '', tab === 'today' ? '/' : `/?tab=${tab}`);
  render();
  window.scrollTo(0, 0);
}

function tabbar() {
  const tabs = [['today', 'Today'], ['meds', 'Meds'], ['appts', 'Visits'], ['notes', 'Notes'], ['report', 'Report'], ['settings', 'Settings']];
  return h('nav', { class: 'tabbar', 'aria-label': 'Sections' },
    tabs.map(([id, label]) => h('button', {
      class: `tab${S.tab === id ? ' active' : ''}`, 'aria-current': S.tab === id ? 'page' : null,
      onclick: () => setTab(id),
    }, icon(id), h('span', {}, label))));
}

const header = (title, sub, extra) => h('header', { class: 'page-head' },
  h('div', {}, sub ? h('p', { class: 'eyebrow' }, sub) : null, h('h1', {}, title)), extra);

const section = (title, ...kids) => h('section', { class: 'section' }, title ? h('h2', { class: 'section-title' }, title) : null, kids);

const empty = (text, action) => h('div', { class: 'empty' }, h('p', {}, text), action);

// ---------- login ----------

function viewLogin() {
  const submit = async (e) => {
    e.preventDefault();
    const form = e.target;
    const code = form.code.value.trim();
    const name = form.name.value.trim();
    if (!code || !name) return toast('Please fill in both boxes.', true);
    S.code = code;
    form.querySelector('button').disabled = true;
    try {
      S.state = await api('state');
      store.set('code', code); store.set('name', name); S.name = name;
      store.set('state', JSON.stringify(S.state));
      await refresh();
    } catch (err) {
      S.code = null;
      form.querySelector('button').disabled = false;
      toast(err.message, true);
    }
  };
  return h('div', { class: 'login' },
    h('img', { src: '/icons/icon-192.png', alt: '', class: 'login-icon' }),
    h('h1', {}, 'Care Companion'),
    h('p', { class: 'muted' }, 'Medications, appointments and notes, shared with everyone who helps.'),
    h('form', { class: 'card form', onsubmit: submit },
      field('Family code', h('input', { name: 'code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'XXXX-XXXX-XXXX' })),
      field('Your first name', h('input', { name: 'name', autocomplete: 'given-name', placeholder: 'So we know who checked things off' })),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Open')),
    h('p', { class: 'center' }, h('a', { href: '/help' }, 'How to use Care')));
}

// ---------- first-run setup ----------

// A new copy of Care has no family code yet: ask whether it needs setting up (no sign-in needed).
async function checkSetup() {
  try {
    const r = await fetch('/api/setup').then((res) => res.json());
    if (r.error) return toast(r.error, true);
    S.needsSetup = !!r.needsSetup;
    render();
  } catch { /* offline: the sign-in screen still works */ }
}

const makeCode = () => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint8Array(12))].map((b) => abc[b % abc.length]).join('').match(/.{4}/g).join('-');
};

function viewSetup() {
  const submit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const code = f.code.value.trim().toUpperCase();
    const name = f.name.value.trim();
    if (!f.patient.value.trim() || !name) return toast('Please fill in both names.', true);
    if (code.replace(/[^A-Z0-9]/g, '').length < 8) return toast('The family code needs at least 8 letters or numbers.', true);
    f.querySelector('button[type=submit]').disabled = true;
    try {
      const res = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, patient_name: f.patient.value, timezone: deviceTz(), temp_unit: f.unit.value }) });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(r.error || 'Setup didn’t work. Try again.');
      S.code = code; S.name = name; S.needsSetup = false;
      store.set('code', code); store.set('name', name);
      await refresh({ quiet: false });
      toast('Care is ready');
    } catch (err) {
      f.querySelector('button[type=submit]').disabled = false;
      toast(err.message, true);
    }
  };
  const codeIn = h('input', { name: 'code', value: makeCode(), autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
  return h('div', { class: 'login' },
    h('img', { src: '/icons/icon-192.png', alt: '', class: 'login-icon' }),
    h('h1', {}, 'Welcome to Care'),
    h('p', { class: 'muted' }, 'A few details to finish setting up. This takes a minute and only happens once.'),
    h('form', { class: 'card form', onsubmit: submit },
      field('Who is Care for?', h('input', { name: 'patient', autocomplete: 'off', placeholder: 'Their first name', maxlength: 40 }),
        'Used in a few places, like “How is Sam feeling today?”'),
      field('Your first name', h('input', { name: 'name', autocomplete: 'given-name', placeholder: 'Shown next to things you log' })),
      field('Family code', h('div', { class: 'add-time' }, codeIn,
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { codeIn.value = makeCode(); } }, 'New')),
        'Write this down. Everyone who uses Care types this code once on their phone. Anyone with it can see and change the information, so share it only with people helping.'),
      field('Temperatures in', h('select', { name: 'unit' },
        h('option', { value: 'C', selected: !/^en-US/.test(navigator.language) }, '°C (Celsius)'),
        h('option', { value: 'F', selected: /^en-US/.test(navigator.language) }, '°F (Fahrenheit)'))),
      h('p', { class: 'hint' }, `Reminder times will follow ${deviceTz()}. You can change this later in Settings.`),
      h('button', { class: 'btn primary block', type: 'submit' }, 'Finish setup')),
    h('p', { class: 'center' }, h('a', { href: '/help' }, 'How to use Care')));
}

// ---------- today ----------

function viewToday() {
  const now = localNow();
  const day = S.day || now.date;
  const isToday = day === now.date;
  const meds = S.state.meds.filter((m) => m.active);
  const logs = S.state.logs.filter((l) => l.date === day);
  const slots = doseSlots(day);
  const taken = slots.filter((s) => s.log?.status === 'taken').length;

  const greeting = now.hour < 12 ? 'Good morning' : now.hour < 17 ? 'Good afternoon' : 'Good evening';
  const nav = h('div', { class: 'day-nav' },
    h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => { S.day = addDays(day, -1); render(); } }, '‹'),
    isToday ? null : h('button', { class: 'btn small ghost', onclick: () => { S.day = null; render(); } }, 'Today'),
    h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => { S.day = addDays(day, 1); render(); } }, '›'));

  const out = [header(isToday ? `${greeting}${S.name ? `, ${S.name}` : ''}` : fmtDate(day, { weekday: 'long' }),
    fmtDate(day), nav)];

  if (isToday) out.push(todayTiles(now, meds));

  if (!S.sub && S.state.vapidPublicKey) {
    out.push(h('button', { class: 'banner', onclick: () => setTab('settings') },
      h('strong', {}, 'Turn on reminders for this phone'), h('span', {}, 'Get a notification when it’s time for a dose →')));
  }

  for (const m of S.state.meds.filter(needsRefill)) {
    out.push(h('div', { class: 'card warn' }, h('strong', {}, `Refill ${m.name} soon`),
      h('p', {}, `${amountText(m.pills_left, m)} left. Time to call the pharmacy.`)));
  }

  if (slots.length) {
    out.push(section(null,
      h('div', { class: 'progress-row' },
        h('span', {}, `${taken} of ${slots.length} doses taken`),
        h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': slots.length, 'aria-valuenow': taken },
          h('div', { style: `width:${(taken / slots.length) * 100}%` }))),
      h('div', { class: 'list' }, doseRowsWithPacks(slots, day, now))));
  } else if (!meds.length) {
    out.push(empty('No medications yet.', h('button', { class: 'btn primary', onclick: () => { setTab('meds'); openMedForm(); } }, 'Add a medication')));
  } else {
    out.push(empty('Nothing scheduled for this day.'));
  }

  // Doses logged outside the schedule: as-needed, extra, or entered after the fact.
  const extras = logs.filter((l) => l.time.length === 8)
    .map((log) => ({ log, med: S.state.meds.find((m) => m.id === log.med_id) }))
    .filter((x) => x.med)
    .sort((a, b) => doseTime(a.log).localeCompare(doseTime(b.log)));
  if (extras.length) {
    out.push(section('Other doses', h('div', { class: 'list' }, extras.map(({ log, med }) =>
      h('div', { class: 'row dose is-done' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-time' }, fmtTime(doseTime(log))),
          h('div', { class: 'row-title' }, h('span', { class: 'name-wrap' }, med.name, infoButton(med)), med.dose ? h('span', { class: 'dose' }, ` ${med.dose}`) : null),
          h('div', { class: 'row-sub' }, `${amountText(pillsOf(log, med), med)} · ${med.as_needed ? 'as needed' : 'extra dose'}${log.logged_by ? ` · ${log.logged_by}` : ''}`)),
        h('div', { class: 'done' },
          h('span', { class: 'chip ok' }, '✓ Taken'),
          h('div', { class: 'link-row' },
            h('button', { class: 'link', onclick: () => openDoseEdit([log], med) }, 'Change'),
            h('button', { class: 'link', onclick: () => {
              if (confirm(`Remove this ${med.name} dose?`)) mutate(`log/${log.id}`, { method: 'DELETE' });
            } }, 'Remove'))))))));
  }

  // Past days: the Today cards aren't shown, so offer logging for that day here.
  if (meds.length && !isToday) {
    out.push(h('button', { class: 'btn ghost block', onclick: () => openLogForm(day) }, '+ Log a dose on this day'));
  }

  const upcoming = S.state.appts.filter((a) => wallMs(a.at.slice(0, 10), a.at.slice(11)) >= now.ms
    && a.at.slice(0, 10) <= addDays(now.date, 14));
  if (isToday && upcoming.length) {
    out.push(section('Coming up', h('div', { class: 'list' }, upcoming.slice(0, 3).map(apptRow))));
  }
  return out;
}

// Today's doses with each blister pack folded into one row (in time order with the loose doses).
function doseRowsWithPacks(slots, day, now) {
  const packs = new Map();
  const entries = [];
  for (const s of slots) {
    const code = s.med.as_needed ? '' : slotOf(s.med, s.t);
    if (!code) { entries.push({ t: s.t, el: () => doseRow(s, day, now) }); continue; }
    if (!packs.has(code)) {
      packs.set(code, []);
      entries.push({ t: s.t, el: () => packRow(code, packs.get(code), day, now) });
    }
    packs.get(code).push(s);
  }
  return entries.sort((a, b) => a.t.localeCompare(b.t)).map((e) => e.el());
}

function packRow(code, items, day, now) {
  const key = `${day}:${code}`;
  const open = (S.openPacks ||= new Set()).has(key);
  const t = items.map((s) => s.t).sort()[0];
  const pending = items.filter((s) => !s.log);
  const taken = items.filter((s) => s.log?.status === 'taken').length;
  const late = pending.length && now.ms - wallMs(day, t) > 30 * 60e3;
  const all = async (status) => {
    try {
      for (const s of pending) await api('log', { method: 'POST', body: { med_id: s.med.id, date: day, time: s.t, status, by: S.name } });
      await refresh();
      toast(`${packName(code)} pack ${status === 'taken' ? 'taken' : 'skipped'}`);
    } catch (e) { toast(e.message, true); }
  };
  const undoAll = async () => {
    try {
      for (const s of items.filter((x) => x.log)) await api(`log/${s.log.id}`, { method: 'DELETE' });
      await refresh();
    } catch (e) { toast(e.message, true); }
  };
  const toggle = () => { open ? S.openPacks.delete(key) : S.openPacks.add(key); render(); };

  let right;
  if (!pending.length) {
    right = h('div', { class: 'done' },
      h('span', { class: `chip${taken ? ' ok' : ''}` }, taken === items.length ? '✓ Taken' : `${taken} of ${items.length} taken`),
      h('div', { class: 'link-row' },
        taken ? h('button', { class: 'link', onclick: () => openDoseEdit(items.filter((x) => x.log?.status === 'taken').map((x) => x.log), null, `${packName(code)} blister pack`) }, 'Change') : null,
        h('button', { class: 'link', onclick: undoAll }, 'Undo')));
  } else {
    right = h('div', { class: 'actions' },
      pending.length === items.length ? h('button', { class: 'btn small ghost', onclick: () => all('skipped') }, 'Skip') : null,
      h('button', { class: 'btn small primary', onclick: () => all('taken') }, pending.length === items.length ? 'Taken' : 'Rest taken'));
  }
  return h('div', { class: `pack${open ? ' open' : ''}` },
    h('div', { class: `row dose${pending.length ? '' : ' is-done'}` },
      h('button', { class: 'row-main pack-head', 'aria-expanded': String(open), onclick: toggle },
        h('span', { class: 'row-time' }, fmtTime(t)),
        h('span', { class: 'row-title' }, `${packName(code)} blister pack`),
        h('span', { class: 'row-sub' }, `${items.length} medicine${items.length === 1 ? '' : 's'}${taken && pending.length ? ` · ${taken} taken` : ''} · ${open ? 'hide' : 'show'} list`),
        late ? h('span', { class: 'row-sub late' }, 'Not checked off yet') : null),
      right),
    open ? h('div', { class: 'pack-items' }, items.map((s) => doseRow(s, day, now))) : null);
}

function doseRow({ med, t, log }, day, now) {
  const late = !log && now.ms - wallMs(day, t) > 30 * 60e3;
  const set = (status) => mutate('log', { method: 'POST', body: { med_id: med.id, date: day, time: t, status, by: S.name } });
  const undo = () => mutate(`log/${log.id}`, { method: 'DELETE' });

  let right;
  if (log?.status === 'taken') {
    right = h('div', { class: 'done' },
      h('span', { class: 'chip ok' }, '✓ Taken'),
      h('div', { class: 'link-row' },
        h('button', { class: 'link', onclick: () => openDoseEdit([log], med) }, 'Change'),
        h('button', { class: 'link', onclick: undo }, 'Undo')));
  } else if (log?.status === 'skipped') {
    right = h('div', { class: 'done' },
      h('span', { class: 'chip' }, 'Skipped'),
      h('button', { class: 'link', onclick: undo }, 'Undo'));
  } else {
    right = h('div', { class: 'actions' },
      h('button', { class: 'btn small ghost', onclick: () => set('skipped') }, 'Skip'),
      h('button', { class: 'btn small primary', onclick: () => set('taken') }, 'Taken'));
  }

  return h('div', { class: `row dose${log?.status === 'taken' ? ' is-done' : ''}` },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-time' }, fmtTime(t)),
      h('div', { class: 'row-title' }, h('span', { class: 'name-wrap' }, med.name, infoButton(med)), med.dose ? h('span', { class: 'dose' }, ` ${med.dose}`) : null),
      med.instructions ? h('div', { class: 'row-sub' }, med.instructions) : null,
      late ? h('div', { class: 'row-sub late' }, 'Not checked off yet') : null,
      log ? h('div', { class: 'row-sub' }, [
        log.taken_time ? `Taken at ${fmtTime(log.taken_time)}` : fmtStamp(log.logged_at),
        log.status === 'taken' && (pillsOf(log, med) !== 1 || (med.unit || 'pill') !== 'pill') ? amountText(pillsOf(log, med), med) : null,
        log.logged_by || null,
      ].filter(Boolean).join(' · ')) : null),
    right);
}

// "45 min" or "2 h 10 min"
const fmtAgo = (ms) => {
  const mins = Math.max(0, Math.round(ms / 60e3));
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ''}`;
};

// When a logged dose was actually taken ("HH:MM").
const doseTime = (log) => log.taken_time || log.time.slice(0, 5);

// Amount taken for a logged dose: what was entered, else the medication's usual amount.
const pillsOf = (log, med) => log.amount ?? med?.pills_per_dose ?? 1;
const UNIT_NAMES = {
  pill: ['pill', 'pills'], mL: ['mL', 'mL'], capful: ['capful', 'capfuls'], packet: ['packet', 'packets'],
  scoop: ['scoop', 'scoops'], puff: ['puff', 'puffs'], patch: ['patch', 'patches'], drop: ['drop', 'drops'], dose: ['dose', 'doses'],
};
const unitWord = (n, med) => (UNIT_NAMES[med?.unit] || UNIT_NAMES.pill)[n === 1 ? 0 : 1];
const amountText = (n, med) => `${fmtCount(n)} ${unitWord(n, med)}`;

// When a medicine was last taken, as "YYYY-MM-DDTHH:MM" ('' if never), for sorting.
const lastTaken = (m) => S.state.logs.filter((l) => l.med_id === m.id && l.status === 'taken')
  .map((l) => `${l.date}T${doseTime(l)}`).sort().at(-1) || '';

function openLogForm(day, medId) {
  const now = localNow();
  const meds = S.state.meds.filter((m) => m.active);
  // As-needed medicines first, most recently used at the top; then the scheduled ones A–Z.
  const clinic = meds.filter((m) => m.kind === 'clinic').sort((a, b) => a.name.localeCompare(b.name));
  const prn = meds.filter((m) => m.as_needed && m.kind !== 'clinic').sort((a, b) => lastTaken(b).localeCompare(lastTaken(a)) || a.name.localeCompare(b.name));
  const scheduled = meds.filter((m) => !m.as_needed).sort((a, b) => a.name.localeCompare(b.name));
  const option = (m) => h('option', { value: String(m.id), selected: m.id === medId }, medLabel(m));
  const medSel = h('select', { name: 'med', required: true, 'aria-label': 'Medicine' },
    medId ? null : h('option', { value: '', disabled: true, selected: true }, 'Choose a medicine…'),
    prn.length ? h('optgroup', { label: 'As needed' }, prn.map(option)) : null,
    scheduled.length ? h('optgroup', { label: 'On a schedule' }, scheduled.map(option)) : null,
    clinic.length ? h('optgroup', { label: 'Given at the clinic' }, clinic.map(option)) : null);
  const dateIn = h('input', { name: 'date', type: 'date', required: true, max: now.date, value: day });
  const timeIn = h('input', { name: 'time', type: 'time', required: true, value: day === now.date ? now.time : '' });
  const slotSel = h('select', { name: 'slot' });
  const slotField = field('Which dose was this?', slotSel);

  const pillsIn = h('input', { name: 'pills', type: 'number', inputmode: 'decimal', min: 0.5, max: 1000, step: 0.5, required: true, 'aria-label': 'Amount' });
  let stepBy = 1; // mL go up and down by 5, everything else by 1
  const step = (dir) => { pillsIn.value = String(Math.max(0.5, (Number(pillsIn.value) || 0) + dir * stepBy)); };
  const pillsField = field('Number of pills', h('div', { class: 'stepper' },
    h('button', { type: 'button', class: 'btn ghost', 'aria-label': 'Less', onclick: () => step(-1) }, '−'),
    pillsIn,
    h('button', { type: 'button', class: 'btn ghost', 'aria-label': 'More', onclick: () => step(1) }, '+')));
  const setUsualPills = () => {
    const med = meds.find((m) => String(m.id) === medSel.value);
    const unit = med?.unit || 'pill';
    pillsIn.value = String(med?.pills_per_dose ?? 1);
    stepBy = unit === 'mL' ? 5 : 1;
    pillsField.querySelector('.label').textContent = unit === 'pill' ? 'Number of pills' : `Amount (${UNIT_NAMES[unit][1]})`;
  };
  medSel.addEventListener('change', setUsualPills);
  setUsualPills();

  // Offer the scheduled doses on that day that aren't checked off yet, nearest time first.
  const refreshSlots = () => {
    const med = meds.find((m) => String(m.id) === medSel.value);
    const date = dateIn.value;
    const open = med && !med.as_needed && date && medOnDate(med, date)
      ? med.times.filter((t) => !S.state.logs.some((l) => l.med_id === med.id && l.date === date && l.time === t))
      : [];
    const at = timeIn.value ? wallMs(date || now.date, timeIn.value) : null;
    if (at != null) open.sort((a, b) => Math.abs(wallMs(date, a) - at) - Math.abs(wallMs(date, b) - at));
    slotSel.replaceChildren(
      ...open.map((t) => h('option', { value: t }, `The ${fmtTime(t)} dose`)),
      h('option', { value: 'extra' }, med?.as_needed ? 'An as-needed dose' : 'An extra dose (not on the schedule)'));
    slotField.hidden = !open.length;
  };
  // As-needed limits from the label: a gentle heads-up, never a block.
  const limitNote = h('p', { class: 'limit-note', hidden: true });
  const checkLimits = () => {
    const med = meds.find((m) => String(m.id) === medSel.value);
    limitNote.hidden = true;
    if (!med || !med.as_needed || med.kind === 'clinic' || !dateIn.value) return;
    const at = wallMs(dateIn.value, timeIn.value || localNow().time);
    const taken = S.state.logs.filter((l) => l.med_id === med.id && l.status === 'taken')
      .map((l) => ({ l, ms: wallMs(l.date, doseTime(l)) })).filter((x) => x.ms <= at).sort((a, b) => b.ms - a.ms);
    const msgs = [];
    const prev = taken[0];
    if (prev && med.prn_min_hours && at - prev.ms < med.prn_min_hours * 3600e3) {
      msgs.push(`The last dose was ${fmtAgo(at - prev.ms)} ago; the label says at least ${fmtCount(med.prn_min_hours)} hour${med.prn_min_hours == 1 ? '' : 's'} between doses.`);
    }
    const sameDay = taken.filter((x) => x.l.date === dateIn.value).length;
    if (med.prn_max_day && sameDay >= med.prn_max_day) {
      msgs.push(`Already ${sameDay} dose${sameDay === 1 ? '' : 's'} that day; the label says up to ${fmtCount(med.prn_max_day)} a day.`);
    }
    limitNote.textContent = msgs.length ? `⚠️ ${msgs.join(' ')} Check with the care team if unsure.`
      : prev ? `Last dose: ${fmtAgo(at - prev.ms)} ago.` : '';
    limitNote.className = `limit-note${msgs.length ? ' warn' : ''}`;
    limitNote.hidden = !limitNote.textContent;
  };
  [medSel, dateIn, timeIn].forEach((el) => el.addEventListener('change', () => { refreshSlots(); checkLimits(); }));
  refreshSlots();
  checkLimits();

  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    if (!medSel.value) return toast('Choose a medicine first.', true);
    const medId = Number(medSel.value);
    const date = dateIn.value;
    const time = timeIn.value;
    if (wallMs(date, time) > localNow().ms + 5 * 60e3) return toast('That time is in the future.', true);
    let slot = slotSel.value;
    if (slot === 'extra') {
      // Extra doses are stored with seconds so several can share a minute.
      const used = new Set(S.state.logs.filter((l) => l.med_id === medId && l.date === date).map((l) => l.time));
      let s = 0;
      while (s < 59 && used.has(`${time}:${String(s).padStart(2, '0')}`)) s++;
      slot = `${time}:${String(s).padStart(2, '0')}`;
    }
    const ok = await mutate('log', { method: 'POST', body: {
      med_id: medId, date, time: slot, taken_time: time, amount: Number(pillsIn.value), status: 'taken', by: S.name,
    } }, 'Dose logged');
    if (ok) close();
  } },
  field('Medication', medSel),
  h('div', { class: 'grid2' }, field('Date', dateIn), field('Time taken', timeIn)),
  pillsField,
  limitNote,
  slotField,
  h('button', { class: 'btn primary block', type: 'submit' }, 'Log dose'));
  const close = openSheet('Log a dose', form);
}

// Change when taken doses were taken (and, for a single dose, how much). For a blister pack,
// all its taken doses move to the new time together.
function openDoseEdit(logs, med, title) {
  const one = logs.length === 1 ? logs[0] : null;
  med ||= one && S.state.meds.find((m) => m.id === one.med_id);
  const extra = one && one.time.length === 8; // as-needed or extra: not tied to a scheduled slot
  const dateIn = h('input', { type: 'date', required: true, max: localNow().date, value: one?.date || logs[0].date, disabled: !extra });
  const timeIn = h('input', { type: 'time', required: true, value: doseTime(logs[0]) });
  const unit = med?.unit || 'pill';
  const stepBy = unit === 'mL' ? 5 : 1;
  const pillsIn = one ? h('input', { type: 'number', inputmode: 'decimal', min: 0.5, max: 1000, step: 0.5, required: true,
    'aria-label': 'Amount', value: String(pillsOf(one, med)) }) : null;
  const step = (dir) => { pillsIn.value = String(Math.max(0.5, (Number(pillsIn.value) || 0) + dir * stepBy)); };

  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    if (wallMs(dateIn.value, timeIn.value) > localNow().ms + 5 * 60e3) return toast('That time is in the future.', true);
    try {
      for (const log of logs) {
        await api(`log/${log.id}`, { method: 'POST', body: {
          date: dateIn.value, taken_time: timeIn.value, ...(pillsIn ? { amount: Number(pillsIn.value) } : {}),
        } });
      }
      await refresh();
      toast('Dose changed');
      close();
    } catch (err) { toast(err.message, true); }
  } },
    h('p', { class: 'muted' }, title || [medLabel(med), one && !extra ? `the ${fmtTime(one.time)} dose` : null].filter(Boolean).join(' · ')),
    h('div', { class: 'grid2' }, field('Date', dateIn), field('Time taken', timeIn)),
    extra || !one ? null : h('p', { class: 'hint' }, 'A scheduled dose stays on its day. To move it to another day, undo it and log it on that day.'),
    pillsIn ? field(unit === 'pill' ? 'Number of pills' : `Amount (${UNIT_NAMES[unit][1]})`, h('div', { class: 'stepper' },
      h('button', { type: 'button', class: 'btn ghost', 'aria-label': 'Less', onclick: () => step(-1) }, '−'),
      pillsIn,
      h('button', { type: 'button', class: 'btn ghost', 'aria-label': 'More', onclick: () => step(1) }, '+'))) : null,
    !one ? h('p', { class: 'hint' }, `Moves all ${logs.length} taken medicines in this pack to the new time.`) : null,
    h('button', { class: 'btn primary block', type: 'submit' }, 'Save'));
  const close = openSheet(logs.length > 1 ? 'Change pack time' : 'Change dose', form);
}

// ---------- pain ----------

const painWord = (n) => (n === 0 ? 'No pain' : n <= 3 ? 'Mild' : n <= 6 ? 'Moderate' : n <= 9 ? 'Severe' : 'Worst possible');
const byWhen = (a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`) || a.id - b.id;

function openPainSheet() {
  const now = localNow();
  let score = null;
  const word = h('p', { class: 'pain-word', 'aria-live': 'polite' }, 'Tap a number');
  const saveBtn = h('button', { class: 'btn primary block', type: 'submit', disabled: true }, 'Save');
  const btns = Array.from({ length: 11 }, (_, n) => h('button', {
    type: 'button', class: 'pain-btn', 'aria-pressed': 'false', 'aria-label': `${n}, ${painWord(n)}`,
    onclick: () => {
      score = n;
      btns.forEach((b, i) => b.setAttribute('aria-pressed', String(i === n)));
      word.textContent = `${n} · ${painWord(n)}`;
      saveBtn.disabled = false;
    },
  }, String(n)));
  const note = h('textarea', { name: 'note', rows: 2, placeholder: 'Where does it hurt? Anything that helped? (optional)' });
  const dateIn = h('input', { type: 'date', value: now.date, max: now.date });
  const timeIn = h('input', { type: 'time', value: now.time });

  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    if (score == null) return;
    if (wallMs(dateIn.value, timeIn.value) > localNow().ms + 5 * 60e3) return toast('That time is in the future.', true);
    const ok = await mutate('pain', { method: 'POST', body: {
      score, note: note.value, date: dateIn.value, time: timeIn.value, by: S.name,
    } }, 'Pain rating saved');
    if (ok) close();
  } },
  h('div', { class: 'pain-grid', role: 'group', 'aria-label': 'Pain from 0 to 10' }, btns),
  h('div', { class: 'pain-scale', 'aria-hidden': 'true' }, h('span', {}, '0 = no pain'), h('span', {}, '10 = worst')),
  word,
  note,
  h('details', { class: 'more' }, h('summary', {}, 'This was earlier'),
    h('div', { class: 'grid2' }, field('Date', dateIn), field('Time', timeIn))),
  saveBtn);
  const close = openSheet('Rate your pain', form);
}

// ---------- water ----------

const fmtMl = (n) => `${Math.round(n).toLocaleString('en-US')} mL`;
const waterOn = (day) => (S.state.water || []).filter((w) => w.date === day).sort(byWhen);
const waterTotal = (day) => waterOn(day).reduce((n, w) => n + w.ml, 0);
const containers = () => S.state.waterContainers || [];

const logWater = (ml, label) => mutate('water', { method: 'POST', body: { ml, label, by: S.name } }, `Added ${label ? `${label} (${fmtMl(ml)})` : fmtMl(ml)}`);

function openWaterSheet() {
  const now = localNow();
  const amount = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 5000, step: 10, placeholder: 'e.g. 150', 'aria-label': 'Amount in mL' });
  const body = h('div', { class: 'form' });
  const fill = () => {
    const today = waterOn(now.date);
    body.replaceChildren(
      h('p', { class: 'water-big' }, fmtMl(waterTotal(now.date)), S.state.waterGoal ? h('span', { class: 'muted' }, ` of ${fmtMl(S.state.waterGoal)}`) : null),
      h('div', { class: 'water-btns' }, containers().map((c) => h('button', { class: 'btn small', onclick: async () => {
        if (await logWater(c.ml, c.name)) fill();
      } }, `+ ${c.name}`, h('span', { class: 'water-ml' }, fmtMl(c.ml))))),
      field('Other amount (mL)', h('div', { class: 'add-time' }, amount,
        h('button', { type: 'button', class: 'btn ghost', onclick: async () => {
          const ml = Math.round(Number(amount.value));
          if (!(ml > 0 && ml <= 5000)) return toast('Enter an amount between 1 and 5,000 mL.', true);
          if (await logWater(ml, '')) { amount.value = ''; fill(); }
        } }, 'Add')), 'For part of a container, e.g. half a Yeti.'),
      today.length ? h('div', { class: 'list' }, [...today].reverse().map((w) => h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, fmtMl(w.ml), w.label ? h('span', { class: 'dose' }, ` ${w.label}`) : null),
          h('div', { class: 'row-sub' }, `${fmtTime(w.time)}${w.created_by ? ` · ${w.created_by}` : ''}`)),
        h('button', { class: 'link', onclick: async () => {
          if (await mutate(`water/${w.id}`, { method: 'DELETE' }, 'Removed')) fill();
        } }, 'Remove')))) : h('p', { class: 'muted' }, 'Nothing logged yet today.'),
      h('button', { type: 'button', class: 'btn ghost block', onclick: () => { close(); setTab('settings'); } }, 'Change containers or daily goal'));
  };
  fill();
  const close = openSheet('Water', body);
}

// ---------- exercise ----------

const ACTIVITIES = ['Walk', 'Stretching', 'Yoga', 'Bike', 'Strength', 'Other'];
const exerciseOn = (day) => (S.state.exercise || []).filter((x) => x.date === day).sort(byWhen);
const exerciseTotal = (day) => exerciseOn(day).reduce((n, x) => n + x.minutes, 0);
const fmtMin = (n) => `${n} min`;

function openExerciseSheet() {
  const now = localNow();
  let activity = 'Walk';
  let minutes = null;
  const actBtns = ACTIVITIES.map((a) => h('button', {
    type: 'button', class: 'chip-toggle', 'aria-pressed': String(a === activity),
    onclick: () => { activity = a; actBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === a))); },
  }, a));
  const custom = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 600, placeholder: 'Other', class: 'min-other', 'aria-label': 'Minutes',
    oninput: () => { minutes = Math.round(Number(custom.value)) || null; minBtns.forEach((b) => b.setAttribute('aria-pressed', 'false')); } });
  const minBtns = [5, 10, 15, 20, 30, 45, 60].map((m) => h('button', {
    type: 'button', class: 'chip-toggle', 'aria-pressed': 'false',
    onclick: () => { minutes = m; custom.value = ''; minBtns.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.m) === m))); },
    'data-m': m,
  }, `${m}`));
  const note = h('input', { placeholder: 'Note (optional), e.g. around the block', maxlength: 500 });
  const dateIn = h('input', { type: 'date', value: now.date, max: now.date });
  const timeIn = h('input', { type: 'time', value: now.time });
  const list = h('div');

  const fillList = () => {
    const today = exerciseOn(now.date);
    list.replaceChildren(...(today.length ? [section(`Today · ${fmtMin(exerciseTotal(now.date))}`, h('div', { class: 'list' }, [...today].reverse().map((x) => h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: 'row-title' }, fmtMin(x.minutes), x.activity ? h('span', { class: 'dose' }, ` ${x.activity}`) : null),
          h('div', { class: 'row-sub' }, [fmtTime(x.time), x.note, x.created_by].filter(Boolean).join(' · '))),
        h('button', { type: 'button', class: 'link', onclick: async () => {
          if (await mutate(`exercise/${x.id}`, { method: 'DELETE' }, 'Removed')) fillList();
        } }, 'Remove')))))] : []));
  };

  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    if (!(minutes > 0 && minutes <= 600)) return toast('Pick how many minutes.', true);
    if (wallMs(dateIn.value, timeIn.value) > localNow().ms + 5 * 60e3) return toast('That time is in the future.', true);
    const ok = await mutate('exercise', { method: 'POST', body: {
      minutes, activity, note: note.value, date: dateIn.value, time: timeIn.value, by: S.name,
    } }, `Logged ${fmtMin(minutes)} ${activity.toLowerCase()}`);
    if (ok) close();
  } },
  h('span', { class: 'label' }, 'What'), h('div', { class: 'chips' }, actBtns),
  h('span', { class: 'label' }, 'How many minutes'), h('div', { class: 'chips' }, minBtns, custom),
  note,
  h('details', { class: 'more' }, h('summary', {}, 'This was earlier'),
    h('div', { class: 'grid2' }, field('Date', dateIn), field('Started', timeIn))),
  h('button', { class: 'btn primary block', type: 'submit' }, 'Save'),
  list);
  fillList();
  const close = openSheet('Log exercise', form);
}

// ---------- Today tiles ----------

const whenLabel = (date, time, now) => (date === now.date ? fmtTime(time)
  : date === addDays(now.date, -1) ? `yesterday ${fmtTime(time)}` : shortDate(date));

// Six quick tiles keep Today short however many things are being tracked.
function todayTiles(now, meds) {
  const tile = (label, value, sub, onclick, cls = '', extra = null) => h('button', { class: `tile ${cls}`, onclick },
    h('span', { class: 'tile-label' }, label), h('span', { class: 'tile-value' }, value), extra, h('span', { class: 'tile-sub' }, sub));

  const pain = [...(S.state.pain || [])].sort(byWhen).at(-1);
  const extra = S.state.logs.filter((l) => l.status === 'taken' && l.time.length === 8)
    .sort((a, b) => `${a.date}${doseTime(a)}`.localeCompare(`${b.date}${doseTime(b)}`)).at(-1);
  const extraMed = extra && S.state.meds.find((m) => m.id === extra.med_id);
  const temp = [...(S.state.temps || [])].sort(byWhen).at(-1);
  // Stay red for a day after any fever or chills, even if a later reading is normal.
  const recentFever = [...(S.state.temps || [])].sort(byWhen).reverse()
    .find((t) => (t.temp_f >= feverF() || t.chills) && now.ms - wallMs(t.date, t.time) < 24 * 3600e3);
  const checkedIn = checkinsOn(now.date).length > 0;
  const water = waterTotal(now.date);
  const wGoal = S.state.waterGoal || 0;
  const ex = exerciseTotal(now.date);
  const xGoal = S.state.exerciseGoal || 0;

  return h('div', { class: 'tiles' },
    episodeTile(),
    tile('Pain', pain ? `${pain.score}/10` : 'Rate', pain ? whenLabel(pain.date, pain.time, now) : 'Tap to rate 0–10', () => openPainSheet()),
    meds.length ? tile('Medicine', 'Log', extraMed ? `Last: ${extraMed.name} · ${whenLabel(extra.date, doseTime(extra), now)}` : 'As-needed or extra dose',
      () => openLogForm(now.date)) : null,
    tile('Temperature', temp ? `${fmtTemp(temp.temp_f)}` : 'Take', recentFever ? `Fever ${fmtTemp(recentFever.temp_f)} ${whenLabel(recentFever.date, recentFever.time, now)} · call team` : temp ? whenLabel(temp.date, temp.time, now) : 'Log a reading',
      () => openTempSheet(), recentFever ? 'alert' : ''),
    (() => {
      // Bowels: today's count, the last one, and a nudge after 3 days without (opioids constipate).
      const todays = bowelOn(now.date);
      const gap = daysSinceBowel(now);
      const last = [...(S.state.bowel || [])].sort(byWhen).at(-1);
      const sub = gap != null && gap >= 3 ? `None in ${gap} days · tell the team`
        : last ? `Last: ${last.type ? STOOL[last.type - 1][1].toLowerCase() : 'logged'} · ${whenLabel(last.date, last.time, now)}` : 'Log a bowel movement';
      return tile('Bowels', todays.length ? `${todays.length} today` : 'Log', sub, () => openBowelSheet(), gap != null && gap >= 3 ? 'alert' : '');
    })(),
    tile('Water', fmtMl(water), wGoal ? `of ${fmtMl(wGoal)}` : 'today', () => openWaterSheet(), '',
      wGoal ? h('span', { class: 'tile-bar' }, h('span', { style: `width:${Math.min(100, (water / wGoal) * 100)}%` })) : null),
    tile('Exercise', fmtMin(ex), xGoal ? `of ${fmtMin(xGoal)}${ex >= xGoal ? ' 🎉' : ''}` : 'today', () => openExerciseSheet()),
    tile('Daily check-in', checkedIn ? 'Done ✓' : 'Not yet', checkedIn ? 'Tap to update' : 'Tiredness, numbness, sleep, mood…', () => openCheckinSheet(), `wide checkin-tile${checkedIn ? ' done' : ''}`));
}

// ---------- symptom episodes (timed) ----------

const EPISODE_NAMES = ['Back spasm', 'Neck spasm', 'Pain', 'Nausea', 'Vomiting', 'Dizziness', 'Headache', 'Short of breath', 'Chills', 'Anxiety'];
const episodesOn = (day) => (S.state.episodes || []).filter((e) => e.date === day);
const running = () => (S.state.episodes || []).filter((e) => !e.ended_at);
const epMinutes = (e) => Math.max(0, ((e.ended_at ? Date.parse(e.ended_at) : Date.now()) - Date.parse(e.started_at)) / 60e3);
const fmtLength = (mins) => (mins < 1 ? `${Math.round(mins * 60)} sec` : fmtAgo(mins * 60e3));
// "4:07" or "1:02:45" since a start time; ticked every second by the clock at the bottom of this file.
function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}
// Saved without a length (it ends at its start time), or still going.
const noLength = (e) => !!e.ended_at && e.ended_at === e.started_at;
const lengthText = (e) => (!e.ended_at ? 'still going' : noLength(e) ? 'length not noted' : fmtLength(epMinutes(e)));
const episodeLabel = (e) => `${e.name} · ${e.severity === 'major' ? 'Major' : 'Minor'}${e.area ? ` · ${e.area}` : ''}`;

// The wide tile at the top of Today: a live timer with Stop while something is happening.
function episodeTile() {
  const live = running();
  if (!live.length) {
    return h('button', { class: 'tile wide ep-tile', onclick: () => openEpisodeSheet() },
      h('span', { class: 'tile-label' }, 'Symptom'),
      h('span', { class: 'ep-cta' }, 'Something happening? Log it or time it'),
      h('span', { class: 'tile-sub' }, (() => {
        const last = [...(S.state.episodes || [])].sort((a, b) => a.started_at.localeCompare(b.started_at)).at(-1);
        return last ? `Last: ${last.name} (${last.severity}) · ${whenLabel(last.date, last.time, localNow())}${noLength(last) ? '' : ` · ${lengthText(last)}`}` : 'Minor or major, with how long it lasts';
      })()));
  }
  return h('div', { class: `tile wide ep-tile running${live.some((e) => e.severity === 'major') ? ' major' : ''}` },
    live.map((e) => h('div', { class: 'ep-live' },
      h('div', { class: 'ep-live-text' },
        h('span', { class: 'tile-label' }, episodeLabel(e)),
        h('span', { class: 'ep-timer', 'data-since': Date.parse(e.started_at) }, fmtElapsed(Date.now() - Date.parse(e.started_at)))),
      h('button', { class: 'btn ep-stop', onclick: () => mutate(`stop/${e.id}`, { method: 'POST', body: {} },
        `${e.name} stopped after ${fmtLength(epMinutes(e))}`) }, 'Stop'))),
    h('button', { class: 'link ep-more', onclick: () => openEpisodeSheet() }, '+ Log another symptom'));
}

function openEpisodeSheet() {
  const used = [...new Set((S.state.episodes || []).map((e) => e.name))];
  const names = [...new Set([...EPISODE_NAMES, ...used])];
  let name = null, severity = null, area = '';
  const chipRow = (options, isOn, pick) => {
    const btns = options.map((o) => h('button', { type: 'button', class: 'chip-toggle', 'aria-pressed': String(isOn(o)),
      onclick: () => { pick(o); btns.forEach((b, i) => b.setAttribute('aria-pressed', String(isOn(options[i])))); update(); } }, o));
    return h('div', { class: 'chips' }, btns);
  };
  const other = h('input', { placeholder: 'Something else? Type it here', maxlength: 60,
    oninput: () => { name = other.value.trim() || null; nameRow.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); update(); } });
  const nameRow = chipRow(names, (o) => o === name, (o) => { name = name === o ? null : o; other.value = ''; });
  const sevBtns = [['minor', 'Minor'], ['major', 'Major']].map(([v, label]) => h('button', {
    type: 'button', class: `sev-btn ${v}`, 'aria-pressed': 'false',
    onclick: () => { severity = v; sevBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(['minor', 'major'][i] === v))); update(); },
  }, label));
  const areaRow = chipRow(AREAS, (o) => o === area, (o) => { area = area === o ? '' : o; });
  const note = h('input', { placeholder: 'Note (optional)', maxlength: 500 });
  const ago = h('select', { 'aria-label': 'When it started' },
    [[0, 'Just now'], [5, '5 min ago'], [15, '15 min ago'], [30, '30 min ago'], [60, '1 hour ago'], [120, '2 hours ago'], [240, '4 hours ago']]
      .map(([v, label]) => h('option', { value: v }, label)));
  const startBtn = h('button', { type: 'button', class: 'btn primary block', disabled: true, onclick: () => save(null) }, 'Start timer');
  const justLog = h('button', { type: 'button', class: 'btn ghost block', disabled: true, onclick: () => save('none') }, 'Just log it (no time)');
  const lengths = [1, 5, 15, 30, 60].map((m) => h('button', { type: 'button', class: 'chip-toggle', disabled: true, onclick: () => save(m) },
    m === 60 ? '1 hour' : `${m} min`));
  function update() {
    const ready = !!(name && severity);
    startBtn.disabled = !ready;
    justLog.disabled = !ready;
    lengths.forEach((b) => { b.disabled = !ready; });
  }
  async function save(duration) {
    const ok = await mutate('episodes', { method: 'POST', body: {
      name, severity, area, note: note.value, minutes_ago: Number(ago.value), by: S.name,
      duration_min: duration === 'none' ? null : duration, no_length: duration === 'none',
    } }, duration === 'none' ? `Logged ${name}` : duration ? `Logged ${name} (${duration === 60 ? '1 hour' : `${duration} min`})` : `Timing ${name}…`);
    if (ok) close();
  }
  const close = openSheet('Symptom', h('div', { class: 'form' },
    h('span', { class: 'label' }, 'What is it?'), nameRow, other,
    h('span', { class: 'label' }, 'How bad?'), h('div', { class: 'sev-row' }, sevBtns),
    h('details', { class: 'more' }, h('summary', {}, 'Where, when it started, note'),
      h('span', { class: 'label' }, 'Where (optional)'), areaRow,
      field('Started', ago), note),
    startBtn,
    h('p', { class: 'hint center' }, 'Already over? Tap how long it lasted:'),
    h('div', { class: 'chips center-chips' }, lengths),
    justLog,
    episodesOn(localNow().date).length ? section('Today', h('div', { class: 'list' },
      [...episodesOn(localNow().date)].reverse().map((e) => h('div', { class: 'row' },
        h('div', { class: 'row-main' },
          h('div', { class: `row-title${e.severity === 'major' ? ' fever-text' : ''}` }, episodeLabel(e)),
          h('div', { class: 'row-sub' }, `${fmtTime(e.time)} · ${lengthText(e)}${e.note ? ` · ${e.note}` : ''}`)),
        h('button', { type: 'button', class: 'link', onclick: async () => {
          if (confirm(`Remove this ${e.name}?`) && await mutate(`episodes/${e.id}`, { method: 'DELETE' }, 'Removed')) close();
        } }, 'Remove'))))) : null));
}

// ---------- bowel movements ----------

// The 7-type stool scale doctors use, in plain words.
const STOOL = [
  [1, 'Hard lumps', 'Separate hard lumps, hard to pass'],
  [2, 'Lumpy', 'Sausage-shaped but lumpy'],
  [3, 'Cracked', 'Sausage with cracks on the surface'],
  [4, 'Smooth', 'Smooth and soft, like a sausage'],
  [5, 'Soft blobs', 'Soft blobs with clear edges'],
  [6, 'Mushy', 'Fluffy, mushy pieces'],
  [7, 'Watery', 'Watery, no solid pieces'],
];
const stoolGroup = (t) => (t == null ? '' : t <= 2 ? 'hard' : t <= 5 ? 'normal' : 'loose');
const bowelOn = (day) => (S.state.bowel || []).filter((b) => b.date === day).sort(byWhen);
const bowelText = (b) => [b.type ? `Type ${b.type} (${STOOL[b.type - 1][1].toLowerCase()})` : 'Bowel movement',
  b.amount, b.strain ? 'straining' : '', b.black ? 'BLACK/TARRY' : '', b.blood ? 'BLOOD' : ''].filter(Boolean).join(', ');

// Days since the last bowel movement (null if none logged in the last 60 days).
function daysSinceBowel(now) {
  const last = [...(S.state.bowel || [])].sort(byWhen).at(-1);
  return last ? Math.round((Date.parse(now.date) - Date.parse(last.date)) / 864e5) : null;
}

function openBowelSheet() {
  const now = localNow();
  let type = null, amount = '';
  const typeBtns = STOOL.map(([n, label, desc]) => h('button', {
    type: 'button', class: `stool-btn ${stoolGroup(n)}`, 'aria-pressed': 'false', 'aria-label': `Type ${n}: ${desc}`,
    onclick: () => { type = type === n ? null : n; typeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === type))); },
  }, h('strong', {}, String(n)), h('span', {}, label)));
  const amountBtns = ['small', 'medium', 'large'].map((a) => h('button', {
    type: 'button', class: 'chip-toggle', 'aria-pressed': 'false',
    onclick: () => { amount = amount === a ? '' : a; amountBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent.toLowerCase() === amount))); },
  }, a[0].toUpperCase() + a.slice(1)));
  const strain = h('input', { type: 'checkbox' });
  const blood = h('input', { type: 'checkbox' });
  const black = h('input', { type: 'checkbox' });
  const note = h('input', { placeholder: 'Note (optional)', maxlength: 500 });
  const dateIn = h('input', { type: 'date', value: now.date, max: now.date });
  const timeIn = h('input', { type: 'time', value: now.time });
  const today = bowelOn(now.date);

  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    const ok = await mutate('bowel', { method: 'POST', body: {
      type, amount, strain: strain.checked, blood: blood.checked, black: black.checked, note: note.value,
      date: dateIn.value, time: timeIn.value, by: S.name,
    } }, blood.checked || black.checked ? null : 'Bowel movement logged');
    if (!ok) return;
    close();
    if (blood.checked || black.checked) {
      showUrgent(black.checked ? 'Black or tarry stool' : 'Blood in the stool', [
        black.checked ? 'Black, tarry stool can be a sign of bleeding inside the gut.' : 'Blood in the stool can come from bleeding, which matters more when platelet counts are low.',
        'Tell the care team today. Call right away if there’s a lot of blood, or with dizziness, fainting or shortness of breath.',
      ]);
    }
  } },
  h('span', { class: 'label' }, 'What was it like?'),
  h('div', { class: 'stool-grid' }, typeBtns),
  h('p', { class: 'hint' }, '1–2 hard (constipated) · 3–5 normal · 6–7 loose (diarrhea). Optional.'),
  h('span', { class: 'label' }, 'Amount'), h('div', { class: 'chips' }, amountBtns),
  h('label', { class: 'check' }, strain, 'Straining or pain'),
  h('fieldset', { class: 'fieldset warn-box' }, h('legend', { class: 'label' }, 'Tell the care team'),
    h('label', { class: 'check' }, blood, 'Blood seen'),
    h('label', { class: 'check' }, black, 'Black or tarry')),
  note,
  h('details', { class: 'more' }, h('summary', {}, 'This was earlier'),
    h('div', { class: 'grid2' }, field('Date', dateIn), field('Time', timeIn))),
  h('button', { class: 'btn primary block', type: 'submit' }, 'Save'),
  today.length ? section('Today', h('div', { class: 'list' }, [...today].reverse().map((b) => h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: `row-title${b.blood || b.black ? ' fever-text' : ''}` }, bowelText(b)),
      h('div', { class: 'row-sub' }, [fmtTime(b.time), b.note, b.created_by].filter(Boolean).join(' · '))),
    h('button', { type: 'button', class: 'link', onclick: async () => {
      if (confirm('Remove this entry?') && await mutate(`bowel/${b.id}`, { method: 'DELETE' }, 'Removed')) close();
    } }, 'Remove'))))) : null);
  const close = openSheet('Bowel movement', form);
}

// ---------- temperature & urgent alerts ----------

const feverF = () => S.state.feverF || 100.4;
// Temperatures are stored in °F; shown and entered in the household's chosen unit (°C by default).
const useC = () => (S.state.tempUnit || 'C') === 'C';
const tempUnit = () => (useC() ? '°C' : '°F');
const toUnit = (f) => (useC() ? Math.round(((f - 32) * 5 / 9) * 10) / 10 : f);
const fmtTemp = (f) => `${toUnit(f).toFixed(1)}${tempUnit()}`;
const tempsOn = (day) => (S.state.temps || []).filter((t) => t.date === day).sort(byWhen);

function openTempSheet() {
  const now = localNow();
  const tempIn = h('input', { type: 'number', inputmode: 'decimal', step: 0.1, min: 34, max: 108, placeholder: useC() ? '37.0' : '98.6', class: 'temp-input', 'aria-label': 'Temperature' });
  const chills = h('input', { type: 'checkbox' });
  const note = h('input', { placeholder: 'Note (optional)', maxlength: 500 });
  const dateIn = h('input', { type: 'date', value: now.date, max: now.date });
  const timeIn = h('input', { type: 'time', value: now.time });
  const today = tempsOn(now.date);

  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    if (!tempIn.value) return toast('Enter the temperature.', true);
    try {
      const r = await api('temp', { method: 'POST', body: {
        temp: Number(tempIn.value), chills: chills.checked, note: note.value, date: dateIn.value, time: timeIn.value, by: S.name,
      } });
      close();
      await refresh();
      if (r.fever || chills.checked) {
        showUrgent(r.fever ? `Temperature ${fmtTemp(r.temp_f)}` : 'Shaking chills', r.fever
          ? [`${fmtTemp(r.temp_f)} is at or above the fever level of ${fmtTemp(feverF())}.`, 'During treatment a fever can be the only sign of an infection, and infections can get serious quickly.']
          : ['Shaking chills can be a sign of infection even when the temperature is normal.']);
      } else {
        toast(`Saved ${fmtTemp(r.temp_f)}`);
      }
    } catch (err) {
      toast(err.message, true);
    }
  } },
  h('div', { class: 'temp-row' }, tempIn, h('span', { class: 'temp-unit' }, tempUnit())),
  h('p', { class: 'hint center' }, `${useC() ? '°F' : '°C'} works too. Call the care team at ${fmtTemp(feverF())} or higher.`),
  h('label', { class: 'check' }, chills, 'Shaking chills'),
  note,
  h('details', { class: 'more' }, h('summary', {}, 'This was earlier'),
    h('div', { class: 'grid2' }, field('Date', dateIn), field('Time', timeIn))),
  h('button', { class: 'btn primary block', type: 'submit' }, 'Save'),
  today.length ? section('Today', h('div', { class: 'list' }, [...today].reverse().map((t) => h('div', { class: 'row' },
    h('div', { class: 'row-main' },
      h('div', { class: `row-title${t.temp_f >= feverF() ? ' fever-text' : ''}` }, `${fmtTemp(t.temp_f)}`, t.chills ? h('span', { class: 'dose' }, ' · chills') : null),
      h('div', { class: 'row-sub' }, [fmtTime(t.time), t.note, t.created_by].filter(Boolean).join(' · '))),
    h('button', { type: 'button', class: 'link', onclick: async () => {
      if (await mutate(`temp/${t.id}`, { method: 'DELETE' }, 'Removed')) close();
    } }, 'Remove'))))) : null);
  const close = openSheet('Temperature', form);
  setTimeout(() => tempIn.focus(), 300);
}

// The "call now" screen for a fever or a warning sign, with one-tap phone numbers.
function showUrgent(what, reasons) {
  // Everyone in the circle of care marked "call for urgent problems", daytime number first.
  const calls = (S.state.contacts || []).filter((c) => c.urgent).flatMap((c, i) => [
    c.phone ? h('a', { class: `btn ${i ? 'danger-ghost' : 'danger-fill'} block`, href: telHref(c.phone) }, `Call ${c.name}`, h('span', {}, c.phone)) : null,
    c.phone2 ? h('a', { class: 'btn danger-ghost block', href: telHref(c.phone2) }, `${c.name}: after hours`, h('span', {}, c.phone2)) : null,
  ]).filter(Boolean);
  const close = openSheet('Call the care team now', h('div', { class: 'form urgent' },
    h('p', { class: 'urgent-what' }, what),
    reasons.map((t) => h('p', {}, t)),
    calls.length ? calls : h('button', { type: 'button', class: 'btn danger-fill block', onclick: () => { close(); openCircle(); } },
      'Add the care team’s phone numbers'),
    h('ul', { class: 'steps' },
      h('li', {}, 'Call now, even at night. Don’t wait until morning.'),
      h('li', {}, 'Don’t take Tylenol or other fever reducers until the care team says it’s OK.'),
      h('li', {}, 'If you can’t reach them, go to the emergency room and tell them about the cancer treatment.'),
      h('li', {}, h('strong', {}, 'For chest pain, trouble breathing or sudden weakness, call 911.'))),
    h('p', { class: 'hint' }, 'Phones with “Caregiver alerts” turned on get an alert about this too.')));
}

function openWhenToCall() {
  openSheet('When to call the care team', h('div', { class: 'form' },
    h('p', {}, h('strong', {}, 'Call right away, day or night, for:')),
    h('ul', { class: 'steps' },
      h('li', {}, `A temperature of ${fmtTemp(feverF())} or higher, or shaking chills`),
      WARNING_FLAGS.filter((f) => f !== 'Shaking chills').map((f) => h('li', {}, f)),
      h('li', {}, 'Vomiting or diarrhea that won’t stop, or not able to keep fluids down'),
      h('li', {}, 'Pain that is new, severe, or not helped by the usual pain medicine')),
    h('p', {}, h('strong', {}, 'Call 911 for chest pain, trouble breathing, sudden weakness or confusion.')),
    h('p', { class: 'hint' }, 'Based on guidance from the International Myeloma Foundation, the American Cancer Society and cancer centers. Your care team’s own instructions come first.')));
}

// ---------- daily symptom check-in ----------

const SCALE = ['None', 'Mild', 'Moderate', 'Severe', 'Very bad'];
const SYMPTOMS = [['fatigue', 'Tiredness'], ['numbness', 'Numbness or tingling (hands/feet)'], ['nausea', 'Nausea'], ['breath', 'Short of breath']];
const CHOICES = [
  ['bowels', 'Bowels', [['normal', 'Normal'], ['constipated', 'Constipated'], ['diarrhea', 'Diarrhea'], ['none', 'No BM']]],
  ['sleep', 'Sleep', [['good', 'Good'], ['ok', 'OK'], ['poor', 'Poor']]],
  ['appetite', 'Appetite', [['good', 'Good'], ['ok', 'OK'], ['poor', 'Poor']]],
  ['mood', 'Mood', [['good', 'Good'], ['ok', 'OK'], ['low', 'Low']]],
];
const AREAS = ['Lower back', 'Upper back', 'Neck', 'Ribs or chest', 'Hips', 'Legs', 'Arms', 'Shoulders', 'Head', 'Stomach'];
const WARNING_FLAGS = [
  'Back pain with leg weakness or numbness',
  'Swollen or painful leg',
  'Chest pain or sudden shortness of breath',
  'Shaking chills',
  'Unusual bleeding or bruising',
  'Confusion or extreme drowsiness',
];
const checkinsOn = (day) => (S.state.checkins || []).filter((c) => c.date === day).sort(byWhen);
const choiceLabel = (key, val) => CHOICES.find(([k]) => k === key)?.[2].find(([v]) => v === val)?.[1] || val;

function openCheckinSheet() {
  const now = localNow();
  const prev = checkinsOn(now.date).at(-1); // start from today's answers so updating is quick
  const symptoms = { ...(prev?.symptoms || {}) };
  const areas = new Set(prev?.areas || []);
  const flags = new Set();

  const pickRow = (key, options, multi = false, cls = '') => {
    const btns = options.map(([val, label]) => h('button', {
      type: 'button', class: 'chip-toggle', 'aria-pressed': String(multi ? areas.has(val) : symptoms[key] === val),
      onclick: (e) => {
        if (multi) {
          areas.has(val) ? areas.delete(val) : areas.add(val);
          e.currentTarget.setAttribute('aria-pressed', String(areas.has(val)));
        } else {
          symptoms[key] = symptoms[key] === val ? undefined : val;
          btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === symptoms[key])));
        }
      },
    }, label));
    return h('div', { class: `chips ${cls}` }, btns);
  };
  const note = h('textarea', { rows: 2, placeholder: 'Anything else? (optional)' }, prev?.note || '');

  const form = h('form', { class: 'form checkin', onsubmit: async (e) => {
    e.preventDefault();
    const ok = await mutate('checkin', { method: 'POST', body: {
      symptoms, areas: [...areas], flags: [...flags], note: note.value, by: S.name,
    } }, flags.size ? null : 'Check-in saved');
    if (!ok) return;
    close();
    if (flags.size) showUrgent('Warning sign', [...flags].map((f) => `• ${f}`));
  } },
  SYMPTOMS.map(([key, label]) => h('div', { class: 'checkin-q' },
    h('span', { class: 'label' }, label), pickRow(key, SCALE.map((w, i) => [i, w]), false, 'scale'))),
  CHOICES.map(([key, label, opts]) => h('div', { class: 'checkin-q' }, h('span', { class: 'label' }, label), pickRow(key, opts))),
  h('div', { class: 'checkin-q' }, h('span', { class: 'label' }, 'Where does it hurt?'), pickRow('areas', AREAS.map((a) => [a, a]), true)),
  h('fieldset', { class: 'fieldset warn-box' }, h('legend', { class: 'label' }, 'Any of these? (call the care team)'),
    WARNING_FLAGS.map((f) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', onchange: (e) => { e.target.checked ? flags.add(f) : flags.delete(f); } }), f))),
  note,
  h('button', { class: 'btn primary block', type: 'submit' }, 'Save check-in'));
  const close = openSheet(prev ? 'Update today’s check-in' : 'Daily check-in', form);
}

// "Tiredness moderate, Numbness mild · Constipated · Hurts: Lower back, Neck"
function checkinSummary(c) {
  const parts = [];
  const sx = SYMPTOMS.filter(([k]) => c.symptoms[k] > 0).map(([k, label]) => `${label.split(' (')[0]} ${SCALE[c.symptoms[k]].toLowerCase()}`);
  if (sx.length) parts.push(sx.join(', '));
  const ch = CHOICES.filter(([k]) => c.symptoms[k] && !['normal', 'good'].includes(c.symptoms[k]))
    .map(([k, label]) => (k === 'bowels' ? choiceLabel(k, c.symptoms[k]) : `${label} ${choiceLabel(k, c.symptoms[k]).toLowerCase()}`));
  if (ch.length) parts.push(ch.join(', '));
  if (c.areas.length) parts.push(`Hurts: ${c.areas.join(', ')}`);
  if (c.flags.length) parts.push(`⚠️ ${c.flags.join('; ')}`);
  return parts.join(' · ') || 'No symptoms';
}

// ---------- meds ----------

function viewMeds() {
  const meds = S.state.meds;
  const card = (m) => h('div', { class: `row tappable${m.active ? '' : ' paused'}`, role: 'button', tabindex: '0', onclick: () => openMedForm(m),
    onkeydown: (e) => { if (e.key === 'Enter') openMedForm(m); } },
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, h('span', { class: 'name-wrap' }, m.name, infoButton(m)), m.dose ? h('span', { class: 'dose' }, ` ${m.dose}`) : null,
        m.active ? null : h('span', { class: 'chip' }, 'On hold'),
        m.status === 'confirm' ? h('span', { class: 'chip confirm' }, 'Confirm') : null),
      h('div', { class: 'row-sub' }, scheduleText(m)),
      m.instructions ? h('div', { class: 'row-sub' }, m.instructions) : null,
      m.end_date ? h('div', { class: 'row-sub' }, `Until ${fmtDate(m.end_date, { month: 'short', day: 'numeric' })}`) : null,
      m.pills_left != null ? h('div', { class: `row-sub${needsRefill(m) ? ' late' : ''}` }, `${amountText(m.pills_left, m)} left${needsRefill(m) ? ' · refill soon' : ''}`) : null),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));

  // Long lists read better in groups: each blister pack, then the rest.
  const inPack = (m) => m.active && !m.as_needed && (m.slots || []).some(Boolean);
  const groups = [
    ...['BK', 'LU', 'SP', 'BD'].map((code) => [`${packName(code)} blister pack`, meds.filter((m) => inPack(m) && m.slots.includes(code))]),
    ['Other scheduled', meds.filter((m) => m.active && !m.as_needed && !inPack(m))],
    ['As needed', meds.filter((m) => m.active && m.as_needed && m.kind !== 'clinic')],
    ['Given at the clinic', meds.filter((m) => m.active && m.kind === 'clinic')],
    ['On hold', meds.filter((m) => !m.active)],
  ].filter(([, list]) => list.length);

  return [
    header('Medications', null, h('button', { class: 'btn primary small', onclick: () => openMedForm() }, '+ Add')),
    h('button', { class: 'btn ghost block', onclick: () => openImport() }, 'Import from a CSV file'),
    meds.length ? groups.map(([title, list]) => section(`${title} (${list.length})`, h('div', { class: 'list' }, list.map(card))))
      : empty('Add each medication with its dose and the times it’s taken. Reminders go out at those times.',
        h('button', { class: 'btn primary', onclick: () => openMedForm() }, 'Add a medication')),
  ];
}

// ---------- CSV import ----------

// Reads CSV text into objects keyed by the (lower-cased) header row. Handles quoted cells.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...data] = rows.filter((r) => r.some((x) => x.trim()));
  if (!head) return [];
  const keys = head.map((k) => k.trim().toLowerCase());
  return data.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const DAY_CODES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// Turns one CSV row (see medications-example.csv for the columns) into a medication, plus notes for the preview.
function csvToMed(r) {
  const list = (s) => (s || '').split(/[;|]/).map((x) => x.trim()).filter(Boolean);
  const type = (r.schedule_type || '').toLowerCase();
  const times = list(r.times).filter((t) => /^\d{1,2}:\d{2}$/.test(t)).map((t) => t.padStart(5, '0'));
  const days = list(r.days_of_week).map((d) => DAY_CODES[d.slice(0, 3).toLowerCase()]).filter((d) => d != null);
  const clinic = type === 'clinic';
  const hold = type === 'on_hold' || /hold/i.test(r.status || '');
  const prn = type === 'prn';
  const noTime = !clinic && !prn && !hold && !times.length;
  const unitRaw = (r.dose_unit || '').toLowerCase();
  const mass = /^(mg|mcg|g|units?|iu)$/.test(unitRaw);
  const unit = /tab|cap|pill/.test(unitRaw) ? 'pill' : unitRaw === 'ml' ? 'mL' : /packet|sachet/.test(unitRaw) ? 'packet'
    : /capful/.test(unitRaw) ? 'capful' : /puff/.test(unitRaw) ? 'puff' : /patch/.test(unitRaw) ? 'patch' : /drop/.test(unitRaw) ? 'drop'
      : mass || /gel|ointment|cream|injection/.test((r.form || '').toLowerCase()) ? 'dose' : 'pill';
  const amount = parseFloat(r.dose_amount);
  const range = /\d\s*-\s*\d/.test(r.dose_amount || '');
  const inPack = /^y/i.test(r.in_blister_pack || '');
  const packSlots = list(r.blister_slot).map((s) => s.toUpperCase());
  const warnings = [];
  if (noTime) warnings.push('No time in the file, so it’s added as “log when taken”.');
  if (range && !mass) warnings.push(`Dose is a range (${r.dose_amount} ${r.dose_unit}); the usual amount is set to the lower number.`);
  if (/confirm/i.test(r.status || '')) warnings.push('Marked “confirm” in the file.');
  return {
    ext_id: r.id, name: r.name, generic: r.generic_name,
    dose: mass && r.dose_amount ? `${r.dose_amount} ${r.dose_unit}`
      : [r.strength, /tablet|capsule/i.test(r.form || '') || (r.name || '').toLowerCase().includes((r.form || '').toLowerCase()) ? '' : r.form].filter(Boolean).join(' '),
    instructions: r.instructions, about: r.purpose,
    notes: [r.notes, r.with_food && /^y/i.test(r.with_food) ? 'Take with food.' : '',
      r.route && !/oral/i.test(r.route) ? `Route: ${r.route}.` : ''].filter(Boolean).join(' '),
    as_needed: prn || clinic || noTime || (hold && !times.length),
    kind: clinic ? 'clinic' : 'regular',
    times: prn || clinic || noTime ? [] : times,
    slots: inPack && !prn ? times.map((_, i) => packSlots[i] || packSlots[0] || '') : [],
    days, interval_days: type === 'every_n_days' ? Number(r.interval_days) || 0 : 0,
    start_date: r.start_date || null, end_date: r.end_date || null,
    pills_per_dose: !mass && amount > 0 ? amount : 1, unit,
    status: hold ? 'hold' : /confirm/i.test(r.status || '') ? 'confirm' : 'active',
    prn_min_hours: r.prn_min_hours_between || null, prn_max_day: r.prn_max_per_day || null,
    warnings,
  };
}

// Finds the existing medication a row most likely is (same CSV id, or a close name), so it's updated, not duplicated.
function matchExisting(row, claimed) {
  const free = S.state.meds.filter((m) => !claimed.has(m.id));
  const byId = free.find((m) => m.ext_id && m.ext_id === row.ext_id);
  if (byId) return byId;
  const compact = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');
  const theirs = [row.generic, row.name].map(compact).filter((s) => s.length >= 5);
  const close = (a, b) => a === b || (Math.min(a.length, b.length) >= 7 && (a.includes(b) || b.includes(a)))
    || (a.length >= 8 && editDistance(a, b) <= 2);
  const hits = free.filter((m) => [m.generic, m.name].map(compact).filter((s) => s.length >= 5).some((ours) => theirs.some((t) => close(ours, t))));
  return hits.find((m) => !!m.as_needed === !!row.as_needed) || hits[0] || null;
}

function openImport() {
  const fileIn = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', class: 'file-input' });
  const body = h('div', { class: 'form' },
    h('p', {}, 'Choose a CSV file of medications, for example the list from the pharmacy. You’ll see everything before it’s saved.'),
    fileIn,
    h('p', { class: 'hint' }, 'Columns used: name, generic_name, strength, dose_amount, dose_unit, purpose, schedule_type, times, days_of_week, '
      + 'interval_days, start_date, end_date, in_blister_pack, blister_slot, status, instructions, notes and the prn limits.'));
  const close = openSheet('Import medications', body);
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files[0];
    if (!file) return;
    const rows = parseCsv(await file.text());
    if (!rows.length || !('name' in rows[0])) return toast('That file doesn’t look like a medication list (no “name” column).', true);
    close();
    showImportPreview(rows.map(csvToMed).filter((m) => m.name));
  });
}

function showImportPreview(meds) {
  const claimed = new Set();
  const plan = meds.map((m) => {
    const match = matchExisting(m, claimed);
    if (match) claimed.add(match.id);
    return { m, target: match ? String(match.id) : 'new' };
  });
  const untouched = S.state.meds.filter((x) => !claimed.has(x.id));
  const counts = () => {
    const n = plan.filter((p) => p.target === 'new').length;
    const u = plan.filter((p) => /^\d+$/.test(p.target)).length;
    return `${n} new · ${u} update existing · ${plan.length - n - u} skipped`;
  };
  const summary = h('p', { class: 'muted' }, counts());
  const holdOthers = h('input', { type: 'checkbox' });

  const rows = plan.map((p) => {
    const m = p.m;
    const chips = [
      ...[...new Set(m.slots.filter(Boolean))].map((s) => h('span', { class: 'chip pack' }, `${packName(s)} pack`)),
      m.status === 'confirm' ? h('span', { class: 'chip confirm' }, 'Confirm') : null,
      m.status === 'hold' ? h('span', { class: 'chip' }, 'On hold') : null,
      m.kind === 'clinic' ? h('span', { class: 'chip' }, 'Clinic') : null,
    ];
    return h('div', { class: 'row import-row' },
      h('div', { class: 'row-main' },
        h('div', { class: 'row-title' }, m.name, m.dose ? h('span', { class: 'dose' }, ` ${m.dose}`) : null),
        h('div', { class: 'row-sub' }, scheduleText(m)),
        h('div', { class: 'chips' }, chips),
        m.warnings.map((w) => h('div', { class: 'row-sub late' }, w)),
        h('select', { class: 'import-target', 'aria-label': `What to do with ${m.name}`,
          onchange: (e) => { p.target = e.target.value; summary.textContent = counts(); } },
        h('option', { value: 'new', selected: p.target === 'new' }, 'Add as a new medication'),
        S.state.meds.map((x) => h('option', { value: String(x.id), selected: p.target === String(x.id) }, `Update “${x.name}” (keeps its history)`)),
        h('option', { value: 'skip' }, 'Skip'))));
  });

  const run = async () => {
    const chosen = plan.filter((p) => p.target !== 'skip');
    const targets = chosen.filter((p) => p.target !== 'new').map((p) => p.target);
    if (new Set(targets).size !== targets.length) return toast('Two rows are set to update the same medication. Change one of them.', true);
    const payload = chosen.map(({ m, target }) => {
      const { warnings, ...med } = m;
      const old = target === 'new' ? null : S.state.meds.find((x) => String(x.id) === target);
      return old ? { ...med, id: old.id, pills_left: old.pills_left, refill_at: old.refill_at, about: med.about || old.about } : med;
    });
    if (holdOthers.checked) {
      const used = new Set(targets);
      for (const x of untouched.filter((u) => !used.has(String(u.id)) && u.active)) {
        payload.push({ ...x, status: 'hold', active: false });
      }
    }
    try {
      const r = await api('import', { method: 'POST', body: { meds: payload } });
      close();
      await refresh();
      toast(`Imported ${r.count} medications`);
    } catch (e) {
      toast(e.message, true);
    }
  };

  const close = openSheet('Check before importing', h('div', { class: 'form' },
    summary,
    h('p', { class: 'hint' }, 'Rows that look like a medication you already have are set to update it, so its history is kept. Change any choice below.'),
    h('div', { class: 'list' }, rows),
    untouched.length ? h('label', { class: 'check' }, holdOthers,
      h('span', {}, `Put the ${untouched.length} medication${untouched.length === 1 ? '' : 's'} not in the file on hold`,
        h('span', { class: 'hint block' }, untouched.map((x) => x.name).join(', ')))) : null,
    h('button', { class: 'btn primary block', type: 'button', onclick: run }, 'Import')));
}

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

function openSheet(title, content) {
  const close = () => { overlay.remove(); document.body.classList.remove('sheet-open'); };
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } },
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, '✕')),
      content));
  document.body.append(overlay);
  document.body.classList.add('sheet-open');
  return close;
}

function openMedForm(med) {
  const m = med || { name: '', dose: '', instructions: '', times: ['08:00'], days: [], as_needed: 0, pills_left: null, pills_per_dose: 1, refill_at: null, start_date: null, end_date: null, active: 1 };
  const days = new Set(m.days.length ? m.days : [0, 1, 2, 3, 4, 5, 6]);

  const timesBox = h('div', { class: 'times' });
  const addTime = (value, slot = '') => {
    const row = h('div', { class: 'time-row' },
      h('input', { type: 'time', class: 'time-input', value, required: true }),
      h('select', { class: 'slot-input', 'aria-label': 'Blister pack' },
        h('option', { value: '' }, 'Not in a pack'),
        Object.entries({ BK: 'Breakfast', LU: 'Lunch', SP: 'Supper', BD: 'Bedtime' }).map(([code, label]) =>
          h('option', { value: code, selected: slot === code }, `${label} pack`)),
        slot && !['BK', 'LU', 'SP', 'BD'].includes(slot) ? h('option', { value: slot, selected: true }, slot) : null),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove time', onclick: () => row.remove() }, '✕'));
    timesBox.append(row);
  };
  m.times.forEach((t, i) => addTime(t, (m.slots || [])[i] || ''));

  const dayChips = h('div', { class: 'chips' }, DAY_NAMES.map((name, i) => h('button', {
    type: 'button', class: 'chip-toggle', 'aria-pressed': String(days.has(i)),
    onclick: (e) => { days.has(i) ? days.delete(i) : days.add(i); e.currentTarget.setAttribute('aria-pressed', String(days.has(i))); },
  }, name)));

  const scheduleBox = h('div', { class: 'schedule', hidden: !!m.as_needed || m.kind === 'clinic' },
    h('span', { class: 'label' }, 'Times'), timesBox,
    h('button', { type: 'button', class: 'btn small ghost', onclick: () => addTime(timesBox.children.length ? '20:00' : '08:00') }, '+ Add a time'),
    h('span', { class: 'label' }, 'Days'), dayChips,
    field('Or every … days', h('input', { name: 'interval_days', type: 'number', inputmode: 'numeric', min: 0, max: 90,
      value: Number(m.interval_days) > 1 ? String(m.interval_days) : '', placeholder: 'e.g. 2 for every other day' }),
    'Counted from the start date (under “Refills and dates”). Leave blank to use the days above.'));
  const limitsBox = h('div', { class: 'grid2', hidden: !m.as_needed || m.kind === 'clinic' },
    field('Least hours between doses', h('input', { name: 'prn_min_hours', type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: m.prn_min_hours ?? '' })),
    field('Most doses a day', h('input', { name: 'prn_max_day', type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: m.prn_max_day ?? '' })));

  const val = (v) => (v == null ? '' : String(v));
  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    const f = form.elements;
    const ok = await mutate('meds', { method: 'POST', body: {
      id: med?.id,
      name: f.name.value, dose: f.dose.value, instructions: f.instructions.value, about: f.about.value,
      as_needed: f.as_needed.checked,
      times: [...form.querySelectorAll('.time-input')].map((i) => i.value),
      slots: [...form.querySelectorAll('.slot-input')].map((s) => s.value),
      days: [...days], interval_days: f.interval_days.value,
      ext_id: m.ext_id, generic: f.generic.value, notes: f.notes.value, status: f.status.value,
      kind: f.clinic.checked ? 'clinic' : 'regular', prn_min_hours: f.prn_min_hours.value, prn_max_day: f.prn_max_day.value,
      pills_left: f.pills_left.value, pills_per_dose: f.pills_per_dose.value, refill_at: f.refill_at.value, unit: f.unit.value,
      start_date: f.start_date.value, end_date: f.end_date.value,
      active: f.status.value !== 'hold',
    } }, med ? 'Saved' : 'Medication added');
    if (ok) close();
  } },
  field('Name', h('input', { name: 'name', required: true, value: m.name, placeholder: 'e.g. Ondansetron', autocapitalize: 'words',
    onchange: (e) => {
      const about = e.target.form.elements.about;
      const guide = lookupMedInfo(e.target.value);
      if (guide && !about.value.trim()) about.value = guide;
    } })),
  field('Generic name', h('input', { name: 'generic', value: m.generic || '', placeholder: 'Optional, e.g. hydromorphone' })),
  h('div', { class: 'grid2' },
    field('Dose', h('input', { name: 'dose', value: m.dose, placeholder: 'e.g. 8 mg' })),
    field('Counted in', h('select', { name: 'unit' }, Object.entries(UNIT_NAMES).map(([key, [, plural]]) =>
      h('option', { value: key, selected: (m.unit || 'pill') === key }, plural))))),
  field('Instructions', h('input', { name: 'instructions', value: m.instructions, placeholder: 'e.g. Take with food' })),
  field('What it\'s for', h('textarea', { name: 'about', rows: 3, placeholder: 'In everyday words, e.g. "Stops nausea after chemo"' }, m.about || (med ? lookupMedInfo(m.name) || '' : '')),
    'Filled in automatically for many common medicines. Change it to whatever makes sense to you.'),
  h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'as_needed', checked: !!m.as_needed,
    onchange: (e) => { scheduleBox.hidden = e.target.checked; limitsBox.hidden = !e.target.checked; } }), 'Taken only as needed (no set times)'),
  limitsBox,
  scheduleBox,
  h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'clinic', checked: m.kind === 'clinic',
    onchange: (e) => { scheduleBox.hidden = e.target.checked || form.elements.as_needed.checked; } }),
  h('span', {}, 'Given at the clinic', h('span', { class: 'hint block' }, 'Recorded only: no reminders, logged when it’s given.'))),
  h('details', { class: 'more', open: !!(m.pills_left != null || m.start_date || m.end_date) },
    h('summary', {}, 'Refills and dates'),
    h('div', { class: 'grid2' },
      field('Amount on hand', h('input', { name: 'pills_left', type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: val(m.pills_left) })),
      field('Usual amount per dose', h('input', { name: 'pills_per_dose', type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: val(m.pills_per_dose) }))),
    field('Remind to refill at', h('input', { name: 'refill_at', type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: val(m.refill_at), placeholder: 'e.g. 7' }), 'Counts down each time a dose is checked off.'),
    h('div', { class: 'grid2' },
      field('Start date', h('input', { name: 'start_date', type: 'date', value: val(m.start_date) })),
      field('End date', h('input', { name: 'end_date', type: 'date', value: val(m.end_date) }))),
    h('p', { class: 'hint' }, 'Dates are handy for meds taken only on certain days of a treatment cycle.')),
  field('Status', h('select', { name: 'status' },
    [['active', 'Active'], ['confirm', 'Active, confirm with pharmacist'], ['hold', 'On hold (no reminders)']].map(([v, label]) =>
      h('option', { value: v, selected: (m.status || (m.active ? 'active' : 'hold')) === v }, label)))),
  field('Pharmacist / care team notes', h('textarea', { name: 'notes', rows: 2, placeholder: 'e.g. Ask about the dose with kidney problems' }, m.notes || '')),
  h('button', { class: 'btn primary block', type: 'submit' }, med ? 'Save' : 'Add medication'),
  med ? h('button', { type: 'button', class: 'btn danger block', onclick: async () => {
    if (!confirm(`Delete ${med.name} and its history?`)) return;
    if (await mutate(`meds/${med.id}`, { method: 'DELETE' }, 'Deleted')) close();
  } }, 'Delete medication') : null);

  const close = openSheet(med ? 'Edit medication' : 'New medication', form);
}

// ---------- "what is it for?" ----------

function infoButton(med) {
  return h('button', {
    type: 'button', class: 'info-btn', 'aria-label': `What is ${med.name} for?`,
    onclick: (e) => { e.stopPropagation(); openMedInfo(med); },
  }, 'i');
}

function openMedInfo(med) {
  const about = med.about || lookupMedInfo(`${med.name} ${med.generic || ''}`);
  const block = (label, ...kids) => h('div', { class: 'info-block' }, h('span', { class: 'label' }, label), kids);
  const close = openSheet(medLabel(med), h('div', { class: 'form' },
    block('What it’s for', about
      ? h('p', { class: 'info-text' }, about)
      : h('p', { class: 'muted' }, 'No description yet. Tap “Edit” to add one in your own words.')),
    med.instructions ? block('Instructions', h('p', {}, med.instructions)) : null,
    med.status === 'confirm' ? h('p', { class: 'chip confirm' }, 'Confirm this one with the pharmacist') : null,
    med.notes ? block('Pharmacist / care team notes', h('p', {}, med.notes)) : null,
    block('When', h('p', {}, scheduleText(med))),
    med.pills_left != null ? block('On hand', h('p', {}, amountText(med.pills_left, med))) : null,
    h('p', { class: 'hint' }, 'General information, not medical advice. The care team knows exactly why it was prescribed; ask them if anything is unclear.'),
    h('button', { type: 'button', class: 'btn ghost block', onclick: () => { close(); openMedForm(med); } }, 'Edit')));
}

// ---------- appointments ----------

function apptRow(a) {
  const date = a.at.slice(0, 10);
  return h('button', { class: 'row tappable appt', onclick: () => openApptForm(a) },
    h('div', { class: 'date-badge' }, h('span', {}, fmtDate(date, { month: 'short' })), h('strong', {}, String(Number(date.slice(8))))),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, a.title),
      h('div', { class: 'row-sub' }, `${fmtDate(date, { weekday: 'short' })} · ${fmtTime(a.at.slice(11))}${a.location ? ` · ${a.location}` : ''}`),
      a.notes ? h('div', { class: 'row-sub notes-preview' }, a.notes) : null),
    h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
}

// ---------- circle of care ----------

const telHref = (n) => `tel:${n.replace(/[^\d+]/g, '')}`;
const ROLES = ['Hematologist / oncologist', 'Oncology nurse', 'Nurse navigator', 'Pharmacist', 'Family doctor',
  'Palliative care', 'Home care nurse', 'Social worker', 'Dietitian', 'Clinic', 'Other'];

function openCircle() {
  (S.cal ||= { month: localNow().date.slice(0, 7), sel: localNow().date }).mode = 'circle';
  setTab('appts');
}

function viewCircle() {
  const people = S.state.contacts || [];
  const card = (c) => h('div', { class: `card contact${c.urgent ? ' urgent' : ''}` },
    h('div', { class: 'contact-head' },
      h('div', {},
        h('strong', { class: 'contact-name' }, c.name),
        h('div', { class: 'row-sub' }, [c.role, c.org].filter(Boolean).join(' · '))),
      h('button', { class: 'link', onclick: () => openContactForm(c) }, 'Edit')),
    c.urgent ? h('span', { class: 'chip urgent-chip' }, 'Call for fevers & warning signs') : null,
    h('div', { class: 'contact-actions' },
      c.phone ? h('a', { class: 'btn small primary', href: telHref(c.phone) }, `Call ${c.phone}`) : null,
      c.phone2 ? h('a', { class: 'btn small ghost', href: telHref(c.phone2) }, `After hours ${c.phone2}`) : null,
      c.email ? h('a', { class: 'btn small ghost', href: `mailto:${c.email}` }, 'Email') : null),
    c.notes ? h('p', { class: 'row-sub contact-notes' }, c.notes) : null);
  return [
    people.length ? people.map(card)
      : empty('Add the doctors, nurses, pharmacist and clinic numbers so they’re one tap away.',
        h('button', { class: 'btn primary', onclick: () => openContactForm() }, 'Add a person')),
    people.length ? h('button', { class: 'btn ghost block', onclick: () => openContactForm() }, '+ Add a person') : null,
    h('p', { class: 'hint' }, 'People marked “Call for fevers & warning signs” appear on the red “Call the care team now” screen.'),
  ];
}

function openContactForm(c) {
  const p = c || { name: '', role: '', org: '', phone: '', phone2: '', email: '', notes: '', urgent: 0 };
  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    const f = form.elements;
    const ok = await mutate('contacts', { method: 'POST', body: {
      id: c?.id, name: f.name.value, role: f.role.value, org: f.org.value, phone: f.phone.value,
      phone2: f.phone2.value, email: f.email.value, notes: f.notes.value, urgent: f.urgent.checked,
    } }, c ? 'Saved' : 'Added to the circle of care');
    if (ok) close();
  } },
  field('Name', h('input', { name: 'name', required: true, value: p.name, placeholder: 'e.g. Dr. Patel', autocapitalize: 'words' })),
  field('Role', h('input', { name: 'role', value: p.role, list: 'role-list', placeholder: 'Pick or type' })),
  h('datalist', { id: 'role-list' }, ROLES.map((r) => h('option', { value: r }))),
  field('Clinic or hospital', h('input', { name: 'org', value: p.org, placeholder: 'e.g. Cancer Centre, 3rd floor' })),
  h('div', { class: 'grid2' },
    field('Phone', h('input', { name: 'phone', type: 'tel', value: p.phone })),
    field('After hours', h('input', { name: 'phone2', type: 'tel', value: p.phone2 }))),
  field('Email', h('input', { name: 'email', type: 'email', value: p.email, autocapitalize: 'off' })),
  field('Notes', h('textarea', { name: 'notes', rows: 2, placeholder: 'e.g. Best to call before 3 PM; fax for refills' }, p.notes)),
  h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'urgent', checked: !!p.urgent }),
    h('span', {}, 'Call for fevers & warning signs', h('span', { class: 'hint block' }, 'Shows on the red “Call the care team now” screen.'))),
  h('button', { class: 'btn primary block', type: 'submit' }, c ? 'Save' : 'Add'),
  c ? h('button', { type: 'button', class: 'btn danger block', onclick: async () => {
    if (confirm(`Remove ${c.name} from the circle of care?`) && await mutate(`contacts/${c.id}`, { method: 'DELETE' }, 'Removed')) close();
  } }, 'Remove') : null);
  const close = openSheet(c ? 'Edit contact' : 'Add to the circle of care', form);
}

function viewAppts() {
  const now = localNow();
  const mode = (S.cal ||= { month: now.date.slice(0, 7), sel: now.date }).mode || 'appts';
  const switcher = h('div', { class: 'segmented two', role: 'group', 'aria-label': 'Visits section' },
    [['appts', 'Appointments'], ['circle', 'Circle of care']].map(([m, label]) => h('button', {
      type: 'button', 'aria-pressed': String(mode === m), onclick: () => { S.cal.mode = m; render(); },
    }, label)));
  if (mode === 'circle') {
    return [header('Circle of care', null, h('button', { class: 'btn primary small', onclick: () => openContactForm() }, '+ Add')), switcher, viewCircle()];
  }
  const C = (S.cal ||= { month: now.date.slice(0, 7), sel: now.date });
  const isPast = (a) => wallMs(a.at.slice(0, 10), a.at.slice(11)) < now.ms - 60 * 60e3;
  const upcoming = S.state.appts.filter((a) => !isPast(a));
  const past = S.state.appts.filter(isPast).reverse().slice(0, 10);
  const onDay = S.state.appts.filter((a) => a.at.slice(0, 10) === C.sel);

  return [
    header('Appointments', null, h('button', { class: 'btn primary small', onclick: () => openApptForm(null, C.sel) }, '+ Add')),
    switcher,
    monthCalendar(C, now),
    section(fmtDate(C.sel, { weekday: 'long', month: 'long', day: 'numeric' }),
      onDay.length
        ? h('div', { class: 'list' }, onDay.map(apptRow))
        : h('div', { class: 'card day-empty' },
          h('span', { class: 'muted' }, 'No appointments this day.'),
          h('button', { class: 'btn small', onclick: () => openApptForm(null, C.sel) }, '+ Add one'))),
    upcoming.length ? section('All upcoming', h('div', { class: 'list' }, upcoming.map(apptRow))) : null,
    past.length ? section('Recent', h('div', { class: 'list muted-list' }, past.map(apptRow))) : null,
  ];
}

// A month grid: dots mark days with appointments; tap a day to list them below.
function monthCalendar(C, now) {
  const [y, m] = C.month.split('-').map(Number);
  const first = `${C.month}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const counts = {};
  for (const a of S.state.appts) if (a.at.startsWith(C.month)) counts[a.at.slice(0, 10)] = (counts[a.at.slice(0, 10)] || 0) + 1;
  const shift = (n) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
    C.month = d;
    C.sel = d === now.date.slice(0, 7) ? now.date : `${d}-01`;
    render();
  };

  const cells = [];
  for (let i = 0; i < weekday(first); i++) cells.push(h('span', { class: 'cal-blank', 'aria-hidden': 'true' }));
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${C.month}-${String(d).padStart(2, '0')}`;
    const n = counts[date] || 0;
    cells.push(h('button', {
      class: `cal-day${date === now.date ? ' today' : ''}${date === C.sel ? ' selected' : ''}${date < now.date ? ' past' : ''}`,
      'aria-pressed': String(date === C.sel),
      'aria-label': `${fmtDate(date, { weekday: 'long', month: 'long', day: 'numeric' })}${n ? `, ${n} appointment${n > 1 ? 's' : ''}` : ''}`,
      onclick: () => { C.sel = date; render(); },
    }, h('span', { class: 'cal-num' }, String(d)),
    h('span', { class: 'cal-dots', 'aria-hidden': 'true' }, Array.from({ length: Math.min(n, 3) }, () => h('i')))));
  }

  const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return h('div', { class: 'card calendar' },
    h('div', { class: 'cal-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => shift(-1) }, '‹'),
      h('strong', {}, monthName),
      C.month !== now.date.slice(0, 7)
        ? h('button', { class: 'btn small ghost', onclick: () => { C.month = now.date.slice(0, 7); C.sel = now.date; render(); } }, 'Today')
        : null,
      h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => shift(1) }, '›')),
    h('div', { class: 'cal-grid' },
      ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => h('span', { class: 'cal-wd', 'aria-hidden': 'true' }, d)),
      cells));
}

const REMIND_OPTIONS = [[10080, '1 week before'], [1440, '1 day before'], [120, '2 hours before'], [60, '1 hour before'], [30, '30 minutes before']];

function openApptForm(appt, onDate) {
  const a = appt || { title: '', at: `${onDate || addDays(localNow().date, 1)}T09:00`, location: '', notes: '', remind: [1440, 120] };
  const form = h('form', { class: 'form', onsubmit: async (e) => {
    e.preventDefault();
    const f = form.elements;
    const ok = await mutate('appts', { method: 'POST', body: {
      id: appt?.id, title: f.title.value, date: f.date.value, time: f.time.value,
      location: f.location.value, notes: f.notes.value,
      remind: REMIND_OPTIONS.map(([m]) => m).filter((m) => f[`r${m}`].checked),
    } }, appt ? 'Saved' : 'Appointment added');
    if (ok) close();
  } },
  field('What', h('input', { name: 'title', required: true, value: a.title, placeholder: 'e.g. Oncology check-in, Infusion', autocapitalize: 'sentences' })),
  h('div', { class: 'grid2' },
    field('Date', h('input', { name: 'date', type: 'date', required: true, value: a.at.slice(0, 10) })),
    field('Time', h('input', { name: 'time', type: 'time', required: true, value: a.at.slice(11, 16) }))),
  field('Where', h('input', { name: 'location', value: a.location, placeholder: 'e.g. Cancer Center, 3rd floor' })),
  field('Notes', h('textarea', { name: 'notes', rows: 3, placeholder: 'Questions to ask, what to bring…' }, a.notes)),
  h('fieldset', { class: 'fieldset' }, h('legend', { class: 'label' }, 'Remind'),
    REMIND_OPTIONS.map(([m, label]) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', name: `r${m}`, checked: a.remind.includes(m) }), label))),
  h('button', { class: 'btn primary block', type: 'submit' }, appt ? 'Save' : 'Add appointment'),
  appt ? h('button', { type: 'button', class: 'btn danger block', onclick: async () => {
    if (!confirm(`Delete “${appt.title}”?`)) return;
    if (await mutate(`appts/${appt.id}`, { method: 'DELETE' }, 'Deleted')) close();
  } }, 'Delete appointment') : null);
  const close = openSheet(appt ? 'Edit appointment' : 'New appointment', form);
}

// ---------- notes & history ----------

const FEELINGS = [[1, '😣', 'Rough'], [2, '😕', 'Low'], [3, '😐', 'Okay'], [4, '🙂', 'Good'], [5, '😄', 'Great']];

function viewNotes() {
  const d = S.noteDraft;
  const feelingBtns = h('div', { class: 'feelings', role: 'group', 'aria-label': `How is ${who()} feeling?` },
    FEELINGS.map(([v, emoji, label]) => h('button', {
      type: 'button', class: 'feeling', 'aria-pressed': String(d.feeling === v),
      onclick: () => { d.feeling = d.feeling === v ? null : v; render(); },
    }, h('span', { class: 'emoji' }, emoji), h('span', {}, label))));

  const ta = h('textarea', { rows: 3, placeholder: 'Symptoms, side effects, questions for the doctor…',
    oninput: (e) => { d.text = e.target.value; } }, d.text);

  const save = async () => {
    if (await mutate('journal', { method: 'POST', body: { text: d.text, feeling: d.feeling, by: S.name } }, 'Note saved')) {
      S.noteDraft = { text: '', feeling: null };
      ta.blur();
      render();
    }
  };

  const now = localNow();
  const byDate = new Map();
  for (const j of S.state.journal) {
    if (!byDate.has(j.date)) byDate.set(j.date, []);
    byDate.get(j.date).push(j);
  }

  return [
    header('Notes'),
    h('div', { class: 'card form' },
      h('span', { class: 'label' }, `How is ${who()} feeling today?`),
      feelingBtns, ta,
      h('button', { class: 'btn primary block', type: 'button', onclick: save }, 'Save note')),
    byDate.size ? section('Journal', [...byDate.entries()].map(([date, items]) =>
      h('div', { class: 'journal-day' },
        h('h3', { class: 'journal-date' }, dayLabel(date, now.date)),
        items.map((j) => h('article', { class: 'card note' },
          h('div', { class: 'note-head' },
            j.feeling ? h('span', { class: 'chip' }, `${FEELINGS[j.feeling - 1][1]} ${FEELINGS[j.feeling - 1][2]}`) : null,
            h('span', { class: 'muted small' }, `${fmtStamp(j.created_at)}${j.created_by ? ` · ${j.created_by}` : ''}`),
            h('button', { class: 'icon-btn small', 'aria-label': 'Delete note', onclick: () => {
              if (confirm('Delete this note?')) mutate(`journal/${j.id}`, { method: 'DELETE' });
            } }, '✕')),
          j.text ? h('p', { class: 'note-text' }, j.text) : null))))) : null,
  ];
}

// ---------- report (for the doctor) ----------

const medLabel = (m) => [m.name, m.dose].filter(Boolean).join(' ');
const STATUS_TEXT = { taken: 'Taken', skipped: 'Skipped', missed: 'Not recorded' };

function buildReport() {
  const R = S.report;
  const now = localNow();
  const med = R.med === 'all' ? null : S.state.meds.find((m) => String(m.id) === R.med) || null;
  const totals = { taken: 0, skipped: 0, missed: 0, prn: 0 };
  const days = [];
  const end = R.days === 1 ? R.end || now.date : now.date;
  for (let i = 0; i < R.days; i++) {
    const day = addDays(end, -i);
    const slots = doseSlots(day)
      .filter((s) => !med || s.med.id === med.id)
      .map((s) => ({ ...s, status: slotStatus(s, day, now) }))
      .filter((s) => s.status !== 'upcoming');
    const prn = S.state.logs
      .filter((l) => l.date === day && l.time.length === 8 && l.status === 'taken' && (!med || l.med_id === med.id))
      .map((log) => ({ log, med: S.state.meds.find((m) => m.id === log.med_id) }))
      .filter((x) => x.med);
    const notes = med ? [] : S.state.journal.filter((j) => j.date === day);
    const pain = (S.state.pain || []).filter((p) => p.date === day).sort(byWhen);
    const water = waterTotal(day);
    const exercise = exerciseOn(day);
    const temps = tempsOn(day);
    const checkins = checkinsOn(day);
    const episodes = episodesOn(day);
    const bowel = bowelOn(day);
    for (const s of slots) totals[s.status]++;
    totals.prn += prn.length;
    if (slots.length || prn.length || notes.length || pain.length || water || exercise.length || temps.length || checkins.length || episodes.length || bowel.length) {
      days.push({ day, slots, prn, notes, pain, water, exercise, temps, checkins, episodes, bowel, taken: slots.filter((s) => s.status === 'taken').length });
    }
  }
  const counted = totals.taken + totals.skipped + totals.missed;
  return {
    med, now, days, totals, end,
    from: addDays(end, -(R.days - 1)),
    pct: counted ? Math.round((totals.taken / counted) * 100) : null,
  };
}

const shortDate = (d) => fmtDate(d, { month: 'short', day: 'numeric' });
const doseDetail = (s) => {
  if (s.log?.status !== 'taken') return STATUS_TEXT[s.status];
  const n = pillsOf(s.log, s.med);
  const pills = n !== 1 || (s.med.unit || 'pill') !== 'pill' ? `, ${amountText(n, s.med)}` : '';
  return s.log.taken_time
    ? `Taken at ${fmtTime(s.log.taken_time)}${pills} (logged later)`
    : `Taken${pills} (checked off ${fmtStamp(s.log.logged_at)})`;
};
const extraLabel = (p) => `${p.med.as_needed ? 'Taken as needed' : 'Extra dose'}, ${amountText(pillsOf(p.log, p.med), p.med)}`;

// A day's doses and pain ratings merged in time order, so a doctor can see
// e.g. "2:30 AM pain 8/10" right beside "2:30 AM hydromorphone, 2 pills".
function dayTimeline(d) {
  return [
    ...d.slots.map((s) => ({ t: s.t, kind: 'dose', med: s.med, status: s.status, text: doseDetail(s) })),
    ...d.prn.map((p) => ({ t: doseTime(p.log), kind: 'dose', med: p.med, status: 'taken', text: extraLabel(p) })),
    ...d.pain.map((p) => ({ t: p.time, kind: 'pain', p })),
    ...d.temps.map((x) => ({ t: x.time, kind: 'temp', x })),
    ...d.episodes.map((ep) => ({ t: ep.time, kind: 'episode', ep })),
    ...d.bowel.map((b) => ({ t: b.time, kind: 'bowel', b })),
  ].sort((a, b) => a.t.localeCompare(b.t) || (a.kind === 'dose' ? 1 : -1));
}

function reportText(r) {
  const t = r.totals;
  const lines = [
    'Medication report',
    r.from === r.end ? fmtDate(r.end, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : `${shortDate(r.from)} – ${shortDate(r.end)}, ${r.end.slice(0, 4)}`,
    r.med ? `${medLabel(r.med)} · ${scheduleText(r.med)}${r.med.instructions ? ` · ${r.med.instructions}` : ''}` : 'All medications',
    `Taken ${t.taken} of ${t.taken + t.skipped + t.missed} scheduled doses${r.pct != null ? ` (${r.pct}%)` : ''} · Skipped ${t.skipped} · Not recorded ${t.missed} · As-needed or extra doses ${t.prn}`,
  ];
  for (const d of r.days) {
    lines.push('', fmtDate(d.day, { weekday: 'short', month: 'short', day: 'numeric' }));
    for (const e of dayTimeline(d)) {
      lines.push(e.kind === 'pain'
        ? `  ${fmtTime(e.t)}  Pain ${e.p.score}/10 (${painWord(e.p.score).toLowerCase()})${e.p.note ? ` - ${e.p.note}` : ''}`
        : e.kind === 'bowel'
          ? `  ${fmtTime(e.t)}  Bowel movement: ${bowelText(e.b)}${e.b.note ? ` - ${e.b.note}` : ''}`
        : e.kind === 'episode'
          ? `  ${fmtTime(e.t)}  ${e.ep.name} (${e.ep.severity})${e.ep.area ? `, ${e.ep.area}` : ''}: ${e.ep.ended_at && !noLength(e.ep) ? `lasted ${fmtLength(epMinutes(e.ep))}` : lengthText(e.ep)}${e.ep.note ? ` - ${e.ep.note}` : ''}`
        : e.kind === 'temp'
          ? `  ${fmtTime(e.t)}  Temperature ${fmtTemp(e.x.temp_f)}${e.x.chills ? ' with chills' : ''}${e.x.temp_f >= feverF() ? ' (FEVER)' : ''}${e.x.note ? ` - ${e.x.note}` : ''}`
          : `  ${fmtTime(e.t)}  ${medLabel(e.med)}: ${e.text}`);
    }
    for (const c of d.checkins) lines.push(`  ${fmtTime(c.time)}  Check-in: ${checkinSummary(c)}`);
    if (d.water) lines.push(`  Water: ${fmtMl(d.water)}`);
    if (d.exercise.length) lines.push(`  Exercise: ${exerciseSummary(d.exercise)}`);
    for (const j of d.notes) {
      const feeling = j.feeling ? `Feeling ${FEELINGS[j.feeling - 1][2].toLowerCase()}. ` : '';
      lines.push(`  Note: ${feeling}${j.text}`.trimEnd());
    }
  }
  lines.push('', '"Not recorded" means the dose was not checked off in the app; it may still have been taken.');
  return lines.join('\n');
}

async function shareReport(r) {
  const text = reportText(r);
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Medication report', text });
      return;
    }
    await navigator.clipboard.writeText(text);
    toast('Report copied. Paste it into a message or email.');
  } catch (e) {
    if (e?.name !== 'AbortError') toast('Couldn’t share the report on this device.', true);
  }
}

// ---------- usage chart ----------

const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// Each medication keeps its color (fixed slot order by when it was added); past 8 they share gray.
function medColor(med) {
  const i = S.state.meds.map((m) => m.id).sort((a, b) => a - b).indexOf(med.id);
  return i >= 0 && i < 8 ? `var(--series-${i + 1})` : 'var(--series-other)';
}
const byAdded = (a, b) => a.id - b.id;

function takenEntries(day, med) {
  return S.state.logs
    .filter((l) => l.date === day && l.status === 'taken' && (!med || l.med_id === med.id))
    .map((log) => ({ log, med: S.state.meds.find((m) => m.id === log.med_id) }))
    .filter((x) => x.med)
    .map((x) => ({ ...x, time: doseTime(x.log), pills: pillsOf(x.log, x.med) }));
}

// A tap-to-show tooltip positioned in % of the chart area; tapping the same mark again hides it.
function chartTip() {
  const tip = h('div', { class: 'chart-tip', role: 'status', hidden: true });
  let tipFor = null;
  const showTip = (key, xPct, yPct, ...content) => {
    if (tipFor === key) { tip.hidden = true; tipFor = null; return; }
    tipFor = key;
    tip.replaceChildren(...content.flat(Infinity).filter(Boolean));
    tip.classList.toggle('below', yPct < 45);
    tip.hidden = false;
    tip.style.left = `${Math.min(Math.max(xPct, 18), 82)}%`;
    tip.style.top = `${yPct}%`;
  };
  return { tip, showTip };
}

const swatch = (med) =>h('i', { class: 'swatch', style: `background:${medColor(med)}` });

function usageChart(r) {
  const R = S.report;
  const days = [];
  for (let i = R.days - 1; i >= 0; i--) days.push(addDays(r.end, -i));
  const perDay = days.map((day) => ({ day, entries: takenEntries(day, r.med) }));

  const wrap = h('div', { class: 'card chart' });
  const { tip, showTip } = chartTip();

  const totalsByMed = new Map();
  for (const d of perDay) for (const e of d.entries) totalsByMed.set(e.med, (totalsByMed.get(e.med) || 0) + e.pills);

  const W = 340;
  let chart;
  if (R.days === 1) {
    // One day: a lane per medication, a dot at each dose's time.
    const day = r.end;
    const entries = perDay[0].entries;
    const unlogged = doseSlots(day)
      .filter((s) => (!r.med || s.med.id === r.med.id) && !s.log && slotStatus(s, day, r.now) === 'missed');
    const skipped = doseSlots(day).filter((s) => (!r.med || s.med.id === r.med.id) && s.log?.status === 'skipped');
    const lanes = [...new Set([...entries, ...unlogged, ...skipped].map((e) => e.med))].sort(byAdded);
    if (!lanes.length) return h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'Nothing recorded on this day.'));

    const ml = 10, mr = 10, laneH = 38, mt = 4, mb = 22;
    const H = mt + lanes.length * laneH + mb;
    const pw = W - ml - mr;
    const x = (t) => { const [hh, mm] = t.split(':').map(Number); return ml + ((hh * 60 + mm) / 1440) * pw; };
    const grid = [0, 6, 12, 18, 24].map((hr) => {
      const gx = ml + (hr / 24) * pw;
      return [
        svg('line', { x1: gx, x2: gx, y1: mt, y2: H - mb, class: 'grid' }),
        svg('text', { x: gx, y: H - 6, class: 'axis', 'text-anchor': hr === 0 ? 'start' : hr === 24 ? 'end' : 'middle' },
          ['12 AM', '6 AM', '12 PM', '6 PM', '12 AM'][hr / 6]),
      ];
    });
    const nowMark = day === r.now.date
      ? svg('line', { x1: x(r.now.time), x2: x(r.now.time), y1: mt, y2: H - mb, class: 'now-line' }) : null;

    const laneEls = lanes.map((med, j) => {
      const top = mt + j * laneH;
      const cy = top + 26;
      const marks = [];
      for (const s of [...unlogged, ...skipped].filter((s) => s.med === med)) {
        const missed = !s.log;
        marks.push(svg('circle', { cx: x(s.t), cy, r: 6, class: missed ? 'ring missed' : 'ring' }));
        marks.push(svg('circle', { cx: x(s.t), cy, r: 16, class: 'hit', onclick: () => showTip(`${med.id}${s.t}`, (x(s.t) / W) * 100, ((cy - 12) / H) * 100,
          h('strong', {}, `${fmtTime(s.t)} · ${med.name}`), h('span', {}, missed ? 'Not recorded' : 'Skipped')) }));
      }
      for (const e of entries.filter((e) => e.med === med)) {
        const cx = x(e.time);
        marks.push(svg('circle', { cx, cy, r: 7, fill: medColor(med), class: 'dose-dot' }));
        if (e.pills !== 1 || (med.unit || 'pill') !== 'pill') {
          marks.push(svg('text', { x: cx + 10, y: cy + 3.5, class: 'dot-label' },
            (med.unit || 'pill') === 'pill' ? `×${fmtCount(e.pills)}` : amountText(e.pills, med)));
        }
        marks.push(svg('circle', { cx, cy, r: 16, class: 'hit', onclick: () => showTip(`${e.log.id}`, (cx / W) * 100, ((cy - 12) / H) * 100,
          h('strong', {}, `${fmtTime(e.time)} · ${medLabel(med)}`), h('span', {}, `${amountText(e.pills, med)}${e.log.logged_by ? ` · ${e.log.logged_by}` : ''}`)) }));
      }
      return svg('g', {},
        svg('text', { x: ml, y: top + 12, class: 'lane-label' }, medLabel(med)),
        svg('line', { x1: ml, x2: W - mr, y1: cy, y2: cy, class: 'track' }),
        marks);
    });
    chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart-svg',
      'aria-label': `Doses on ${fmtDate(day)}: ${lanes.map((m) => `${m.name} ${amountText(totalsByMed.get(m) || 0, m)}`).join(', ')}` },
    grid, nowMark, laneEls);
  }

  // Several days: for each day, one bar per medication side by side, every bar starting from zero.
  // Each medication keeps the same position within the day so it's easy to follow across days.
  // Medicines measured in different units (pills, mL, ...) get separate charts, never one shared scale.
  const barChart = (meds) => {
    const { tip, showTip } = chartTip();
    const unit = meds[0].unit || 'pill';
    const ml = 26, mr = 4, mt = 16, mb = 22, H = 200;
    const pw = W - ml - mr, ph = H - mt - mb;
    const amounts = perDay.map((d) => meds.map((m) => d.entries.filter((e) => e.med === m).reduce((n, e) => n + e.pills, 0)));
    const maxV = Math.max(1, ...amounts.flat());
    const stepV = [1, 2, 5, 10, 20, 50, 100].find((v) => maxV / v <= 4) || 100;
    const topV = Math.ceil(maxV / stepV) * stepV;
    const y = (v) => mt + ph - (v / topV) * ph;
    const band = pw / days.length;
    const gap = meds.length > 1 && band / meds.length > 6 ? 2 : 0; // 2px surface gap between neighboring bars
    const groupW = Math.min(band * 0.8, meds.length * 18);
    const bw = Math.max(1.5, (groupW - gap * (meds.length - 1)) / meds.length);
    const showValues = days.length <= 7 && bw >= 9;

    const grid = [];
    for (let v = 0; v <= topV; v += stepV) {
      grid.push(svg('line', { x1: ml, x2: W - mr, y1: y(v), y2: y(v), class: v ? 'grid' : 'baseline' }));
      grid.push(svg('text', { x: ml - 6, y: y(v) + 3.5, class: 'axis', 'text-anchor': 'end' }, v));
    }
    const every = days.length <= 7 ? 1 : days.length <= 14 ? 2 : 7;
    const bars = perDay.map((d, i) => {
      const gx = ml + band * i + (band - groupW) / 2;
      const cx = ml + band * i + band / 2;
      const parts = [];
      meds.forEach((m, k) => {
        const v = amounts[i][k];
        if (!v) return;
        const x0 = gx + k * (bw + gap);
        const yTop = y(v);
        const hgt = y(0) - yTop;
        const rad = Math.min(4, bw / 2, hgt);
        parts.push(svg('path', { fill: medColor(m),
          d: `M${x0},${yTop + hgt} V${yTop + rad} Q${x0},${yTop} ${x0 + rad},${yTop} H${x0 + bw - rad} Q${x0 + bw},${yTop} ${x0 + bw},${yTop + rad} V${yTop + hgt} Z` }));
        if (showValues) parts.push(svg('text', { x: x0 + bw / 2, y: yTop - 4, class: 'bar-label', 'text-anchor': 'middle' }, fmtCount(v)));
      });
      const fromEnd = days.length - 1 - i;
      if (fromEnd % every === 0) {
        parts.push(svg('text', { x: cx, y: H - 6, class: 'axis', 'text-anchor': 'middle' },
          days.length <= 7 ? DAY_NAMES[weekday(d.day)] : `${Number(d.day.slice(5, 7))}/${Number(d.day.slice(8))}`));
      }
      const taken = meds.map((m, k) => [m, amounts[i][k]]).filter(([, v]) => v);
      const peak = Math.max(0, ...amounts[i]);
      parts.push(svg('rect', { x: ml + band * i, y: mt, width: band, height: ph, class: 'hit', onclick: () => showTip(d.day, (cx / W) * 100, (Math.max(y(peak) - 8, 40) / H) * 100,
        h('strong', {}, fmtDate(d.day, { weekday: 'short', month: 'short', day: 'numeric' })),
        taken.length
          ? taken.map(([m, v]) => h('span', { class: 'tip-row' }, swatch(m), `${medLabel(m)}: ${amountText(v, m)}`))
          : h('span', {}, 'Nothing taken')) }));
      return svg('g', {}, parts);
    });
    const unitName = UNIT_NAMES[unit][1];
    return h('div', { class: 'chart-area' },
      units.length > 1 ? h('p', { class: 'chart-sub' }, `${unit === 'mL' ? unitName : unitName[0].toUpperCase() + unitName.slice(1)} per day`) : null,
      svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart-svg',
        'aria-label': `${unitName} taken per day, ${shortDate(days[0])} to ${shortDate(r.end)}` }, grid, bars),
      tip);
  };

  const legend = h('div', { class: 'legend' }, [...totalsByMed.entries()].sort((a, b) => byAdded(a[0], b[0])).map(([m, n]) =>
    h('span', { class: 'legend-item' }, swatch(m), h('span', {}, m.name), h('span', { class: 'muted' }, amountText(n, m)))));
  if (!totalsByMed.size && R.days !== 1) {
    return h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'No doses checked off in this period yet.'));
  }
  const takenMeds = [...totalsByMed.keys()].sort(byAdded);
  const units = Object.keys(UNIT_NAMES).filter((u) => takenMeds.some((m) => (m.unit || 'pill') === u));
  const areas = R.days === 1
    ? [h('div', { class: 'chart-area' }, chart, tip)]
    : units.map((u) => barChart(takenMeds.filter((m) => (m.unit || 'pill') === u)));
  wrap.append(...[totalsByMed.size ? legend : null, ...areas].filter(Boolean),
    h('p', { class: 'hint no-print' }, R.days === 1 ? 'Tap a dot for details. Hollow rings are doses not taken.' : `Tap a day for details.${days.length > 14 && totalsByMed.size > 2 ? ' For long periods, pick one medicine above for a clearer view.' : ''}`));
  return wrap;
}

// Pain ratings on a fixed 0–10 scale: through one day, or each day's range and average.
function painChart(r) {
  const R = S.report;
  const days = [];
  for (let i = R.days - 1; i >= 0; i--) days.push(addDays(r.end, -i));
  const ratings = (S.state.pain || []).filter((p) => p.date >= days[0] && p.date <= r.end).sort(byWhen);
  if (!ratings.length) {
    return h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'No pain ratings in this period. Rate pain from the Today screen.'));
  }

  const { tip, showTip } = chartTip();
  const W = 340, ml = 26, mr = 8, mt = 12, mb = 22, H = 170;
  const pw = W - ml - mr, ph = H - mt - mb;
  const y = (v) => mt + ph - (v / 10) * ph;
  const grid = [0, 5, 10].flatMap((v) => [
    svg('line', { x1: ml, x2: W - mr, y1: y(v), y2: y(v), class: v ? 'grid' : 'baseline' }),
    svg('text', { x: ml - 6, y: y(v) + 3.5, class: 'axis', 'text-anchor': 'end' }, v),
  ]);
  const ratingLine = (p) => h('span', {}, `${fmtTime(p.time)}: ${p.score} · ${painWord(p.score)}${p.note ? ` – ${p.note}` : ''}`);

  let marks;
  if (R.days === 1) {
    const x = (t) => { const [hh, mm] = t.split(':').map(Number); return ml + ((hh * 60 + mm) / 1440) * pw; };
    const ticks = [0, 6, 12, 18, 24].map((hr) => svg('text', {
      x: ml + (hr / 24) * pw, y: H - 6, class: 'axis', 'text-anchor': hr === 0 ? 'start' : hr === 24 ? 'end' : 'middle',
    }, ['12 AM', '6 AM', '12 PM', '6 PM', '12 AM'][hr / 6]));
    marks = [
      ticks,
      ratings.length > 1 ? svg('polyline', { class: 'pain-line', points: ratings.map((p) => `${x(p.time)},${y(p.score)}`).join(' ') }) : null,
      ratings.map((p) => [
        svg('circle', { cx: x(p.time), cy: y(p.score), r: 5, class: 'pain-dot' }),
        ratings.length <= 12 ? svg('text', { x: x(p.time), y: y(p.score) - 9, class: 'bar-label', 'text-anchor': 'middle' }, p.score) : null,
        svg('circle', { cx: x(p.time), cy: y(p.score), r: 14, class: 'hit', onclick: () => showTip(`p${p.id}`, (x(p.time) / W) * 100, ((y(p.score) - 10) / H) * 100,
          h('strong', {}, `${fmtTime(p.time)} · Pain ${p.score} of 10`), h('span', {}, painWord(p.score)),
          p.note ? h('span', {}, p.note) : null, p.created_by ? h('span', { class: 'muted' }, `Rated by ${p.created_by}`) : null) }),
      ]),
    ];
  } else {
    const band = pw / days.length;
    const every = days.length <= 7 ? 1 : days.length <= 14 ? 2 : 7;
    const perDay = days.map((day) => {
      const list = ratings.filter((p) => p.date === day);
      const scores = list.map((p) => p.score);
      return { day, list, min: Math.min(...scores), max: Math.max(...scores), avg: scores.reduce((a, b) => a + b, 0) / (scores.length || 1) };
    });
    const cx = (i) => ml + band * i + band / 2;
    const withData = perDay.map((d, i) => ({ ...d, i })).filter((d) => d.list.length);
    marks = [
      withData.length > 1 ? svg('polyline', { class: 'pain-line', points: withData.map((d) => `${cx(d.i)},${y(d.avg)}`).join(' ') }) : null,
      perDay.map((d, i) => [
        d.list.length > 1 ? svg('line', { x1: cx(i), x2: cx(i), y1: y(d.min), y2: y(d.max), class: 'pain-range' }) : null,
        d.list.length ? svg('circle', { cx: cx(i), cy: y(d.avg), r: 4.5, class: 'pain-dot' }) : null,
        d.list.length && days.length <= 14
          ? svg('text', { x: cx(i), y: y(d.max) - 8, class: 'bar-label', 'text-anchor': 'middle' }, fmtCount(Math.round(d.avg * 10) / 10)) : null,
        (days.length - 1 - i) % every === 0 ? svg('text', { x: cx(i), y: H - 6, class: 'axis', 'text-anchor': 'middle' },
          days.length <= 7 ? DAY_NAMES[weekday(d.day)] : `${Number(d.day.slice(5, 7))}/${Number(d.day.slice(8))}`) : null,
        svg('rect', { x: ml + band * i, y: mt, width: band, height: ph, class: 'hit', onclick: () => showTip(d.day, (cx(i) / W) * 100,
          ((d.list.length ? y(d.max) - 10 : mt + ph / 2) / H) * 100,
          h('strong', {}, fmtDate(d.day, { weekday: 'short', month: 'short', day: 'numeric' })),
          d.list.length ? [
            h('span', {}, `Average ${fmtCount(Math.round(d.avg * 10) / 10)} · Highest ${d.max}`),
            d.list.slice(0, 6).map(ratingLine),
            d.list.length > 6 ? h('span', { class: 'muted' }, `+${d.list.length - 6} more`) : null,
          ] : h('span', {}, 'No ratings')) }),
      ]),
    ];
  }

  const avgAll = ratings.reduce((a, p) => a + p.score, 0) / ratings.length;
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart-svg',
    'aria-label': `Pain ratings, 0 to 10. ${ratings.length} ratings, average ${avgAll.toFixed(1)}, highest ${Math.max(...ratings.map((p) => p.score))}.` },
  grid, marks);
  return h('div', { class: 'card chart' },
    h('p', { class: 'muted small' }, `${ratings.length} rating${ratings.length === 1 ? '' : 's'} · average ${fmtCount(Math.round(avgAll * 10) / 10)} · highest ${Math.max(...ratings.map((p) => p.score))}`),
    h('div', { class: 'chart-area' }, chart, tip),
    h('p', { class: 'hint no-print' }, R.days === 1 ? 'Tap a dot for details.' : 'Dot = that day’s average, line = lowest to highest. Tap a day for details.'));
}

// Water in mL: a running total through one day, or a bar per day, each against the daily goal.
function waterChart(r) {
  const R = S.report;
  const days = [];
  for (let i = R.days - 1; i >= 0; i--) days.push(addDays(r.end, -i));
  const totals = days.map(waterTotal);
  if (!totals.some(Boolean)) {
    return h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'No water logged in this period. Log it from the Today screen.'));
  }

  const { tip, showTip } = chartTip();
  const goal = S.state.waterGoal || 0;
  const W = 340, ml = 34, mr = 8, mt = 14, mb = 22, H = 170;
  const pw = W - ml - mr, ph = H - mt - mb;
  const single = R.days === 1;
  const entries = single ? waterOn(r.end) : [];
  const maxV = Math.max(goal, single ? totals[0] : Math.max(...totals), 250);
  const stepV = [250, 500, 1000, 2000].find((v) => maxV / v <= 4) || 2000;
  const topV = Math.ceil(maxV / stepV) * stepV;
  const y = (v) => mt + ph - (v / topV) * ph;
  const grid = [];
  for (let v = 0; v <= topV; v += stepV) {
    grid.push(svg('line', { x1: ml, x2: W - mr, y1: y(v), y2: y(v), class: v ? 'grid' : 'baseline' }));
    grid.push(svg('text', { x: ml - 6, y: y(v) + 3.5, class: 'axis', 'text-anchor': 'end' }, v >= 1000 ? `${v / 1000}L` : v));
  }
  const goalLine = goal ? [
    svg('line', { x1: ml, x2: W - mr, y1: y(goal), y2: y(goal), class: 'goal-line' }),
  ] : null;

  let marks;
  if (single) {
    const x = (t) => { const [hh, mm] = t.split(':').map(Number); return ml + ((hh * 60 + mm) / 1440) * pw; };
    let run = 0;
    const pts = [[x('00:00'), y(0)]];
    const dots = entries.map((w) => {
      pts.push([x(w.time), y(run)]);
      run += w.ml;
      pts.push([x(w.time), y(run)]);
      const at = run;
      return [
        svg('circle', { cx: x(w.time), cy: y(at), r: 4.5, class: 'water-dot' }),
        svg('circle', { cx: x(w.time), cy: y(at), r: 14, class: 'hit', onclick: () => showTip(`w${w.id}`, (x(w.time) / W) * 100, ((y(at) - 10) / H) * 100,
          h('strong', {}, `${fmtTime(w.time)} · +${fmtMl(w.ml)}`), w.label ? h('span', {}, w.label) : null, h('span', { class: 'muted' }, `${fmtMl(at)} so far`)) }),
      ];
    });
    const endX = r.end === r.now.date ? x(r.now.time) : x('23:59');
    pts.push([endX, y(run)]);
    marks = [
      [0, 6, 12, 18, 24].map((hr) => svg('text', { x: ml + (hr / 24) * pw, y: H - 6, class: 'axis', 'text-anchor': hr === 0 ? 'start' : hr === 24 ? 'end' : 'middle' },
        ['12 AM', '6 AM', '12 PM', '6 PM', '12 AM'][hr / 6])),
      svg('polyline', { class: 'water-line', points: pts.map((p) => p.join(',')).join(' ') }),
      dots,
    ];
  } else {
    const band = pw / days.length;
    const bw = Math.max(2, Math.min(22, band * 0.6));
    const every = days.length <= 7 ? 1 : days.length <= 14 ? 2 : 7;
    marks = days.map((day, i) => {
      const v = totals[i];
      const cx = ml + band * i + band / 2;
      const x0 = cx - bw / 2;
      const yTop = y(v);
      const hgt = y(0) - yTop;
      const rad = Math.min(4, bw / 2, hgt);
      return [
        v ? svg('path', { class: 'water-bar',
          d: `M${x0},${yTop + hgt} V${yTop + rad} Q${x0},${yTop} ${x0 + rad},${yTop} H${x0 + bw - rad} Q${x0 + bw},${yTop} ${x0 + bw},${yTop + rad} V${yTop + hgt} Z` }) : null,
        v && days.length <= 7 ? svg('text', { x: cx, y: yTop - 4, class: 'bar-label', 'text-anchor': 'middle' }, v >= 1000 ? `${(v / 1000).toFixed(1)}L` : v) : null,
        (days.length - 1 - i) % every === 0 ? svg('text', { x: cx, y: H - 6, class: 'axis', 'text-anchor': 'middle' },
          days.length <= 7 ? DAY_NAMES[weekday(day)] : `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`) : null,
        svg('rect', { x: ml + band * i, y: mt, width: band, height: ph, class: 'hit', onclick: () => showTip(day, (cx / W) * 100, (Math.max(yTop - 8, 40) / H) * 100,
          h('strong', {}, fmtDate(day, { weekday: 'short', month: 'short', day: 'numeric' })),
          h('span', {}, v ? `${fmtMl(v)}${goal ? ` · ${Math.round((v / goal) * 100)}% of goal` : ''}` : 'Nothing logged'),
          v ? h('span', { class: 'muted' }, `${waterOn(day).length} drinks`) : null) }),
      ];
    });
  }

  const logged = totals.filter(Boolean);
  const avg = logged.reduce((a, b) => a + b, 0) / logged.length;
  const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart-svg',
    'aria-label': single ? `Water on ${fmtDate(r.end)}: ${fmtMl(totals[0])}` : `Water per day, average ${fmtMl(avg)}` }, grid, goalLine, marks);
  return h('div', { class: 'card chart' },
    h('p', { class: 'muted small' }, single
      ? `${fmtMl(totals[0])} in ${entries.length} drink${entries.length === 1 ? '' : 's'}${goal ? ` · goal ${fmtMl(goal)}` : ''}`
      : `Average ${fmtMl(avg)} a day (days with water logged)${goal ? ` · goal ${fmtMl(goal)}` : ''}`),
    h('div', { class: 'chart-area' }, chart, tip),
    h('p', { class: 'hint no-print' }, single ? 'The line climbs with each drink. Tap a dot for details.' : 'Tap a day for details. The dashed line is the daily goal.'));
}

// "30 min (Walk 20, Yoga 10)"
function exerciseSummary(list) {
  const total = list.reduce((a, x) => a + x.minutes, 0);
  const by = new Map();
  for (const x of list) by.set(x.activity || 'Exercise', (by.get(x.activity || 'Exercise') || 0) + x.minutes);
  return by.size > 1 ? `${fmtMin(total)} (${[...by].map(([a, m]) => `${a} ${m}`).join(', ')})` : `${fmtMin(total)} ${[...by.keys()][0].toLowerCase()}`;
}

// Exercise minutes: sessions laid out across one day, or a bar per day against the daily goal.
function exerciseChart(r) {
  const R = S.report;
  const days = [];
  for (let i = R.days - 1; i >= 0; i--) days.push(addDays(r.end, -i));
  const totals = days.map(exerciseTotal);
  if (!totals.some(Boolean)) {
    return h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'No exercise logged in this period. Log it from the Today screen.'));
  }
  const { tip, showTip } = chartTip();
  const goal = S.state.exerciseGoal || 0;
  const W = 340;
  let chart;

  if (R.days === 1) {
    // One lane across the day; each session is a block from its start time, as wide as it lasted.
    const ml = 10, mr = 10, mt = 22, H = 80;
    const pw = W - ml - mr;
    const x = (t) => { const [hh, mm] = t.split(':').map(Number); return ml + ((hh * 60 + mm) / 1440) * pw; };
    const laneY = mt + 8;
    chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart-svg',
      'aria-label': `Exercise on ${fmtDate(r.end)}: ${exerciseSummary(exerciseOn(r.end))}` },
    [0, 6, 12, 18, 24].map((hr) => [
      svg('line', { x1: ml + (hr / 24) * pw, x2: ml + (hr / 24) * pw, y1: mt - 6, y2: laneY + 26, class: 'grid' }),
      svg('text', { x: ml + (hr / 24) * pw, y: H - 6, class: 'axis', 'text-anchor': hr === 0 ? 'start' : hr === 24 ? 'end' : 'middle' },
        ['12 AM', '6 AM', '12 PM', '6 PM', '12 AM'][hr / 6]),
    ]),
    svg('line', { x1: ml, x2: W - mr, y1: laneY + 10, y2: laneY + 10, class: 'track' }),
    exerciseOn(r.end).map((s) => {
      const x0 = x(s.time);
      const w = Math.max(6, (s.minutes / 1440) * pw);
      return [
        svg('rect', { x: x0, y: laneY, width: w, height: 20, rx: 4, class: 'exercise-bar' }),
        svg('text', { x: x0 + w / 2, y: laneY - 5, class: 'bar-label', 'text-anchor': 'middle' }, s.minutes),
        svg('rect', { x: x0 - 8, y: laneY - 14, width: w + 16, height: 44, class: 'hit', onclick: () => showTip(`x${s.id}`, ((x0 + w / 2) / W) * 100, (laneY / H) * 100,
          h('strong', {}, `${fmtTime(s.time)} · ${fmtMin(s.minutes)}`), h('span', {}, s.activity || 'Exercise'),
          s.note ? h('span', {}, s.note) : null, s.created_by ? h('span', { class: 'muted' }, s.created_by) : null) }),
      ];
    }));
  } else {
    const ml = 30, mr = 8, mt = 14, mb = 22, H = 170;
    const pw = W - ml - mr, ph = H - mt - mb;
    const maxV = Math.max(goal, ...totals, 10);
    const stepV = [10, 15, 30, 60, 120].find((v) => maxV / v <= 4) || 120;
    const topV = Math.ceil(maxV / stepV) * stepV;
    const y = (v) => mt + ph - (v / topV) * ph;
    const band = pw / days.length;
    const bw = Math.max(2, Math.min(22, band * 0.6));
    const every = days.length <= 7 ? 1 : days.length <= 14 ? 2 : 7;
    const grid = [];
    for (let v = 0; v <= topV; v += stepV) {
      grid.push(svg('line', { x1: ml, x2: W - mr, y1: y(v), y2: y(v), class: v ? 'grid' : 'baseline' }));
      grid.push(svg('text', { x: ml - 6, y: y(v) + 3.5, class: 'axis', 'text-anchor': 'end' }, v));
    }
    chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart-svg',
      'aria-label': `Exercise minutes per day, ${shortDate(days[0])} to ${shortDate(r.end)}` },
    grid,
    goal ? [
      svg('line', { x1: ml, x2: W - mr, y1: y(goal), y2: y(goal), class: 'goal-line' }),
    ] : null,
    days.map((day, i) => {
      const v = totals[i];
      const cx = ml + band * i + band / 2;
      const x0 = cx - bw / 2;
      const yTop = y(v);
      const hgt = y(0) - yTop;
      const rad = Math.min(4, bw / 2, hgt);
      return [
        v ? svg('path', { class: 'exercise-bar',
          d: `M${x0},${yTop + hgt} V${yTop + rad} Q${x0},${yTop} ${x0 + rad},${yTop} H${x0 + bw - rad} Q${x0 + bw},${yTop} ${x0 + bw},${yTop + rad} V${yTop + hgt} Z` }) : null,
        v && days.length <= 14 ? svg('text', { x: cx, y: yTop - 4, class: 'bar-label', 'text-anchor': 'middle' }, v) : null,
        (days.length - 1 - i) % every === 0 ? svg('text', { x: cx, y: H - 6, class: 'axis', 'text-anchor': 'middle' },
          days.length <= 7 ? DAY_NAMES[weekday(day)] : `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`) : null,
        svg('rect', { x: ml + band * i, y: mt, width: band, height: ph, class: 'hit', onclick: () => showTip(day, (cx / W) * 100, (Math.max(yTop - 8, 40) / H) * 100,
          h('strong', {}, fmtDate(day, { weekday: 'short', month: 'short', day: 'numeric' })),
          h('span', {}, v ? exerciseSummary(exerciseOn(day)) : 'No exercise logged')) }),
      ];
    }));
  }

  const active = totals.filter(Boolean);
  return h('div', { class: 'card chart' },
    h('p', { class: 'muted small' }, R.days === 1
      ? `${exerciseSummary(exerciseOn(r.end))}${goal ? ` · goal ${fmtMin(goal)}` : ''}`
      : `${fmtMin(active.reduce((a, b) => a + b, 0))} total · active ${active.length} of ${days.length} days${goal ? ` · goal ${fmtMin(goal)} a day` : ''}`),
    h('div', { class: 'chart-area' }, chart, tip),
    h('p', { class: 'hint no-print' }, R.days === 1 ? 'Each block is one session. Tap it for details.' : 'Tap a day for details. The dashed line is the daily goal.'));
}

// Temperature readings against the fever line: through one day, or each day's highest.
function tempChart(r) {
  const R = S.report;
  const days = [];
  for (let i = R.days - 1; i >= 0; i--) days.push(addDays(r.end, -i));
  const readings = (S.state.temps || []).filter((t) => t.date >= days[0] && t.date <= r.end).sort(byWhen);
  if (!readings.length) {
    return h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'No temperatures in this period. Log them from the Today screen.'));
  }
  const { tip, showTip } = chartTip();
  const fever = feverF();
  const W = 340, ml = 34, mr = 8, mt = 12, mb = 22, H = 160;
  const pw = W - ml - mr, ph = H - mt - mb;
  // The scale is drawn in the display unit; y() takes a stored °F value.
  const shown = readings.map((t) => toUnit(t.temp_f));
  const [minD, maxD, stepD] = useC() ? [35.5, 39, 1] : [96, 102, 2];
  const lo = Math.min(minD, Math.floor(Math.min(...shown)));
  const hi = Math.max(maxD, Math.ceil(Math.max(...shown)));
  const yd = (v) => mt + ph - ((v - lo) / (hi - lo)) * ph;
  const y = (f) => yd(toUnit(f));
  const grid = [];
  for (let v = Math.ceil(lo / stepD) * stepD; v <= hi; v += stepD) {
    grid.push(svg('line', { x1: ml, x2: W - mr, y1: yd(v), y2: yd(v), class: 'grid' }));
    grid.push(svg('text', { x: ml - 6, y: yd(v) + 3.5, class: 'axis', 'text-anchor': 'end' }, `${v}°`));
  }
  grid.push(svg('line', { x1: ml, x2: W - mr, y1: y(fever), y2: y(fever), class: 'fever-line' }));
  const dot = (t, cx, key) => [
    svg('circle', { cx, cy: y(t.temp_f), r: 4.5, class: t.temp_f >= fever || t.chills ? 'temp-dot fever' : 'temp-dot' }),
    svg('circle', { cx, cy: y(t.temp_f), r: 14, class: 'hit', onclick: () => showTip(key, (cx / W) * 100, ((y(t.temp_f) - 10) / H) * 100,
      h('strong', {}, `${fmtTemp(t.temp_f)} · ${shortDate(t.date)} ${fmtTime(t.time)}`),
      t.temp_f >= fever ? h('span', {}, 'Fever') : null, t.chills ? h('span', {}, 'Shaking chills') : null,
      t.note ? h('span', {}, t.note) : null) }),
  ];

  let marks;
  if (R.days === 1) {
    const x = (tm) => { const [hh, mm] = tm.split(':').map(Number); return ml + ((hh * 60 + mm) / 1440) * pw; };
    marks = [
      [0, 6, 12, 18, 24].map((hr) => svg('text', { x: ml + (hr / 24) * pw, y: H - 6, class: 'axis', 'text-anchor': hr === 0 ? 'start' : hr === 24 ? 'end' : 'middle' },
        ['12 AM', '6 AM', '12 PM', '6 PM', '12 AM'][hr / 6])),
      readings.length > 1 ? svg('polyline', { class: 'temp-line', points: readings.map((t) => `${x(t.time)},${y(t.temp_f)}`).join(' ') }) : null,
      readings.map((t) => dot(t, x(t.time), `t${t.id}`)),
    ];
  } else {
    const band = pw / days.length;
    const every = days.length <= 7 ? 1 : days.length <= 14 ? 2 : 7;
    const peaks = days.map((day, i) => {
      const list = readings.filter((t) => t.date === day);
      return list.length ? { i, t: list.reduce((a, b) => (b.temp_f > a.temp_f ? b : a)) } : null;
    }).filter(Boolean);
    const cx = (i) => ml + band * i + band / 2;
    marks = [
      days.map((day, i) => ((days.length - 1 - i) % every === 0 ? svg('text', { x: cx(i), y: H - 6, class: 'axis', 'text-anchor': 'middle' },
        days.length <= 7 ? DAY_NAMES[weekday(day)] : `${Number(day.slice(5, 7))}/${Number(day.slice(8))}`) : null)),
      peaks.length > 1 ? svg('polyline', { class: 'temp-line', points: peaks.map((p) => `${cx(p.i)},${y(p.t.temp_f)}`).join(' ') }) : null,
      peaks.map((p) => dot(p.t, cx(p.i), p.t.date)),
    ];
  }
  const fevers = readings.filter((t) => t.temp_f >= fever || t.chills);
  return h('div', { class: 'card chart' },
    h('p', { class: `muted small${fevers.length ? ' fever-text' : ''}` },
      `${readings.length} reading${readings.length === 1 ? '' : 's'} · highest ${fmtTemp(Math.max(...readings.map((t) => t.temp_f)))} · ${fevers.length ? `${fevers.length} at or above ${fmtTemp(fever)} or with chills` : 'no fevers'}`),
    h('div', { class: 'chart-area' }, svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', class: 'chart-svg',
      'aria-label': `Temperatures, highest ${fmtTemp(Math.max(...readings.map((t) => t.temp_f)))}, ${fevers.length} fevers` }, grid, marks), tip),
    h('p', { class: 'hint no-print' }, R.days === 1 ? `Red dots are ${fmtTemp(fever)} or higher. Tap a dot for details.`
      : `Each dot is that day’s highest reading; the red line is ${fmtTemp(fever)}.`));
}

// A grid of how bad each symptom was each day (darker = worse), from the daily check-ins.
function symptomChart(r) {
  const R = S.report;
  const days = [];
  for (let i = R.days - 1; i >= 0; i--) days.push(addDays(r.end, -i));
  const all = (S.state.checkins || []).filter((c) => c.date >= days[0] && c.date <= r.end);
  if (!all.length) {
    return h('div', { class: 'card' }, h('p', { class: 'muted center' }, 'No check-ins in this period. Do one from the Today screen.'));
  }
  const worst = (day, key) => {
    const vals = all.filter((c) => c.date === day && c.symptoms[key] != null).map((c) => c.symptoms[key]);
    return vals.length ? Math.max(...vals) : null;
  };
  const rows = [...SYMPTOMS, ['bowels', 'Bowels']];
  const SHORT = { fatigue: 'Tiredness', numbness: 'Numbness', nausea: 'Nausea', breath: 'Breathless', bowels: 'Bowels' };
  const cell = (day, key) => {
    if (key === 'bowels') {
      const v = all.filter((c) => c.date === day && c.symptoms.bowels).at(-1)?.symptoms.bowels;
      const level = { constipated: 2, diarrhea: 2, none: 1 }[v] || 0;
      return h('span', { class: `sx-cell${v ? ` sx-${level}` : ' sx-none'}`, title: `${shortDate(day)}: ${v ? choiceLabel('bowels', v) : 'not recorded'}` },
        v && v !== 'normal' ? choiceLabel('bowels', v)[0] : '');
    }
    const v = worst(day, key);
    return h('span', { class: `sx-cell${v == null ? ' sx-none' : ` sx-${v}`}`, title: `${shortDate(day)}: ${v == null ? 'not recorded' : SCALE[v]}` });
  };
  const every = days.length <= 7 ? 1 : days.length <= 14 ? 2 : 7;
  return h('div', { class: 'card chart' },
    h('p', { class: 'muted small' }, `${all.length} check-in${all.length === 1 ? '' : 's'} · worst each day`),
    h('div', { class: 'sx-grid', style: `grid-template-columns: 7.5em repeat(${days.length}, 1fr)` },
      rows.map(([key]) => [h('span', { class: 'sx-label' }, SHORT[key]), days.map((d) => cell(d, key))]),
      h('span'), days.map((d, i) => h('span', { class: 'sx-day' },
        (days.length - 1 - i) % every === 0 ? (days.length <= 7 ? DAY_NAMES[weekday(d)][0] : `${Number(d.slice(8))}`) : ''))),
    h('div', { class: 'sx-legend' }, SCALE.map((w, i) => h('span', {}, h('i', { class: `sx-cell sx-${i}` }), w)),
      h('span', {}, h('i', { class: 'sx-cell sx-none' }), 'No check-in')),
    h('p', { class: 'muted small' }, 'Bowels: C = constipated, D = diarrhea, N = no bowel movement.'));
}

// ---------- "since last visit" summary ----------

function lastVisitDate(now) {
  return S.state.appts.filter((a) => wallMs(a.at.slice(0, 10), a.at.slice(11)) < now.ms).map((a) => a.at.slice(0, 10)).sort().at(-1) || null;
}

// Everything a doctor asks about, boiled down for the period from `start` to today.
function buildVisit(start, now) {
  const days = [];
  for (let d = start; d <= now.date; d = addDays(d, 1)) days.push(d);
  const inRange = (x) => x.date >= start && x.date <= now.date;
  const fever = feverF();
  const isNight = (t) => t < '06:00';

  const temps = (S.state.temps || []).filter(inRange).sort(byWhen);
  const checkins = (S.state.checkins || []).filter(inRange).sort(byWhen);
  const pain = (S.state.pain || []).filter(inRange).sort(byWhen);
  const episodes = (S.state.episodes || []).filter(inRange);
  const bowel = (S.state.bowel || []).filter(inRange).sort(byWhen);
  const alerts = [
    ...temps.filter((t) => t.temp_f >= fever || t.chills).map((t) => ({ date: t.date, time: t.time,
      text: `${t.temp_f >= fever ? `Fever ${fmtTemp(t.temp_f)}` : `${fmtTemp(t.temp_f)}`}${t.chills ? ' with shaking chills' : ''}` })),
    ...checkins.filter((c) => c.flags.length).map((c) => ({ date: c.date, time: c.time, text: c.flags.join('; ') })),
    ...bowel.filter((b) => b.blood || b.black).map((b) => ({ date: b.date, time: b.time, text: `Bowel movement with ${b.black ? 'black/tarry stool' : 'blood'}` })),
  ].sort(byWhen);

  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  let painTrend = null;
  if (pain.length >= 4) {
    const half = Math.floor(pain.length / 2);
    const diff = avg(pain.slice(half).map((p) => p.score)) - avg(pain.slice(0, half).map((p) => p.score));
    painTrend = diff >= 1 ? 'getting worse' : diff <= -1 ? 'improving' : 'about the same';
  }
  const areaCounts = new Map();
  for (const c of checkins) for (const a of c.areas) areaCounts.set(a, (areaCounts.get(a) || 0) + 1);

  // As-needed and extra doses, per medicine.
  const extras = S.state.logs.filter((l) => inRange(l) && l.status === 'taken' && l.time.length === 8);
  const prn = [...new Set(extras.map((l) => l.med_id))].map((id) => {
    const med = S.state.meds.find((m) => m.id === id);
    if (!med) return null;
    const mine = extras.filter((l) => l.med_id === id);
    const perDay = days.map((d) => mine.filter((l) => l.date === d).reduce((n, l) => n + pillsOf(l, med), 0));
    return {
      med, doses: mine.length, amount: mine.reduce((n, l) => n + pillsOf(l, med), 0),
      perDay: avg(perDay), maxDay: Math.max(...perDay), night: mine.filter((l) => isNight(doseTime(l))).length,
    };
  }).filter(Boolean).sort((a, b) => b.doses - a.doses);

  let scheduled = 0, taken = 0, missed = 0;
  for (const d of days) {
    for (const s of doseSlots(d)) {
      const st = slotStatus(s, d, now);
      if (st === 'upcoming') continue;
      scheduled++;
      if (st === 'taken') taken++;
      if (st === 'missed') missed++;
    }
  }

  const symptoms = SYMPTOMS.map(([key, label]) => {
    const vals = checkins.filter((c) => c.symptoms[key] != null).map((c) => c.symptoms[key]);
    return vals.length ? { label: label.split(' (')[0], worst: Math.max(...vals), latest: vals.at(-1), bad: vals.filter((v) => v >= 2).length } : null;
  }).filter(Boolean);
  const choiceCounts = CHOICES.map(([key, label]) => {
    const counts = {};
    for (const c of checkins) if (c.symptoms[key]) counts[c.symptoms[key]] = (counts[c.symptoms[key]] || 0) + 1;
    return { key, label, counts };
  }).filter((x) => Object.keys(x.counts).length);

  const waterDays = days.map(waterTotal).filter(Boolean);
  const exDays = days.map(exerciseTotal);

  return {
    start, days, alerts, temps, checkins,
    pain: pain.length ? {
      n: pain.length, avg: avg(pain.map((p) => p.score)), max: pain.reduce((a, b) => (b.score >= a.score ? b : a)),
      trend: painTrend, night: pain.filter((p) => isNight(p.time)).length,
      areas: [...areaCounts].sort((a, b) => b[1] - a[1]),
    } : null,
    prn, scheduled, taken, missed, symptoms, choiceCounts,
    bowel: bowel.length ? (() => {
      const dates = [...new Set(bowel.map((b) => b.date))];
      let gap = 0;
      for (let i = 1; i < dates.length; i++) gap = Math.max(gap, Math.round((Date.parse(dates[i]) - Date.parse(dates[i - 1])) / 864e5) - 1);
      const since = Math.round((Date.parse(now.date) - Date.parse(dates.at(-1))) / 864e5);
      const groups = { hard: 0, normal: 0, loose: 0 };
      for (const b of bowel) if (b.type) groups[stoolGroup(b.type)]++;
      return { n: bowel.length, days: dates.length, gap: Math.max(gap, since), since, groups, strain: bowel.filter((b) => b.strain).length };
    })() : null,
    episodes: [...new Set(episodes.map((e) => e.name))].map((name) => {
      const list = episodes.filter((e) => e.name === name);
      const ended = list.filter((e) => e.ended_at && !noLength(e)).map(epMinutes);
      return {
        name, n: list.length, major: list.filter((e) => e.severity === 'major').length,
        night: list.filter((e) => isNight(e.time)).length,
        avg: ended.length ? avg(ended) : null, longest: ended.length ? Math.max(...ended) : null,
      };
    }).sort((a, b) => b.n - a.n),
    water: waterDays.length ? { avg: avg(waterDays), days: waterDays.length } : null,
    exercise: { total: exDays.reduce((a, b) => a + b, 0), active: exDays.filter(Boolean).length },
    notes: S.state.journal.filter(inRange).slice(0, 6),
  };
}

const round1 = (n) => fmtCount(Math.round(n * 10) / 10);

// The summary as plain lines, shared by the screen, Share and print.
function visitSections(v) {
  const s = [];
  s.push(['Fevers and warning signs', v.alerts.length
    ? v.alerts.map((a) => `${shortDate(a.date)} ${fmtTime(a.time)}: ${a.text}`)
    : [`No fevers (${fmtTemp(feverF())} or higher) or warning signs logged.`], v.alerts.length ? 'alert' : '']);
  if (v.pain) {
    s.push(['Pain (0–10)', [
      `${v.pain.n} ratings, average ${round1(v.pain.avg)}, highest ${v.pain.max.score} (${shortDate(v.pain.max.date)} ${fmtTime(v.pain.max.time)})`,
      v.pain.trend ? `Trend: ${v.pain.trend}` : null,
      v.pain.night ? `Rated during the night (12–6 AM): ${v.pain.night} time${v.pain.night === 1 ? '' : 's'}` : null,
      v.pain.areas.length ? `Where: ${v.pain.areas.map(([a, n]) => `${a} (${n})`).join(', ')}` : null,
    ].filter(Boolean)]);
  }
  if (v.episodes.length) {
    s.push(['Symptom episodes', v.episodes.map((x) => `${x.name}: ${x.n} time${x.n === 1 ? '' : 's'}`
      + `${x.major ? ` (${x.major} major)` : ''}${x.avg != null ? `, usually about ${fmtLength(x.avg)}, longest ${fmtLength(x.longest)}` : ''}`
      + `${x.night ? `, ${x.night} at night` : ''}`)]);
  }
  if (v.bowel) {
    const g = v.bowel.groups;
    s.push(['Bowel movements', [
      `${v.bowel.n} on ${v.bowel.days} of ${v.days.length} days; ${v.bowel.gap ? `longest stretch without one: ${v.bowel.gap} day${v.bowel.gap === 1 ? '' : 's'}` : 'at least one every day'}${v.bowel.since ? ` (last one ${v.bowel.since} day${v.bowel.since === 1 ? '' : 's'} ago)` : ''}`,
      g.hard + g.normal + g.loose ? `Type: hard ${g.hard}, normal ${g.normal}, loose ${g.loose}` : null,
      v.bowel.strain ? `Straining or pain: ${v.bowel.strain} time${v.bowel.strain === 1 ? '' : 's'}` : null,
    ].filter(Boolean)]);
  } else if (v.days.length >= 2) {
    s.push(['Bowel movements', ['None logged in this period.']]);
  }
  const medLines = v.prn.map((p) => `${medLabel(p.med)}: ${p.doses} dose${p.doses === 1 ? '' : 's'}, ${amountText(p.amount, p.med)} total, `
    + `about ${round1(p.perDay)} ${unitWord(2, p.med)} a day (most in a day: ${fmtCount(p.maxDay)})${p.night ? `, ${p.night} at night` : ''}`);
  if (v.scheduled) medLines.push(`Scheduled doses: ${v.taken} of ${v.scheduled} checked off (${Math.round((v.taken / v.scheduled) * 100)}%)${v.missed ? `, ${v.missed} not recorded` : ''}`);
  if (medLines.length) s.push(['Medicines', medLines]);
  const sx = v.symptoms.map((x) => `${x.label}: worst ${SCALE[x.worst].toLowerCase()}, latest ${SCALE[x.latest].toLowerCase()}${x.bad ? ` (moderate or worse on ${x.bad} check-in${x.bad === 1 ? '' : 's'})` : ''}`);
  for (const c of v.choiceCounts) {
    sx.push(`${c.label}: ${Object.entries(c.counts).map(([val, n]) => `${choiceLabel(c.key, val).toLowerCase()} ${n}×`).join(', ')}`);
  }
  if (sx.length) s.push([`Symptoms (${v.checkins.length} check-in${v.checkins.length === 1 ? '' : 's'})`, sx]);
  const daily = [];
  if (v.temps.length) daily.push(`Temperature: ${v.temps.length} readings, highest ${fmtTemp(Math.max(...v.temps.map((t) => t.temp_f)))}`);
  if (v.water) daily.push(`Water: about ${fmtMl(v.water.avg)} a day (on ${v.water.days} days logged)${S.state.waterGoal ? `, goal ${fmtMl(S.state.waterGoal)}` : ''}`);
  if (v.exercise.total) daily.push(`Exercise: ${fmtMin(v.exercise.total)} over ${v.exercise.active} of ${v.days.length} days`);
  if (daily.length) s.push(['Daily habits', daily]);
  if (v.notes.length) s.push(['Recent notes', v.notes.map((j) => `${shortDate(j.date)}${j.feeling ? ` (${FEELINGS[j.feeling - 1][2].toLowerCase()})` : ''}: ${j.text}`)]);
  return s;
}

function viewVisitSummary(R) {
  const now = localNow();
  const last = lastVisitDate(now);
  if (!R.since) R.since = last ? 'last' : '14';
  const start = R.since === 'last' && last ? last : addDays(now.date, -(Number(R.since === 'last' ? 14 : R.since) - 1));
  const v = buildVisit(start, now);
  const sections = visitSections(v);
  const questions = S.state.questions || [];
  const saveQs = (qs) => mutate('settings', { method: 'POST', body: { visit_questions: qs } });
  const qIn = h('input', { placeholder: 'Add a question for the doctor', maxlength: 300 });
  const period = `${shortDate(start)} – ${shortDate(now.date)}, ${now.date.slice(0, 4)}`;

  const share = async () => {
    const text = [`Since last visit: ${period}`, ...sections.flatMap(([title, lines]) => ['', title, ...lines.map((l) => `  ${l}`)]),
      ...(questions.some((q) => !q.done) ? ['', 'Questions to ask', ...questions.filter((q) => !q.done).map((q) => `  • ${q.text}`)] : [])].join('\n');
    try {
      if (navigator.share) await navigator.share({ title: 'Visit summary', text });
      else { await navigator.clipboard.writeText(text); toast('Summary copied.'); }
    } catch (e) { if (e?.name !== 'AbortError') toast('Couldn’t share on this device.', true); }
  };

  const sinceOpts = [...(last ? [['last', `Since last visit (${shortDate(last)})`]] : []), ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days']];
  return [
    h('div', { class: 'card form no-print' },
      h('select', { 'aria-label': 'Period', onchange: (e) => { R.since = e.target.value; e.target.blur(); render(); } },
        sinceOpts.map(([val, label]) => h('option', { value: val, selected: R.since === val }, label)))),
    h('div', { class: 'print-only print-title' }, h('strong', {}, 'Since last visit'), h('span', {}, `${period} · Printed ${shortDate(now.date)}`)),
    h('p', { class: 'visit-period no-print' }, period),
    sections.map(([title, lines, cls]) => h('div', { class: `card visit-block ${cls || ''}` },
      h('h3', {}, title), h('ul', {}, lines.map((l) => h('li', {}, l))))),
    h('div', { class: 'card visit-block' },
      h('h3', {}, 'Questions to ask'),
      questions.length ? h('ul', { class: 'q-list' }, questions.map((q, i) => h('li', { class: q.done ? 'done' : '' },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: q.done, class: 'no-print',
          onchange: () => saveQs(questions.map((x, j) => (j === i ? { ...x, done: !x.done } : x))) }), h('span', {}, q.text)),
        h('button', { type: 'button', class: 'icon-btn small no-print', 'aria-label': 'Remove question',
          onclick: () => saveQs(questions.filter((_, j) => j !== i)) }, '✕')))) : h('p', { class: 'muted' }, 'No questions yet.'),
      h('div', { class: 'add-time no-print' }, qIn, h('button', { type: 'button', class: 'btn ghost', onclick: () => {
        if (qIn.value.trim()) saveQs([...questions, { text: qIn.value.trim(), done: false }]);
      } }, 'Add'))),
    h('div', { class: 'btn-row no-print' },
      h('button', { class: 'btn primary', onclick: share }, 'Share'),
      h('button', { class: 'btn ghost', onclick: () => window.print() }, 'Print or PDF')),
    h('p', { class: 'hint' }, 'Tip: add questions as they come up, then tick them off at the visit.'),
  ];
}

function viewReport() {
  const R = (S.report ||= { days: 7, med: 'all', open: new Set(), mode: params.get('mode') === 'visit' ? 'visit' : 'charts' });
  const modeSwitch = h('div', { class: 'segmented two no-print', role: 'group', 'aria-label': 'Report type' },
    [['charts', 'Charts & log'], ['visit', 'Visit summary']].map(([m, label]) => h('button', {
      type: 'button', 'aria-pressed': String((R.mode || 'charts') === m), onclick: () => { R.mode = m; render(); window.scrollTo(0, 0); },
    }, label)));
  if (R.mode === 'visit') return [header('Report', 'For the doctor'), modeSwitch, viewVisitSummary(R)];

  const r = buildReport();
  const t = r.totals;

  const ranges = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Date range' },
    [[1, 'Day'], [7, 'Week'], [14, '2 wks'], [30, 'Month'], [60, '2 mos']].map(([n, label]) => h('button', {
      type: 'button', 'aria-pressed': String(R.days === n), onclick: () => { R.days = n; render(); },
    }, label)));

  const dayNav = R.days === 1 ? h('div', { class: 'report-daynav' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => { R.end = addDays(r.end, -1); render(); } }, '‹'),
    h('strong', {}, fmtDate(r.end, { weekday: 'short', month: 'short', day: 'numeric' })),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next day', disabled: r.end >= r.now.date,
      onclick: () => { R.end = addDays(r.end, 1); render(); } }, '›')) : null;

  const picker = h('select', { 'aria-label': 'Medication', onchange: (e) => { R.med = e.target.value; e.target.blur(); render(); } },
    h('option', { value: 'all' }, 'All medications'),
    S.state.meds.map((m) => h('option', { value: String(m.id), selected: String(m.id) === R.med }, medLabel(m))));

  const stat = (label, n, cls = '') => h('div', { class: `stat ${cls}` }, h('strong', {}, String(n)), h('span', {}, label));

  const dayCard = (d) => {
    const open = R.open.has(d.day) || !!r.med;
    const toggle = () => { R.open.has(d.day) ? R.open.delete(d.day) : R.open.add(d.day); render(); };
    return h('div', { class: `report-day${open ? ' open' : ''}` },
      h('button', { class: 'report-day-head', 'aria-expanded': String(open), onclick: toggle },
        h('span', { class: 'report-day-name' }, fmtDate(d.day, { weekday: 'short', month: 'short', day: 'numeric' })),
        h('span', { class: 'dots', 'aria-hidden': 'true' }, d.slots.map((s) => h('i', { class: `dot ${s.status}` }))),
        h('span', { class: 'report-day-count' }, d.slots.length ? `${d.taken} of ${d.slots.length}` : d.prn.length ? `${d.prn.length} as needed` : d.water ? fmtMl(d.water) : d.exercise.length ? fmtMin(d.exercise.reduce((a, x) => a + x.minutes, 0)) : '')),
      h('div', { class: 'day-details' },
        dayTimeline(d).map((e) => h('div', { class: 'detail' },
          h('span', { class: 'detail-time' }, fmtTime(e.t)),
          e.kind === 'pain'
            ? h('span', { class: 'detail-main' }, h('strong', {}, `Pain ${e.p.score}/10 · ${painWord(e.p.score)}`),
              e.p.note ? h('span', {}, e.p.note) : null)
            : e.kind === 'bowel'
              ? h('span', { class: 'detail-main' }, h('strong', { class: e.b.blood || e.b.black ? 'fever-text' : '' }, 'Bowel movement'),
                h('span', {}, `${bowelText(e.b).replace(/^Bowel movement,? ?/, '')}${e.b.note ? ` · ${e.b.note}` : ''}`))
            : e.kind === 'episode'
              ? h('span', { class: 'detail-main' }, h('strong', { class: e.ep.severity === 'major' ? 'fever-text' : '' }, episodeLabel(e.ep)),
                h('span', {}, `${e.ep.ended_at && !noLength(e.ep) ? `Lasted ${fmtLength(epMinutes(e.ep))}` : lengthText(e.ep)[0].toUpperCase() + lengthText(e.ep).slice(1)}${e.ep.note ? ` · ${e.ep.note}` : ''}`))
            : e.kind === 'temp'
              ? h('span', { class: 'detail-main' }, h('strong', { class: e.x.temp_f >= feverF() ? 'fever-text' : '' },
                `${fmtTemp(e.x.temp_f)}${e.x.chills ? ' · chills' : ''}${e.x.temp_f >= feverF() ? ' · fever' : ''}`), e.x.note ? h('span', {}, e.x.note) : null)
            : h('span', { class: 'detail-main' }, r.med ? null : h('strong', {}, medLabel(e.med)),
              h('span', { class: `status ${e.status}` }, e.text)))),
        d.checkins.map((c) => h('div', { class: 'detail' },
          h('span', { class: 'detail-time' }, 'Check-in'),
          h('span', { class: 'detail-main' }, h('span', { class: c.flags.length ? 'fever-text' : '' }, checkinSummary(c)),
            c.note ? h('span', { class: 'muted' }, c.note) : null))),
        d.exercise.length ? h('div', { class: 'detail' },
          h('span', { class: 'detail-time' }, 'Exercise'),
          h('span', { class: 'detail-main' }, h('strong', {}, exerciseSummary(d.exercise)))) : null,
        d.water ? h('div', { class: 'detail' },
          h('span', { class: 'detail-time' }, 'Water'),
          h('span', { class: 'detail-main' }, h('strong', {}, fmtMl(d.water)))) : null,
        d.notes.map((j) => h('div', { class: 'detail note-line' },
          h('span', { class: 'detail-time' }, 'Note'),
          h('span', { class: 'detail-main' },
            j.feeling ? h('strong', {}, `${FEELINGS[j.feeling - 1][1]} ${FEELINGS[j.feeling - 1][2]}`) : null,
            j.text ? h('span', {}, j.text) : null)))));
  };

  return [
    header('Report', r.from === r.end ? fmtDate(r.end) : `${shortDate(r.from)} – ${shortDate(r.end)}`),
    modeSwitch,
    h('div', { class: 'card form no-print' }, ranges, dayNav, picker),
    h('div', { class: 'print-only print-title' },
      h('strong', {}, 'Care Companion report'),
      h('span', {}, [
        r.from === r.end ? fmtDate(r.end, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
          : `${shortDate(r.from)} – ${shortDate(r.end)}, ${r.end.slice(0, 4)}`,
        r.med ? medLabel(r.med) : 'All medications',
        `Printed ${fmtDate(r.now.date, { month: 'short', day: 'numeric', year: 'numeric' })}`,
      ].join(' · '))),
    r.med ? h('div', { class: 'card' },
      h('strong', {}, medLabel(r.med)),
      h('p', { class: 'row-sub' }, scheduleText(r.med)),
      r.med.instructions ? h('p', { class: 'row-sub' }, r.med.instructions) : null) : null,
    h('div', { class: 'card summary' },
      h('div', { class: 'big' }, r.pct == null ? '–' : `${r.pct}%`),
      h('p', { class: 'muted' }, 'of scheduled doses checked off as taken'),
      h('div', { class: 'stats' },
        stat('Taken', t.taken, 'ok'), stat('Skipped', t.skipped), stat('Not recorded', t.missed, 'warn'), stat('As needed or extra', t.prn))),
    // On paper the charts sit two to a row; on screen they stack.
    h('div', { class: 'report-charts' },
      section(R.days === 1 ? 'Doses through the day' : 'Medicines taken per day', usageChart(r)),
      section(R.days === 1 ? 'Pain through the day' : 'Pain per day', painChart(r)),
      section(R.days === 1 ? 'Water through the day' : 'Water per day', waterChart(r)),
      section(R.days === 1 ? 'Exercise through the day' : 'Exercise per day', exerciseChart(r)),
      section(R.days === 1 ? 'Temperature through the day' : 'Temperature', tempChart(r)),
      section('Symptoms', symptomChart(r))),
    r.days.length
      ? section('Day by day', h('div', { class: 'list' }, r.days.map(dayCard)))
      : empty('Nothing recorded in this period yet.'),
    h('div', { class: 'btn-row no-print' },
      h('button', { class: 'btn primary', onclick: () => shareReport(r) }, 'Share'),
      h('button', { class: 'btn ghost', onclick: () => window.print() }, 'Print or PDF')),
    h('p', { class: 'hint' }, '“Not recorded” means nobody checked the dose off in Care; it may still have been taken. Based on each medication’s current schedule.'),
  ];
}

function dayLabel(day, today) {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  return fmtDate(day, { weekday: 'short', month: 'short', day: 'numeric' });
}

// ---------- settings & reminders ----------

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function deviceKind() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || isIOS) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Mac/.test(ua)) return 'Mac';
  return 'computer';
}

function b64ToBytes(s) {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function saveSubscription(sub, prefs) {
  await api('subscribe', { method: 'POST', body: {
    subscription: sub.toJSON(), label: `${S.name || 'Someone'}'s ${deviceKind()}`, ...prefs,
  } });
  S.sub = sub;
  await refresh();
}

async function enablePush() {
  // On iPhone the permission prompt must come straight from the tap, before any other await.
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast('Notifications are off. To allow them: iPhone Settings → Notifications → Care.', true);
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(S.state.vapidPublicKey) });
    await saveSubscription(sub, { meds: true, appts: true, missed: false, pain: true });
    toast('Reminders are on for this device');
  } catch (e) {
    toast(`Couldn't turn on reminders: ${e.message}`, true);
  }
}

async function disablePush() {
  const endpoint = S.sub.endpoint;
  try { await S.sub.unsubscribe(); } catch { /* already gone */ }
  S.sub = null;
  await mutate('unsubscribe', { method: 'POST', body: { endpoint } }, 'Reminders turned off for this device');
}

function viewSettings() {
  const out = [header('Settings', null, h('a', { class: 'btn ghost small', href: '/help' }, 'Help'))];

  out.push(h('div', { class: 'card form' },
    field('Your name on this device', h('input', { value: S.name, autocomplete: 'given-name',
      oninput: (e) => { S.name = e.target.value.trim(); store.set('name', S.name); } }), 'Shown next to doses you check off.'),
    field('Who Care is for', h('input', { value: S.state.patientName || '', maxlength: 40, placeholder: 'First name',
      onchange: (e) => mutate('settings', { method: 'POST', body: { patient_name: e.target.value } }, 'Name saved') })),
    (() => {
      const shown = h('strong', { class: 'family-code' }, '••••-••••-••••');
      return field('Family code', h('div', { class: 'add-time' }, shown,
        h('button', { type: 'button', class: 'btn ghost', onclick: (e) => {
          const hide = shown.textContent === S.code;
          shown.textContent = hide ? '••••-••••-••••' : S.code;
          e.target.textContent = hide ? 'Show' : 'Hide';
        } }, 'Show')), 'To add another phone: open Care on it and type this code.');
    })()));

  let reminders;
  if (isIOS && !isStandalone) {
    reminders = [
      h('p', {}, 'On iPhone, reminders work only once Care is on the Home Screen:'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Tap the Share button (the square with an arrow) at the bottom of Safari.'),
        h('li', {}, 'Choose “Add to Home Screen”, then tap Add.'),
        h('li', {}, 'Open Care from the Home Screen, enter the family code again, and come back here.')),
    ];
  } else if (!pushSupported || !S.state.vapidPublicKey) {
    reminders = [h('p', {}, 'This browser can’t receive reminders. On iPhone, use Safari and add Care to the Home Screen.')];
  } else if (!S.sub) {
    reminders = [
      h('p', {}, 'Get a notification on this device when a dose or appointment is coming up.'),
      h('button', { class: 'btn primary block', onclick: enablePush }, 'Turn on reminders'),
    ];
  } else {
    const mine = S.state.devices.find((d) => d.endpoint === S.sub.endpoint) || { meds: 1, appts: 1, missed: 0 };
    const toggle = (key, label, hint) => h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: !!mine[key], onchange: async (e) => {
        try {
          await saveSubscription(S.sub, { meds: !!mine.meds, appts: !!mine.appts, missed: !!mine.missed, pain: !!mine.pain, [key]: e.target.checked });
        } catch (err) { toast(err.message, true); }
      } }), h('span', {}, label, hint ? h('span', { class: 'hint block' }, hint) : null));
    reminders = [
      h('p', { class: 'ok-text' }, '✓ Reminders are on for this device'),
      toggle('meds', 'Medication times and refills'),
      toggle('appts', 'Appointments'),
      toggle('missed', 'Caregiver alerts', 'If a dose isn’t checked off within 30 minutes, and right away when a fever or warning sign is logged.'),
      toggle('pain', 'Pain check-ins', 'A reminder to rate pain at the times set below. Skipped if pain was rated in the last hour.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', onclick: async () => {
          try {
            const r = await api('test-push', { method: 'POST', body: { endpoint: S.sub.endpoint } });
            toast(r.ok ? 'Test sent. It should arrive in a few seconds.' : `The push service said ${r.status}. Try turning reminders off and on.`, !r.ok);
          } catch (e) { toast(e.message, true); }
        } }, 'Send a test'),
        h('button', { class: 'btn ghost', onclick: disablePush }, 'Turn off')),
    ];
  }
  out.push(section('Reminders on this device', h('div', { class: 'card form' }, reminders)));

  if (S.state.devices.length) {
    out.push(section('Devices getting reminders', h('div', { class: 'card' }, S.state.devices.map((d) =>
      h('div', { class: 'device' },
        h('strong', {}, d.label || 'Device', S.sub?.endpoint === d.endpoint ? h('span', { class: 'muted' }, ' (this one)') : null),
        h('span', { class: 'muted small' }, [d.meds && 'meds', d.appts && 'appointments', d.missed && 'missed doses', d.pain && 'pain check-ins'].filter(Boolean).join(', ') || 'nothing'))))));
  }

  if (S.state.calendarToken) {
    const feed = `${location.host}/cal/${S.state.calendarToken}.ics`;
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(`https://${feed}`);
        toast('Calendar link copied');
      } catch {
        toast('Couldn’t copy the link on this device.', true);
      }
    };
    out.push(section('Appointments in your Calendar', h('div', { class: 'card form' },
      h('p', {}, 'Show Care appointments in this phone’s Calendar app. They update on their own when either of you adds or changes one.'),
      h('a', { class: 'btn primary block', href: `webcal://${feed}` }, 'Subscribe in Calendar'),
      h('button', { class: 'btn ghost block', onclick: copy }, 'Copy calendar link'),
      h('p', { class: 'hint' }, 'The calendar link shows appointments only and can’t change anything. Share it only with people who should see them.'))));
  }

  const dtz = deviceTz();
  const tFever = h('input', { type: 'number', inputmode: 'decimal', step: 0.1, value: toUnit(feverF()).toFixed(1) });
  const tUnit = h('select', { 'aria-label': 'Temperature unit' },
    h('option', { value: 'C', selected: useC() }, '°C'), h('option', { value: 'F', selected: !useC() }, '°F'));
  // The fever level is typed in the unit currently shown and saved in °F.
  const feverToF = () => (useC() ? Math.round((Number(tFever.value) * 9 / 5 + 32) * 10) / 10 : Number(tFever.value));
  const urgentPeople = (S.state.contacts || []).filter((c) => c.urgent);
  out.push(section('Care team', h('div', { class: 'card form' },
    h('p', {}, urgentPeople.length ? `Called for fevers and warning signs: ${urgentPeople.map((c) => c.name).join(', ')}.`
      : 'No one is marked to call for fevers and warning signs yet.'),
    h('button', { type: 'button', class: 'btn ghost block', onclick: openCircle }, 'Circle of care (doctors, nurses, phone numbers)'),
    h('div', { class: 'grid2' },
      field(`Fever level (${tempUnit()})`, tFever),
      field('Temperatures in', tUnit)),
    h('p', { class: 'hint' }, 'Most cancer teams say to call at 38.0°C (100.4°F). Use the number your team gave you.'),
    h('button', { type: 'button', class: 'btn primary block', onclick: () => mutate('settings', { method: 'POST', body: {
      fever_f: feverToF(), temp_unit: tUnit.value,
    } }, 'Saved') }, 'Save fever level'),
    h('button', { type: 'button', class: 'btn ghost block', onclick: openWhenToCall }, 'When to call the care team'))));

  const cs = containers();
  const saveContainers = (list) => mutate('settings', { method: 'POST', body: { water_containers: list } }, 'Containers saved');
  const cName = h('input', { placeholder: 'Name, e.g. Yeti', 'aria-label': 'Container name', maxlength: 30 });
  const cMl = h('input', { type: 'number', inputmode: 'numeric', min: 1, max: 5000, placeholder: 'mL', 'aria-label': 'Container size in mL' });
  const goalIn = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 10000, step: 50, value: String(S.state.waterGoal ?? 2000), 'aria-label': 'Daily goal in mL' });
  out.push(section('Water', h('div', { class: 'card form' },
    h('span', { class: 'label' }, 'Containers (one tap adds a full one)'),
    cs.length ? h('div', { class: 'chips' }, cs.map((c, i) => h('span', { class: 'time-chip' }, `${c.name} · ${fmtMl(c.ml)}`,
      h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Remove ${c.name}`,
        onclick: () => { if (confirm(`Remove ${c.name}?`)) saveContainers(cs.filter((_, j) => j !== i)); } }, '✕')))) : null,
    h('div', { class: 'container-add' }, cName, cMl,
      h('button', { type: 'button', class: 'btn ghost', onclick: () => {
        const ml = Math.round(Number(cMl.value));
        if (!cName.value.trim() || !(ml > 0 && ml <= 5000)) return toast('Enter a name and a size in mL (up to 5,000).', true);
        saveContainers([...cs, { name: cName.value.trim(), ml }]);
      } }, 'Add')),
    h('p', { class: 'hint' }, 'Tip: the size is usually printed on the bottom of a bottle or cup, e.g. a 26 oz Yeti is about 770 mL.'),
    field('Daily goal (mL)', h('div', { class: 'add-time' }, goalIn,
      h('button', { type: 'button', class: 'btn ghost', onclick: () => mutate('settings', { method: 'POST', body: { water_goal: Number(goalIn.value) } }, 'Goal saved') }, 'Save')),
    'Ask the care team how much to aim for; set 0 to hide the goal.'))));

  const exGoalIn = h('input', { type: 'number', inputmode: 'numeric', min: 0, max: 600, step: 5, value: String(S.state.exerciseGoal ?? 20), 'aria-label': 'Daily exercise goal in minutes' });
  out.push(section('Exercise', h('div', { class: 'card form' },
    field('Daily goal (minutes)', h('div', { class: 'add-time' }, exGoalIn,
      h('button', { type: 'button', class: 'btn ghost', onclick: () => mutate('settings', { method: 'POST', body: { exercise_goal: Number(exGoalIn.value) } }, 'Goal saved') }, 'Save')),
    'Ask the care team what’s right during treatment; even short walks count. Set 0 to hide the goal.'))));

  const painTimes = S.state.painTimes || [];
  const savePainTimes = (times) => mutate('settings', { method: 'POST', body: { pain_times: times } }, 'Check-in times saved');
  const newPainTime = h('input', { type: 'time', 'aria-label': 'New check-in time', value: '12:00' });
  out.push(section('Pain check-in times', h('div', { class: 'card form' },
    h('p', {}, painTimes.length ? 'A reminder to rate pain goes out at:' : 'No pain check-ins are set.'),
    painTimes.length ? h('div', { class: 'chips' }, painTimes.map((t) => h('span', { class: 'time-chip' }, fmtTime(t),
      h('button', { type: 'button', class: 'icon-btn small', 'aria-label': `Remove ${fmtTime(t)}`,
        onclick: () => savePainTimes(painTimes.filter((x) => x !== t)) }, '✕')))) : null,
    h('div', { class: 'add-time' }, newPainTime,
      h('button', { type: 'button', class: 'btn ghost', onclick: () => {
        if (newPainTime.value && !painTimes.includes(newPainTime.value)) savePainTimes([...painTimes, newPainTime.value]);
      } }, 'Add time')),
    h('p', { class: 'hint' }, 'Each phone chooses whether to get these under “Reminders on this device”. Pain can also be rated any time, day or night, from the Today screen.'))));

  out.push(section('Time zone', h('div', { class: 'card form' },
    h('p', {}, 'Reminder times follow ', h('strong', {}, S.state.timezone || dtz), '.'),
    S.state.timezone && S.state.timezone !== dtz
      ? h('button', { class: 'btn ghost block', onclick: () => mutate('settings', { method: 'POST', body: { timezone: dtz } }, 'Time zone updated') }, `Switch to ${dtz}`)
      : null)));

  out.push(section(null,
    h('a', { class: 'btn ghost block', href: '/help' }, 'How to use Care (help)'),
    h('button', { class: 'btn ghost block', onclick: () => { if (confirm('Sign out on this device?')) signOut(); } }, 'Sign out on this device'),
    h('p', { class: 'hint center' }, 'Care Companion is a reminder helper. Always follow the care team’s instructions for doses and timing.')));
  return out;
}

// ---------- start ----------

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(async (reg) => {
    if ('PushManager' in window) {
      S.sub = await reg.pushManager.getSubscription();
      render();
    }
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open') {
      const url = new URL(e.data.url);
      setTab(url.searchParams.get('tab') || 'today');
      S.openPain = url.searchParams.get('pain') === '1';
      refresh();
    }
  });
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60e3);

render();
refresh({ quiet: !!S.state });
if (!S.code) checkSetup();

// Ticks any running symptom timers on screen once a second, without redrawing the page.
setInterval(() => {
  for (const el of document.querySelectorAll('[data-since]')) el.textContent = fmtElapsed(Date.now() - Number(el.dataset.since));
}, 1000);
