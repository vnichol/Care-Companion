import { sendPush, b64u } from './webpush.js';
import { localParts, addDays, wallMs, fmtTime, fmtDate, medOnDate } from './time.js';
import { calendarToken, buildCalendar } from './calendar.js';

const MIN = 60e3;
const enc = new TextEncoder();

class BadRequest extends Error {}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cal = url.pathname.match(/^\/cal\/([\w-]+)\.ics$/);
    if (cal) return calendarFeed(cal[1], env, url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      env = await withSetup(env);
      if (url.pathname === '/api/setup') return await setup(request, env);
      if (!(await authorized(request, env))) return json({ error: 'unauthorized' }, 401);
      return await route(request, env, url, ctx);
    } catch (e) {
      if (e instanceof BadRequest) return json({ error: e.message }, 400);
      console.error(e);
      return json({ error: 'Something went wrong on the server.' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(withSetup(env).then((e) => (e.CODE_HASH ? runReminders(e, new Date(event.scheduledTime)) : null)));
  },
};

// ---------- auth ----------

const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const sha256 = async (s) => b64u.encode(await crypto.subtle.digest('SHA-256', enc.encode(s)));

// The family code (stored only as a hash) and the push keys live in the settings table.
// They're made by the first-run setup screen, so nothing has to be configured by hand.
async function withSetup(env) {
  const rows = (await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('code_hash', 'vapid')").all()
    .catch(() => { throw new BadRequest('The database isn’t set up yet. Run the deploy again (it creates the tables).'); })).results;
  const get = (k) => rows.find((r) => r.key === k)?.value;
  const vapid = get('vapid') ? JSON.parse(get('vapid')) : {};
  return { ...env, CODE_HASH: get('code_hash') || null, VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_JWK: vapid.privateJwk && JSON.stringify(vapid.privateJwk) };
}

async function authorized(request, env) {
  if (!env.CODE_HASH) return false;
  const given = enc.encode(await sha256(normCode((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''))));
  const expected = enc.encode(env.CODE_HASH);
  return given.length === expected.length && crypto.subtle.timingSafeEqual(given, expected);
}

// GET: has this copy been set up yet? POST: set it up (only works once, before there's a family code).
async function setup(request, env) {
  if (request.method === 'GET') return json({ needsSetup: !env.CODE_HASH });
  if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
  if (env.CODE_HASH) return json({ error: 'Care is already set up. Sign in with the family code.' }, 409);
  const b = await request.json().catch(() => ({}));
  const code = normCode(b.code);
  if (code.length < 8) throw new BadRequest('The family code needs at least 8 letters or numbers.');
  if (b.timezone && !validTz(b.timezone)) throw new BadRequest('Unknown time zone.');
  const db = env.DB;
  // ON CONFLICT DO NOTHING: if two people finish setup at the same moment, only the first wins.
  const res = await db.prepare("INSERT INTO settings(key, value) VALUES('code_hash', ?) ON CONFLICT(key) DO NOTHING").bind(await sha256(code)).run();
  if (!res.meta.changes) return json({ error: 'Care is already set up. Sign in with the family code.' }, 409);
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const { kty, crv, x, y, d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const vapid = { publicKey: b64u.encode(await crypto.subtle.exportKey('raw', pair.publicKey)), privateJwk: { kty, crv, x, y, d } };
  const put = (key, value) => db.prepare(`INSERT INTO settings(key, value) VALUES(?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, value);
  await db.batch([
    // Keep existing push keys if the code is being reset, so phones keep getting reminders.
    db.prepare("INSERT INTO settings(key, value) VALUES('vapid', ?) ON CONFLICT(key) DO NOTHING").bind(JSON.stringify(vapid)),
    put('patient_name', text(b.patient_name, 40) || 'the patient'),
    ...(b.timezone ? [put('timezone', b.timezone)] : []),
    put('temp_unit', b.temp_unit === 'F' ? 'F' : 'C'),
  ]);
  return json({ ok: true });
}

async function calendarFeed(token, env, url) {
  const given = enc.encode(token);
  env = await withSetup(env);
  const expected = enc.encode(await calendarToken(env.CODE_HASH || ''));
  if (!env.CODE_HASH || given.length !== expected.length || !crypto.subtle.timingSafeEqual(given, expected)) {
    return new Response('Not found', { status: 404 });
  }
  const tz = (await getTz(env)) || 'UTC';
  const since = addDays(localParts(new Date(), tz).date, -90);
  const appts = (await env.DB.prepare('SELECT * FROM appts WHERE at >= ? ORDER BY at').bind(since).all()).results;
  return new Response(buildCalendar(appts, tz, url.hostname), {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename="care-appointments.ics"',
      'cache-control': 'no-store',
    },
  });
}

// ---------- validation ----------

const text = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const required = (v, what) => { if (!v) throw new BadRequest(`${what} is required.`); return v; };
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const isTime = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '');
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const validTz = (tz) => { try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; } };

// ---------- API ----------

async function route(request, env, url, ctx) {
  const db = env.DB;
  const [, , resource, id] = url.pathname.split('/');
  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};

  switch (`${request.method} ${resource}`) {
    case 'GET state':
      return json(await loadState(env));

    case 'POST settings': {
      const put = (key, value) => db.prepare(`INSERT INTO settings(key, value) VALUES(?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, value).run();
      if (body.timezone !== undefined) {
        if (!validTz(body.timezone)) throw new BadRequest('Unknown time zone.');
        await put('timezone', body.timezone);
      }
      if (body.pain_times !== undefined) {
        const times = [...new Set((body.pain_times || []).filter(isTime))].sort().slice(0, 8);
        await put('pain_times', JSON.stringify(times));
      }
      if (body.water_containers !== undefined) {
        const containers = (body.water_containers || [])
          .map((c) => ({ name: text(c?.name, 30), ml: Math.round(Number(c?.ml)) }))
          .filter((c) => c.name && c.ml > 0 && c.ml <= 5000)
          .slice(0, 8);
        await put('water_containers', JSON.stringify(containers));
      }
      if (body.water_goal !== undefined) {
        const goal = Math.round(Number(body.water_goal));
        if (!(goal >= 0 && goal <= 10000)) throw new BadRequest('Pick a daily goal between 0 and 10,000 mL.');
        await put('water_goal', String(goal));
      }
      if (body.exercise_goal !== undefined) {
        const goal = Math.round(Number(body.exercise_goal));
        if (!(goal >= 0 && goal <= 600)) throw new BadRequest('Pick a daily goal between 0 and 600 minutes.');
        await put('exercise_goal', String(goal));
      }
      if (body.care_team !== undefined) {
        const t = body.care_team || {};
        await put('care_team', JSON.stringify({ name: text(t.name, 80), day: text(t.day, 40), after: text(t.after, 40) }));
      }
      if (body.patient_name !== undefined) await put('patient_name', text(body.patient_name, 40));
      if (body.temp_unit !== undefined) {
        if (!['C', 'F'].includes(body.temp_unit)) throw new BadRequest('Pick °C or °F.');
        await put('temp_unit', body.temp_unit);
      }
      if (body.fever_f !== undefined) {
        const f = Number(body.fever_f);
        if (!(f >= 99 && f <= 103)) throw new BadRequest('Pick a fever level between 99 and 103 °F.');
        await put('fever_f', String(f));
      }
      if (body.visit_questions !== undefined) {
        const qs = (body.visit_questions || []).map((q) => ({ text: text(q?.text, 300), done: !!q?.done })).filter((q) => q.text).slice(0, 50);
        await put('visit_questions', JSON.stringify(qs));
      }
      return json({ ok: true });
    }

    case 'POST temp': {
      let f = Number(body.temp);
      if (f >= 34 && f <= 43) f = f * 9 / 5 + 32; // entered in °C
      if (!(f >= 93 && f <= 108)) throw new BadRequest('Enter a temperature in °C or °F.');
      f = Math.round(f * 10) / 10;
      const now = localParts(new Date(), (await getTz(env)) || 'UTC');
      const chills = body.chills ? 1 : 0;
      await db.prepare('INSERT INTO temps(date, time, temp_f, chills, note, created_at, created_by) VALUES(?, ?, ?, ?, ?, ?, ?)')
        .bind(isDate(body.date) ? body.date : now.date, isTime(body.time) ? body.time : now.time, f, chills,
          text(body.note, 500), new Date().toISOString(), text(body.by, 40)).run();
      const feverF = Number((await db.prepare("SELECT value FROM settings WHERE key = 'fever_f'").first())?.value || 100.4);
      const inC = ((await db.prepare("SELECT value FROM settings WHERE key = 'temp_unit'").first())?.value || 'C') === 'C';
      const shown = inC ? `${(Math.round(((f - 32) * 5 / 9) * 10) / 10).toFixed(1)}°C` : `${f}°F`;
      const fever = f >= feverF;
      if (fever || chills) {
        ctx.waitUntil(alertCaregivers(env, {
          title: fever ? `🌡️ Fever: ${shown}` : '🌡️ Shaking chills reported',
          body: `${text(body.by, 40) || 'Someone'} logged ${shown}${chills ? ' with shaking chills' : ''}. Call the care team now.`,
          tag: 'fever', url: '/',
        }));
      }
      return json({ ok: true, temp_f: f, fever });
    }
    case 'DELETE temp':
      await db.prepare('DELETE FROM temps WHERE id = ?').bind(Number(id)).run();
      return json({ ok: true });

    // Circle of care: everyone on the care team, with who to call for fevers and warning signs.
    case 'POST contacts': {
      const vals = [required(text(body.name, 80), 'Name'), text(body.role, 60), text(body.org, 100), text(body.phone, 40),
        text(body.phone2, 40), text(body.email, 120), text(body.notes, 1000), body.urgent ? 1 : 0];
      if (body.id) {
        await db.prepare('UPDATE contacts SET name = ?, role = ?, org = ?, phone = ?, phone2 = ?, email = ?, notes = ?, urgent = ? WHERE id = ?')
          .bind(...vals, Number(body.id)).run();
      } else {
        await db.prepare('INSERT INTO contacts(name, role, org, phone, phone2, email, notes, urgent) VALUES(?, ?, ?, ?, ?, ?, ?, ?)').bind(...vals).run();
      }
      return json({ ok: true });
    }
    case 'DELETE contacts':
      await db.prepare('DELETE FROM contacts WHERE id = ?').bind(Number(id)).run();
      return json({ ok: true });

    // Bowel movements, with the 7-type stool scale (1 = hard lumps … 7 = watery).
    case 'POST bowel': {
      const type = [1, 2, 3, 4, 5, 6, 7].includes(Number(body.type)) ? Number(body.type) : null;
      const now = localParts(new Date(), (await getTz(env)) || 'UTC');
      const blood = body.blood ? 1 : 0, black = body.black ? 1 : 0;
      await db.prepare(`INSERT INTO bowel(date, time, type, amount, strain, blood, black, note, created_at, created_by)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(isDate(body.date) ? body.date : now.date, isTime(body.time) ? body.time : now.time, type,
          ['small', 'medium', 'large'].includes(body.amount) ? body.amount : '', body.strain ? 1 : 0, blood, black,
          text(body.note, 500), new Date().toISOString(), text(body.by, 40)).run();
      if (blood || black) {
        ctx.waitUntil(alertCaregivers(env, {
          title: '⚠️ Blood in a bowel movement',
          body: `${text(body.by, 40) || 'Someone'} logged a bowel movement with ${black ? 'black or tarry stool' : 'blood'}. Call the care team.`,
          tag: 'bowel', url: '/',
        }));
      }
      return json({ ok: true });
    }
    case 'DELETE bowel':
      await db.prepare('DELETE FROM bowel WHERE id = ?').bind(Number(id)).run();
      return json({ ok: true });

    // Symptom episodes: started now (timer running until stopped) or logged afterwards with a length.
    case 'POST episodes': {
      const name = required(text(body.name, 60), 'What the symptom was');
      const severity = body.severity === 'major' ? 'major' : 'minor';
      const minutesAgo = Math.max(0, Math.min(7 * 1440, Number(body.minutes_ago) || 0));
      const started = new Date(Date.now() - minutesAgo * 60e3);
      const length = Number(body.duration_min);
      // A length ends it; "no_length" saves it as over with no length noted (ended at the start time).
      const ended = length > 0 ? new Date(started.getTime() + Math.min(length, 1440) * 60e3) : body.no_length ? started : null;
      const at = localParts(started, (await getTz(env)) || 'UTC');
      await db.prepare(`INSERT INTO episodes(date, time, name, severity, area, note, started_at, ended_at, created_by)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(at.date, at.time, name, severity, text(body.area, 60), text(body.note, 500), started.toISOString(),
          ended ? ended.toISOString() : null, text(body.by, 40)).run();
      return json({ ok: true });
    }
    case 'POST stop': {
      await db.prepare('UPDATE episodes SET ended_at = ?, note = CASE WHEN ? != \'\' THEN ? ELSE note END WHERE id = ? AND ended_at IS NULL')
        .bind(new Date().toISOString(), text(body.note, 500), text(body.note, 500), Number(id)).run();
      return json({ ok: true });
    }
    case 'DELETE episodes':
      await db.prepare('DELETE FROM episodes WHERE id = ?').bind(Number(id)).run();
      return json({ ok: true });

    case 'POST checkin': {
      const s = body.symptoms || {};
      const symptoms = {};
      for (const k of ['fatigue', 'numbness', 'nausea', 'breath']) {
        if ([0, 1, 2, 3, 4].includes(s[k])) symptoms[k] = s[k];
      }
      for (const [k, allowed] of Object.entries(CHECKIN_CHOICES)) {
        if (allowed.includes(s[k])) symptoms[k] = s[k];
      }
      const areas = (body.areas || []).map((a) => text(a, 30)).filter(Boolean).slice(0, 12);
      const flags = (body.flags || []).filter((f) => WARNING_FLAGS.includes(f));
      const now = localParts(new Date(), (await getTz(env)) || 'UTC');
      await db.prepare('INSERT INTO checkins(date, time, symptoms, areas, flags, note, created_at, created_by) VALUES(?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(isDate(body.date) ? body.date : now.date, isTime(body.time) ? body.time : now.time,
          JSON.stringify(symptoms), JSON.stringify(areas), JSON.stringify(flags), text(body.note, 1000),
          new Date().toISOString(), text(body.by, 40)).run();
      if (flags.length) {
        ctx.waitUntil(alertCaregivers(env, {
          title: '⚠️ Warning sign reported',
          body: `${text(body.by, 40) || 'Someone'} reported: ${flags.join('; ')}. Call the care team now.`,
          tag: 'warning', url: '/',
        }));
      }
      return json({ ok: true });
    }
    case 'DELETE checkin':
      await db.prepare('DELETE FROM checkins WHERE id = ?').bind(Number(id)).run();
      return json({ ok: true });

    case 'POST exercise': {
      const minutes = Math.round(Number(body.minutes));
      if (!(minutes > 0 && minutes <= 600)) throw new BadRequest('Enter between 1 and 600 minutes.');
      const now = localParts(new Date(), (await getTz(env)) || 'UTC');
      await db.prepare('INSERT INTO exercise(date, time, minutes, activity, note, created_at, created_by) VALUES(?, ?, ?, ?, ?, ?, ?)')
        .bind(isDate(body.date) ? body.date : now.date, isTime(body.time) ? body.time : now.time, minutes,
          text(body.activity, 40), text(body.note, 500), new Date().toISOString(), text(body.by, 40)).run();
      return json({ ok: true });
    }
    case 'DELETE exercise':
      await db.prepare('DELETE FROM exercise WHERE id = ?').bind(Number(id)).run();
      return json({ ok: true });

    case 'POST water': {
      const ml = Math.round(Number(body.ml));
      if (!(ml > 0 && ml <= 5000)) throw new BadRequest('Enter an amount between 1 and 5,000 mL.');
      const now = localParts(new Date(), (await getTz(env)) || 'UTC');
      await db.prepare('INSERT INTO water(date, time, ml, label, created_at, created_by) VALUES(?, ?, ?, ?, ?, ?)')
        .bind(isDate(body.date) ? body.date : now.date, isTime(body.time) ? body.time : now.time, ml,
          text(body.label, 30), new Date().toISOString(), text(body.by, 40)).run();
      return json({ ok: true });
    }
    case 'DELETE water':
      await db.prepare('DELETE FROM water WHERE id = ?').bind(Number(id)).run();
      return json({ ok: true });

    case 'POST pain': {
      const score = Number(body.score);
      if (!Number.isInteger(score) || score < 0 || score > 10) throw new BadRequest('Pick a pain score from 0 to 10.');
      const now = localParts(new Date(), (await getTz(env)) || 'UTC');
      const date = isDate(body.date) ? body.date : now.date;
      const time = isTime(body.time) ? body.time : now.time;
      await db.prepare('INSERT INTO pain(date, time, score, note, created_at, created_by) VALUES(?, ?, ?, ?, ?, ?)')
        .bind(date, time, score, text(body.note, 1000), new Date().toISOString(), text(body.by, 40)).run();
      return json({ ok: true });
    }
    case 'DELETE pain':
      await db.prepare('DELETE FROM pain WHERE id = ?').bind(Number(id)).run();
      return json({ ok: true });

    case 'POST meds':
      await saveMed(db, body);
      return json({ ok: true });
    case 'POST import': {
      // All rows are checked first, then written together: a bad row means nothing is imported.
      const rows = Array.isArray(body.meds) ? body.meds.slice(0, 200) : [];
      if (!rows.length) throw new BadRequest('No medications to import.');
      await db.batch(rows.map((m) => medStatement(db, m)));
      return json({ ok: true, count: rows.length });
    }
    case 'DELETE meds':
      await db.batch([
        db.prepare('DELETE FROM meds WHERE id = ?').bind(Number(id)),
        db.prepare('DELETE FROM dose_log WHERE med_id = ?').bind(Number(id)),
      ]);
      return json({ ok: true });

    case 'POST appts':
      await saveAppt(db, body);
      return json({ ok: true });
    case 'DELETE appts':
      await db.prepare('DELETE FROM appts WHERE id = ?').bind(Number(id)).run();
      return json({ ok: true });

    case 'POST log':
      await (id ? editDose(db, Number(id), body) : logDose(db, body));
      return json({ ok: true });
    case 'DELETE log': {
      const row = await db.prepare('SELECT * FROM dose_log WHERE id = ?').bind(Number(id)).first();
      if (row) {
        await db.prepare('DELETE FROM dose_log WHERE id = ?').bind(row.id).run();
        if (row.status === 'taken') {
          const med = await db.prepare('SELECT pills_per_dose FROM meds WHERE id = ?').bind(row.med_id).first();
          if (med) await usePills(db, row.med_id, -(row.amount ?? med.pills_per_dose));
        }
      }
      return json({ ok: true });
    }

    case 'POST journal': {
      const tz = (await getTz(env)) || 'UTC';
      const date = isDate(body.date) ? body.date : localParts(new Date(), tz).date;
      const feeling = [1, 2, 3, 4, 5].includes(Number(body.feeling)) ? Number(body.feeling) : null;
      const note = text(body.text, 4000);
      if (!note && !feeling) throw new BadRequest('Write a note or pick how you’re feeling.');
      await db.prepare('INSERT INTO journal(date, text, feeling, created_at, created_by) VALUES(?, ?, ?, ?, ?)')
        .bind(date, note, feeling, new Date().toISOString(), text(body.by, 40)).run();
      return json({ ok: true });
    }
    case 'DELETE journal':
      await db.prepare('DELETE FROM journal WHERE id = ?').bind(Number(id)).run();
      return json({ ok: true });

    case 'POST subscribe': {
      const s = body.subscription || {};
      if (!/^https:\/\//.test(s.endpoint || '') || !s.keys?.p256dh || !s.keys?.auth) throw new BadRequest('Invalid subscription.');
      await db.prepare(`INSERT INTO subscriptions(endpoint, p256dh, auth, label, meds, appts, missed, pain)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, label = excluded.label,
          meds = excluded.meds, appts = excluded.appts, missed = excluded.missed, pain = excluded.pain`)
        .bind(s.endpoint, s.keys.p256dh, s.keys.auth, text(body.label, 60),
          body.meds === false ? 0 : 1, body.appts === false ? 0 : 1, body.missed ? 1 : 0, body.pain ? 1 : 0).run();
      return json({ ok: true });
    }
    case 'POST unsubscribe':
      await db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(text(body.endpoint, 2000)).run();
      return json({ ok: true });
    case 'POST test-push': {
      const sub = await db.prepare('SELECT * FROM subscriptions WHERE endpoint = ?').bind(text(body.endpoint, 2000)).first();
      if (!sub) throw new BadRequest('This device is not signed up for reminders yet.');
      const status = await sendPush(sub, {
        title: 'Test reminder', body: 'Reminders are working on this device. 💛', tag: 'test', url: '/',
      }, env);
      if (status === 404 || status === 410) {
        await db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(sub.endpoint).run();
      }
      return json({ ok: status >= 200 && status < 300, status });
    }
  }
  return json({ error: 'not_found' }, 404);
}

// Check-in answers that aren't 0–4 scales, and the warning signs that need an urgent call.
const CHECKIN_CHOICES = {
  bowels: ['normal', 'constipated', 'diarrhea', 'none'],
  sleep: ['great', 'good', 'ok', 'poor', 'very_poor'],
  appetite: ['great', 'good', 'ok', 'poor', 'very_poor'],
  mood: ['great', 'good', 'ok', 'low', 'very_low'],
};
const WARNING_FLAGS = [
  'Back pain with leg weakness or numbness',
  'Swollen or painful leg',
  'Chest pain or sudden shortness of breath',
  'Shaking chills',
  'Unusual bleeding or bruising',
  'Confusion or extreme drowsiness',
];

// Urgent pushes go to phones that asked for "tell me if…" alerts (the caregiver setting).
async function alertCaregivers(env, message) {
  const subs = (await env.DB.prepare('SELECT * FROM subscriptions WHERE missed = 1').all()).results;
  await Promise.allSettled(subs.map((s) => sendPush(s, message, env)));
}

async function getTz(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'").first();
  return row?.value || null;
}

async function loadState(env) {
  const db = env.DB;
  const tz = await getTz(env);
  const today = localParts(new Date(), tz || 'UTC').date;
  const since = addDays(today, -60);
  const [meds, appts, logs, journal, subs, pain, water, waterSettings, exercise, temps, checkins, episodes, contacts, bowel] = await db.batch([
    db.prepare('SELECT * FROM meds ORDER BY active DESC, name COLLATE NOCASE'),
    db.prepare('SELECT * FROM appts ORDER BY at'),
    db.prepare('SELECT * FROM dose_log WHERE date >= ? ORDER BY date, time').bind(since),
    db.prepare('SELECT * FROM journal WHERE date >= ? ORDER BY created_at DESC').bind(since),
    db.prepare('SELECT endpoint, label, meds, appts, missed, pain FROM subscriptions ORDER BY created_at'),
    db.prepare('SELECT * FROM pain WHERE date >= ? ORDER BY date, time').bind(since),
    db.prepare('SELECT * FROM water WHERE date >= ? ORDER BY date, time').bind(since),
    db.prepare("SELECT key, value FROM settings WHERE key IN ('water_containers', 'water_goal', 'exercise_goal', 'care_team', 'fever_f', 'visit_questions', 'temp_unit', 'patient_name')"),
    db.prepare('SELECT * FROM exercise WHERE date >= ? ORDER BY date, time').bind(since),
    db.prepare('SELECT * FROM temps WHERE date >= ? ORDER BY date, time').bind(since),
    db.prepare('SELECT * FROM checkins WHERE date >= ? ORDER BY date, time').bind(since),
    db.prepare('SELECT * FROM episodes WHERE date >= ? OR ended_at IS NULL ORDER BY started_at').bind(since),
    db.prepare('SELECT * FROM contacts ORDER BY urgent DESC, name COLLATE NOCASE'),
    db.prepare('SELECT * FROM bowel WHERE date >= ? ORDER BY date, time').bind(since),
  ]);
  const setting = (key) => waterSettings.results.find((r) => r.key === key)?.value;
  return {
    timezone: tz,
    vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
    calendarToken: await calendarToken(env.CODE_HASH),
    patientName: setting('patient_name') || '',
    meds: meds.results.map((m) => ({ ...m, times: JSON.parse(m.times), days: JSON.parse(m.days), slots: JSON.parse(m.slots || '[]') })),
    appts: appts.results.map((a) => ({ ...a, remind: JSON.parse(a.remind) })),
    logs: logs.results,
    journal: journal.results,
    devices: subs.results,
    pain: pain.results,
    painTimes: await getPainTimes(env),
    water: water.results,
    waterContainers: setting('water_containers') ? JSON.parse(setting('water_containers')) : DEFAULT_CONTAINERS,
    waterGoal: setting('water_goal') ? Number(setting('water_goal')) : 2000,
    exercise: exercise.results,
    exerciseGoal: setting('exercise_goal') ? Number(setting('exercise_goal')) : 20,
    temps: temps.results,
    episodes: episodes.results,
    contacts: contacts.results,
    bowel: bowel.results,
    checkins: checkins.results.map((c) => ({ ...c, symptoms: JSON.parse(c.symptoms), areas: JSON.parse(c.areas), flags: JSON.parse(c.flags) })),
    careTeam: setting('care_team') ? JSON.parse(setting('care_team')) : { name: '', day: '', after: '' },
    feverF: setting('fever_f') ? Number(setting('fever_f')) : 100.4,
    tempUnit: setting('temp_unit') || 'C',
    questions: setting('visit_questions') ? JSON.parse(setting('visit_questions')) : [],
  };
}

const DEFAULT_CONTAINERS = [{ name: 'Glass', ml: 250 }, { name: 'Bottle', ml: 500 }];
const DEFAULT_PAIN_TIMES = ['09:00', '13:00', '17:00', '21:00'];

async function getPainTimes(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'pain_times'").first();
  return row ? JSON.parse(row.value) : DEFAULT_PAIN_TIMES;
}

const UNITS = ['pill', 'mL', 'capful', 'packet', 'scoop', 'puff', 'patch', 'drop', 'dose'];

// Checks a medication and returns the statement that saves it (nothing is written yet).
function medStatement(db, b) {
  const name = required(text(b.name, 100), `Medication name${b.ext_id ? ` (${b.ext_id})` : ''}`);
  const kind = b.kind === 'clinic' ? 'clinic' : 'regular';
  const asNeeded = b.as_needed || kind === 'clinic' ? 1 : 0;
  // Times and their blister-pack slots travel together, sorted by time.
  const pairs = asNeeded ? [] : (b.times || []).map((t, i) => [t, text((b.slots || [])[i], 8).toUpperCase()])
    .filter(([t]) => isTime(t)).sort((x, y) => x[0].localeCompare(y[0]))
    .filter(([t], i, all) => i === 0 || all[i - 1][0] !== t);
  if (!asNeeded && !pairs.length) throw new BadRequest(`Add at least one time for ${name}, or mark it "as needed".`);
  let days = [...new Set((b.days || []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
  if (days.length === 7) days = [];
  const interval = Math.max(0, Math.min(90, Math.round(Number(b.interval_days) || 0)));
  if (interval > 1 && !isDate(b.start_date)) throw new BadRequest(`${name}: pick a start date so “every ${interval} days” knows where to count from.`);
  const status = ['active', 'confirm', 'hold'].includes(b.status) ? b.status : 'active';
  const vals = [
    name, text(b.dose, 100), text(b.instructions, 300), JSON.stringify(pairs.map((p) => p[0])), JSON.stringify(days), asNeeded,
    num(b.pills_left), num(b.pills_per_dose) ?? 1, num(b.refill_at),
    isDate(b.start_date) ? b.start_date : null, isDate(b.end_date) ? b.end_date : null,
    b.active === false || status === 'hold' ? 0 : 1, text(b.about, 1500), UNITS.includes(b.unit) ? b.unit : 'pill',
    text(b.ext_id, 60) || null, text(b.generic, 100), interval, JSON.stringify(pairs.map((p) => p[1])), status,
    text(b.notes, 1000), kind, num(b.prn_min_hours), num(b.prn_max_day),
  ];
  const cols = 'name, dose, instructions, times, days, as_needed, pills_left, pills_per_dose, refill_at, start_date, end_date, active, about, unit, '
    + 'ext_id, generic, interval_days, slots, status, notes, kind, prn_min_hours, prn_max_day';
  if (b.id) {
    const set = cols.split(', ').map((c) => `${c} = ?`).join(', ');
    return db.prepare(`UPDATE meds SET ${set} WHERE id = ?`).bind(...vals, Number(b.id));
  }
  return db.prepare(`INSERT INTO meds(${cols}) VALUES(${vals.map(() => '?').join(', ')})`).bind(...vals);
}

const saveMed = (db, b) => medStatement(db, b).run();

async function saveAppt(db, b) {
  const title = required(text(b.title, 120), 'Appointment name');
  if (!isDate(b.date) || !isTime(b.time)) throw new BadRequest('Pick a date and time.');
  const remind = [...new Set((b.remind || []).map(Number).filter((m) => [10080, 1440, 120, 60, 30].includes(m)))];
  const vals = [title, `${b.date}T${b.time}`, text(b.location, 200), text(b.notes, 2000), JSON.stringify(remind)];
  if (b.id) {
    await db.prepare('UPDATE appts SET title = ?, at = ?, location = ?, notes = ?, remind = ? WHERE id = ?')
      .bind(...vals, Number(b.id)).run();
  } else {
    await db.prepare('INSERT INTO appts(title, at, location, notes, remind) VALUES(?, ?, ?, ?, ?)').bind(...vals).run();
  }
}

async function logDose(db, b) {
  const medId = Number(b.med_id);
  if (!isDate(b.date) || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(b.time || '')) throw new BadRequest('Bad dose time.');
  if (!['taken', 'skipped'].includes(b.status)) throw new BadRequest('Bad status.');
  const med = await db.prepare('SELECT pills_per_dose FROM meds WHERE id = ?').bind(medId).first();
  if (!med) throw new BadRequest('That medication no longer exists.');
  const prev = await db.prepare('SELECT status, amount FROM dose_log WHERE med_id = ? AND date = ? AND time = ?')
    .bind(medId, b.date, b.time).first();
  // taken_time: when it was actually taken, if logged after the fact (local "HH:MM").
  const takenTime = b.status === 'taken' && isTime(b.taken_time) ? b.taken_time : null;
  // amount: pills taken this time, when it differs from the usual pills per dose.
  const amount = b.status === 'taken' && num(b.amount) > 0 ? Math.min(num(b.amount), 100) : null;
  await db.prepare(`INSERT INTO dose_log(med_id, date, time, status, logged_at, logged_by, taken_time, amount) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(med_id, date, time) DO UPDATE SET status = excluded.status, logged_at = excluded.logged_at,
      logged_by = excluded.logged_by, taken_time = excluded.taken_time, amount = excluded.amount`)
    .bind(medId, b.date, b.time, b.status, new Date().toISOString(), text(b.by, 40), takenTime, amount).run();
  const used = (status, amt) => (status === 'taken' ? amt ?? med.pills_per_dose : 0);
  const delta = used(b.status, amount) - used(prev?.status, prev?.amount);
  if (delta) await usePills(db, medId, delta);
}

// Changes when a taken dose was taken, and how much. A scheduled dose keeps its slot and day;
// an as-needed or extra dose can move to another day too.
async function editDose(db, id, b) {
  const row = await db.prepare('SELECT * FROM dose_log WHERE id = ?').bind(id).first();
  if (!row) throw new BadRequest('That dose was already removed.');
  if (row.status !== 'taken') throw new BadRequest('Only taken doses can be changed.');
  if (!isTime(b.taken_time)) throw new BadRequest('Enter the time it was taken.');
  const med = await db.prepare('SELECT pills_per_dose FROM meds WHERE id = ?').bind(row.med_id).first();
  const amount = b.amount === undefined ? row.amount : num(b.amount) > 0 ? Math.min(num(b.amount), 100) : null;
  let { date, time } = row;
  if (row.time.length === 8) {
    if (isDate(b.date)) date = b.date;
    // Extra doses are keyed by their time (with seconds so several can share a minute).
    const used = new Set((await db.prepare('SELECT time FROM dose_log WHERE med_id = ? AND date = ? AND id != ?')
      .bind(row.med_id, date, id).all()).results.map((r) => r.time));
    let sec = 0;
    while (sec < 59 && used.has(`${b.taken_time}:${String(sec).padStart(2, '0')}`)) sec++;
    time = `${b.taken_time}:${String(sec).padStart(2, '0')}`;
  }
  await db.prepare('UPDATE dose_log SET date = ?, time = ?, taken_time = ?, amount = ? WHERE id = ?')
    .bind(date, time, b.taken_time, amount, id).run();
  const usual = med?.pills_per_dose ?? 1;
  const delta = (amount ?? usual) - (row.amount ?? usual);
  if (delta && med) await usePills(db, row.med_id, delta);
}

// Counts pills off the supply on hand (a negative number puts them back).
function usePills(db, medId, pills) {
  return db.prepare('UPDATE meds SET pills_left = MAX(0, pills_left - ?) WHERE id = ? AND pills_left IS NOT NULL')
    .bind(pills, medId).run();
}

// ---------- reminders (runs every minute) ----------

export async function runReminders(env, now = new Date()) {
  const db = env.DB;
  const tz = await getTz(env);
  const subs = (await db.prepare('SELECT * FROM subscriptions').all()).results;
  if (!tz || !subs.length) return;

  const L = localParts(now, tz);
  const yesterday = addDays(L.date, -1);
  const [medsR, logsR, apptsR] = await db.batch([
    db.prepare('SELECT * FROM meds WHERE active = 1'),
    db.prepare('SELECT med_id, date, time FROM dose_log WHERE date >= ?').bind(yesterday),
    db.prepare('SELECT * FROM appts WHERE at >= ?').bind(yesterday),
  ]);
  const logged = new Set(logsR.results.map((r) => `${r.med_id}|${r.date}|${r.time}`));

  const due = [];
  for (const med of medsR.results) {
    const label = [med.name, med.dose].filter(Boolean).join(' ');
    if (!med.as_needed) {
      for (const date of [yesterday, L.date]) {
        if (!medOnDate(med, date)) continue;
        const slots = JSON.parse(med.slots || '[]');
        for (const [i, t] of JSON.parse(med.times).entries()) {
          if (logged.has(`${med.id}|${date}|${t}`)) continue;
          const age = L.ms - wallMs(date, t);
          if (age >= 0 && age < 15 * MIN) {
            due.push({ key: `dose:${med.id}:${date}:${t}`, kind: 'meds', group: `dose:${date}:${t}:${slots[i] || ''}`, t, slot: slots[i] || '', short: med.name,
              line: med.instructions ? `${label} — ${med.instructions}` : label });
          } else if (age >= 30 * MIN && age < 90 * MIN) {
            due.push({ key: `missed:${med.id}:${date}:${t}`, kind: 'missed', group: `missed:${date}:${t}`, t, line: label });
          }
        }
      }
    }
    if (med.pills_left != null && med.refill_at != null && med.pills_left <= med.refill_at && L.time >= '10:00') {
      due.push({ key: `refill:${med.id}:${L.date}`, kind: 'meds', group: `refill:${med.id}`,
        line: `${label}: ${med.pills_left} left. Time to call in a refill.` });
    }
  }
  for (const a of apptsR.results) {
    const start = wallMs(a.at.slice(0, 10), a.at.slice(11, 16));
    for (const m of JSON.parse(a.remind)) {
      const age = L.ms - (start - m * MIN);
      if (age >= 0 && age < 15 * MIN && L.ms < start) {
        due.push({ key: `appt:${a.id}:${a.at}:${m}`, kind: 'appts', group: `appt:${a.id}:${m}`, appt: a, m });
      }
    }
  }
  // Pain check-ins, skipped if a rating was entered in the last hour.
  const recentPain = await db.prepare('SELECT id FROM pain WHERE created_at >= ?')
    .bind(new Date(now.getTime() - 60 * MIN).toISOString()).first();
  if (!recentPain) {
    for (const t of await getPainTimes(env)) {
      const age = L.ms - wallMs(L.date, t);
      if (age >= 0 && age < 15 * MIN) due.push({ key: `pain:${L.date}:${t}`, kind: 'pain', group: `pain:${L.date}:${t}` });
    }
  }
  if (L.time === '03:00') await db.prepare("DELETE FROM sent_log WHERE sent_at < datetime('now', '-8 days')").run();
  if (!due.length) return;

  // Claim each reminder in sent_log first; only the ones newly inserted get sent.
  const claims = await db.batch(due.map((d) => db.prepare('INSERT OR IGNORE INTO sent_log(key) VALUES(?)').bind(d.key)));
  const fresh = due.filter((_, i) => claims[i].meta.changes === 1);

  const groups = new Map();
  for (const d of fresh) {
    if (!groups.has(d.group)) groups.set(d.group, []);
    groups.get(d.group).push(d);
  }
  const messages = [...groups.entries()].map(([group, items]) => ({ kind: items[0].kind, ...buildMessage(group, items) }));

  const gone = new Set();
  await Promise.allSettled(messages.flatMap((msg) =>
    subs.filter((s) => s[msg.kind] === 1).map(async (s) => {
      const { kind, ...payload } = msg;
      const status = await sendPush(s, payload, env);
      if (status === 404 || status === 410) gone.add(s.endpoint);
      else if (status >= 300) console.warn('push failed', status, s.label);
    }),
  ));
  if (gone.size) {
    await db.batch([...gone].map((e) => db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').bind(e)));
  }
  return messages;
}

// Pharmacy blister-pack slot codes.
const PACK_NAMES = { BK: 'Breakfast', LU: 'Lunch', SP: 'Supper', BD: 'Bedtime', HS: 'Bedtime' };

function buildMessage(group, items) {
  const first = items[0];
  if (group.startsWith('dose:')) {
    // A whole blister pack due together becomes one short reminder.
    const pack = items.every((i) => i.slot && i.slot === first.slot) ? (PACK_NAMES[first.slot] || first.slot) : null;
    return {
      title: pack ? `💊 ${fmtTime(first.t)} ${pack} blister pack` : `💊 ${fmtTime(first.t)} medication${items.length > 1 ? 's' : ''}`,
      body: pack ? `${items.length} medicine${items.length > 1 ? 's' : ''}: ${items.map((i) => i.short).join(', ')}` : items.map((i) => i.line).join('\n'),
      tag: group, url: '/?tab=today',
    };
  }
  if (group.startsWith('missed:')) {
    return {
      title: 'Not checked off yet',
      body: `${items.map((i) => i.line).join(', ')} (${fmtTime(first.t)}) hasn't been marked as taken.`,
      tag: group, url: '/?tab=today',
    };
  }
  if (group.startsWith('pain:')) {
    return { title: 'How is your pain right now?', body: 'Tap to rate it from 0 to 10.', tag: group, url: '/?pain=1' };
  }
  if (group.startsWith('refill:')) {
    return { title: 'Refill reminder', body: first.line, tag: group, url: '/?tab=meds' };
  }
  const { appt, m } = first;
  const when = m >= 10080 ? 'in one week' : m >= 1440 ? 'tomorrow'
    : m >= 60 ? `in ${m / 60} hour${m > 60 ? 's' : ''}` : `in ${m} minutes`;
  const date = m >= 1440 ? `${fmtDate(appt.at.slice(0, 10))}, ` : '';
  return {
    title: `📅 Appointment ${when}`,
    body: `${appt.title}: ${date}${fmtTime(appt.at.slice(11, 16))}${appt.location ? ` · ${appt.location}` : ''}`,
    tag: group, url: '/?tab=appts',
  };
}
