-- askpeople-db, release 1 (round 0). Router owns these tables. Times are milliseconds since 1970 (UTC).
-- Money is integer cents. Each table that can hold a person's data has its retention row in policy/DATA.md.

CREATE TABLE IF NOT EXISTS principals (
  id TEXT PRIMARY KEY,                 -- pr_...
  class TEXT NOT NULL CHECK (class IN ('test','real')),
  name TEXT NOT NULL,                  -- who answers for calls, shown on the ring card
  team INTEGER NOT NULL DEFAULT 0,     -- 1: the team's own principal (may use panel:team-test)
  created_ip_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS keys (
  id TEXT PRIMARY KEY,                 -- k_...
  principal_id TEXT NOT NULL REFERENCES principals(id),
  key_hash TEXT NOT NULL UNIQUE,       -- sha256 of the whole key; the key itself is never stored
  class TEXT NOT NULL CHECK (class IN ('test','real')),
  label TEXT NOT NULL DEFAULT '',      -- for real_ keys: the name listed in owner/KEYS_REAL.md
  cap_call_cents INTEGER NOT NULL DEFAULT 5000,
  cap_day_cents INTEGER NOT NULL DEFAULT 20000,
  team INTEGER NOT NULL DEFAULT 0,
  suspended_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS panels (
  id TEXT PRIMARY KEY,                 -- p_...
  principal_id TEXT NOT NULL REFERENCES principals(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'private' CHECK (kind IN ('private','team-test','attack')),
  join_code_hash TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (principal_id, name)
);

CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,                 -- mb_...
  panel_id TEXT NOT NULL REFERENCES panels(id),
  token_hash TEXT NOT NULL UNIQUE,     -- sha256 of the member's own link token
  alias TEXT NOT NULL DEFAULT '',
  is_real INTEGER NOT NULL DEFAULT 0,  -- 0: one of the team's headless browsers
  tz TEXT NOT NULL DEFAULT 'America/Chicago',
  quiet_start INTEGER NOT NULL DEFAULT 21,  -- hour, local
  quiet_end INTEGER NOT NULL DEFAULT 8,
  on_state TEXT NOT NULL DEFAULT 'on' CHECK (on_state IN ('on','off','on_until')),
  on_until INTEGER,
  missed_rings INTEGER NOT NULL DEFAULT 0,
  last_ring_at INTEGER,
  adult_at INTEGER,
  push_json TEXT,
  created_at INTEGER NOT NULL,
  left_at INTEGER
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,                 -- m_...
  principal_id TEXT,                   -- NULL: a shared sample anyone may use
  kind TEXT NOT NULL,                  -- audio | video | image | page | build
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  seconds REAL,
  sha256 TEXT,
  source TEXT,
  sample INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,                 -- call_...
  principal_id TEXT NOT NULL REFERENCES principals(id),
  key_id TEXT NOT NULL REFERENCES keys(id),
  status TEXT NOT NULL CHECK (status IN ('open','held','complete','cancelled','expired','refused')),
  pool TEXT NOT NULL,                  -- simulated | panel:<id>
  panel_id TEXT,
  simulated INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ask TEXT NOT NULL,
  spec_json TEXT NOT NULL,             -- the normalized call, defaults filled in
  defaults_json TEXT NOT NULL,
  quote_json TEXT NOT NULL,
  people INTEGER NOT NULL,
  enough INTEGER NOT NULL,
  pay_cents INTEGER NOT NULL,          -- per person
  est_minutes INTEGER NOT NULL,
  max_total_cents INTEGER NOT NULL,
  hold_cents INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  screening_json TEXT,
  what_changed TEXT,
  what_changed_at INTEGER,
  reported_at INTEGER,
  created_at INTEGER NOT NULL,
  closed_at INTEGER,
  cancelled_at INTEGER
);
CREATE INDEX IF NOT EXISTS calls_open_deadline ON calls(status, deadline_at);
CREATE INDEX IF NOT EXISTS calls_principal ON calls(principal_id, created_at);

CREATE TABLE IF NOT EXISTS seats (
  id TEXT PRIMARY KEY,                 -- s_...
  call_id TEXT NOT NULL REFERENCES calls(id),
  n INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('waiting','offered','taken','answered','stopped','expired','released')),
  member_id TEXT,                      -- NULL for a simulated person
  offered_to TEXT,                     -- member holding the offer
  offer_expires_at INTEGER,
  taken_at INTEGER,
  ended_at INTEGER,
  stop_reason TEXT,
  sim_json TEXT,                       -- the simulated person's script for this seat
  due_at INTEGER,                      -- when this seat next needs settling
  pay_cents INTEGER,
  fee_cents INTEGER,
  evidence TEXT,
  UNIQUE (call_id, n)
);
CREATE INDEX IF NOT EXISTS seats_due ON seats(due_at);
CREATE INDEX IF NOT EXISTS seats_offered ON seats(offered_to, state);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seat_id TEXT NOT NULL REFERENCES seats(id),
  received_at INTEGER NOT NULL,        -- the router's own clock
  body_json TEXT NOT NULL              -- the runner's batch as sent
);
CREATE INDEX IF NOT EXISTS events_seat ON events(seat_id, id);

CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,                 -- r_...
  call_id TEXT NOT NULL REFERENCES calls(id),
  seat_id TEXT NOT NULL UNIQUE REFERENCES seats(id),
  seq INTEGER NOT NULL,                -- order of arrival within the call (the cursor)
  simulated INTEGER NOT NULL,
  person_ref TEXT NOT NULL,            -- an id that differs for every principal
  answers_json TEXT NOT NULL,
  input_json TEXT NOT NULL,
  record_json TEXT NOT NULL,
  evidence TEXT NOT NULL CHECK (evidence IN ('said','attended','voiced')),
  partial INTEGER NOT NULL DEFAULT 0,
  not_counted TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (call_id, seq)
);

CREATE TABLE IF NOT EXISTS balances (
  account TEXT PRIMARY KEY,
  cents INTEGER NOT NULL,
  floor0 INTEGER NOT NULL DEFAULT 1,   -- 1: may never go below zero (the money guard is this constraint)
  CHECK (floor0 = 0 OR cents >= 0)
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  txn TEXT NOT NULL,                   -- deterministic per event, e.g. hold:<call>, pay:<seat>
  line INTEGER NOT NULL,
  account TEXT NOT NULL,
  cents INTEGER NOT NULL,
  call_id TEXT,
  memo TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  UNIQUE (txn, line)                   -- a second attempt at the same money event fails the whole batch
);
CREATE INDEX IF NOT EXISTS ledger_call ON ledger(call_id);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,                 -- rc_...
  call_id TEXT NOT NULL REFERENCES calls(id),
  seat_id TEXT NOT NULL UNIQUE REFERENCES seats(id),
  member_id TEXT,
  body_json TEXT NOT NULL,             -- the canonical receipt that was signed
  signature TEXT NOT NULL,
  key_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  key_id TEXT NOT NULL,
  op TEXT NOT NULL,
  idem_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (key_id, op, idem_key)
);

CREATE TABLE IF NOT EXISTS held_calls (
  call_id TEXT PRIMARY KEY REFERENCES calls(id),
  reason TEXT NOT NULL,
  rule TEXT,
  created_at INTEGER NOT NULL,
  released_at INTEGER,
  decided TEXT
);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
INSERT OR IGNORE INTO meta(k, v) VALUES ('schema', '1');
