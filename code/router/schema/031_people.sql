-- release 31 (additive): A PERSON SENDS ASKS TO THEIR OWN PEOPLE, and passes an ask on (owner/OWNER_router_18, 5:48 and 5:57 PM CT 15 Nov
-- 2026; the CEO's guards of ~6:00 PM CT). panel_owners: a panel's owner (a checked name; the principal its sends are made under, owner
-- 'person'). owner_members: the memberships that are that owner (their app, their page). mutes: a receiver's "no ring from this sender,
-- still listed". task_passes: each hand-on of an ask (from, to, an optional line). tasks gain who sent it (a member), when a send over
-- the receiver's daily cap shows (hold_until), when the sender last read its answers, who last passed it on (and the name shown), and
-- the ask's first addressee (so the original asker never sees the receiver). member_asks: a receiver's daily cap per sender, and
-- when they were told the panel's owner can send them asks (its own table, so nothing else changes shape).
CREATE TABLE IF NOT EXISTS panel_owners (
  panel_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_members (
  member_id TEXT NOT NULL,
  panel_id TEXT NOT NULL,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (member_id, panel_id)
);
CREATE INDEX IF NOT EXISTS owner_members_panel ON owner_members(panel_id);
CREATE TABLE IF NOT EXISTS mutes (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (member_id, principal_id)
);
CREATE TABLE IF NOT EXISTS task_passes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  from_member_id TEXT NOT NULL,
  to_member_id TEXT NOT NULL,
  from_panel_id TEXT,
  from_to_name TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS task_passes_task ON task_passes(task_id);
CREATE INDEX IF NOT EXISTS task_passes_from ON task_passes(from_member_id);
ALTER TABLE tasks ADD COLUMN sender_member_id TEXT;
ALTER TABLE tasks ADD COLUMN hold_until INTEGER;
ALTER TABLE tasks ADD COLUMN sender_seen_at INTEGER;
ALTER TABLE tasks ADD COLUMN passed_by TEXT;
ALTER TABLE tasks ADD COLUMN passed_by_name TEXT;
ALTER TABLE tasks ADD COLUMN orig_to_name TEXT;
CREATE TABLE IF NOT EXISTS member_asks (
  member_id TEXT PRIMARY KEY,
  asks_cap INTEGER,
  told_at INTEGER
);
