-- Care Companion: all tables. Applied automatically on every deploy (npm run deploy).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  dose TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  times TEXT NOT NULL DEFAULT '[]',      -- JSON ["08:00","20:00"]
  days TEXT NOT NULL DEFAULT '[]',       -- JSON weekdays 0=Sun; [] = every day
  as_needed INTEGER NOT NULL DEFAULT 0,
  pills_left REAL,
  pills_per_dose REAL NOT NULL DEFAULT 1,
  refill_at REAL,
  start_date TEXT,
  end_date TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  about TEXT NOT NULL DEFAULT '',        -- what it's for, in plain words
  unit TEXT NOT NULL DEFAULT 'pill',     -- what amounts are counted in (pill, mL, capful, ...)
  ext_id TEXT,                           -- id from an imported CSV, so re-imports update
  generic TEXT NOT NULL DEFAULT '',
  interval_days INTEGER NOT NULL DEFAULT 0, -- 2 = every other day, counted from start_date
  slots TEXT NOT NULL DEFAULT '[]',      -- JSON blister-pack slot for each time, e.g. ["BK","SP"]
  status TEXT NOT NULL DEFAULT 'active', -- active | confirm (check with pharmacist) | hold
  notes TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'regular',  -- regular | clinic (given at the cancer centre, record only)
  prn_min_hours REAL,                    -- as-needed: least hours between doses
  prn_max_day REAL,                      -- as-needed: most doses a day
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS appts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  at TEXT NOT NULL,                      -- local wall time "YYYY-MM-DDTHH:MM"
  location TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  remind TEXT NOT NULL DEFAULT '[1440,120]', -- JSON minutes before
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dose_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  med_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,                    -- scheduled "HH:MM", or "HH:MM:SS" for as-needed
  status TEXT NOT NULL,                  -- taken | skipped
  logged_at TEXT NOT NULL,
  logged_by TEXT NOT NULL DEFAULT '',
  taken_time TEXT,                       -- actual "HH:MM" when logged after the fact
  amount REAL                            -- pills taken, when not the usual pills per dose
);
CREATE UNIQUE INDEX IF NOT EXISTS dose_log_slot ON dose_log(med_id, date, time);

CREATE TABLE IF NOT EXISTS journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  feeling INTEGER,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  meds INTEGER NOT NULL DEFAULT 1,
  appts INTEGER NOT NULL DEFAULT 1,
  missed INTEGER NOT NULL DEFAULT 0,
  pain INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pain (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,                    -- local "HH:MM"
  score INTEGER NOT NULL,                -- 0 (none) to 10 (worst)
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS water (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,                    -- local "HH:MM"
  ml INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',         -- container name, e.g. "Yeti"
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS exercise (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,                    -- local "HH:MM" it started
  minutes INTEGER NOT NULL,
  activity TEXT NOT NULL DEFAULT '',      -- e.g. "Walk"
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS temps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  temp_f REAL NOT NULL,                  -- always stored in °F
  chills INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  symptoms TEXT NOT NULL DEFAULT '{}',     -- JSON, e.g. {"fatigue":2,"bowels":"constipated"}
  areas TEXT NOT NULL DEFAULT '[]',        -- JSON list of where it hurts
  flags TEXT NOT NULL DEFAULT '[]',        -- JSON list of warning signs
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                    -- local date and time it started
  time TEXT NOT NULL,
  name TEXT NOT NULL,                    -- e.g. "Back spasm"
  severity TEXT NOT NULL DEFAULT 'minor', -- minor | major
  area TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,              -- exact UTC times, for the timer
  ended_at TEXT,                         -- NULL while it's still going
  created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',          -- e.g. "Hematologist", "Nurse navigator"
  org TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  phone2 TEXT NOT NULL DEFAULT '',        -- after hours / on call
  email TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  urgent INTEGER NOT NULL DEFAULT 0      -- 1 = call for fevers and warning signs
);

CREATE TABLE IF NOT EXISTS bowel (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  type INTEGER,                          -- stool scale 1 (hard lumps) to 7 (watery)
  amount TEXT NOT NULL DEFAULT '',        -- small | medium | large
  strain INTEGER NOT NULL DEFAULT 0,
  blood INTEGER NOT NULL DEFAULT 0,
  black INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT ''
);

-- One row per reminder already sent, so a reminder never goes out twice.
CREATE TABLE IF NOT EXISTS sent_log (
  key TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
