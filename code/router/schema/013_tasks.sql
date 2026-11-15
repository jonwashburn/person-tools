-- release 13 (additive): TASKS (the CEO, owner/OWNER_all_7.md, 8:29 AM CT 15 Nov 2026): our programs (and any key) ask ONE named
-- person on that key's own panel to do one exact thing or answer one question; the person sees one list and replies.
-- members.person_name: the name the operator gives a member so a task reaches one person (the operator's own memberships too).
-- join_links: several live links per panel, each for one named person, single-use if asked (owner 8:33 AM CT).
ALTER TABLE members ADD COLUMN person_name TEXT;
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,                 -- tk_...
  principal_id TEXT NOT NULL,
  key_id TEXT,
  panel_id TEXT NOT NULL,
  to_name TEXT NOT NULL,               -- the person's name on the panel, or 'mb:<member id>' on a panel of one unnamed member
  title TEXT NOT NULL,
  step_json TEXT NOT NULL,             -- {type: command|link|question, ...}
  unlocks TEXT,
  program TEXT,
  session TEXT,
  urgency TEXT NOT NULL,               -- now | today | whenever
  state TEXT NOT NULL DEFAULT 'open',  -- open | done | answered | not_now
  reply_json TEXT,
  created_at INTEGER NOT NULL,
  answered_at INTEGER,
  rang_at INTEGER,
  idem TEXT
);
CREATE INDEX IF NOT EXISTS tasks_for ON tasks(panel_id, to_name, state);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_idem ON tasks(key_id, idem);
CREATE TABLE IF NOT EXISTS join_links (
  code_hash TEXT PRIMARY KEY,
  panel_id TEXT NOT NULL,
  label TEXT,                          -- the person it is for
  max_joins INTEGER,                   -- NULL: no limit but the panel's own
  joins INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS join_links_panel ON join_links(panel_id);
