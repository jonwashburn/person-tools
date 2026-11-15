-- release 18 (additive): CONNECT AN AI (owner/OWNER_all_10.md part B, 11:49 AM CT 15 Nov 2026). A person connects one of their
-- own AIs; the connection is its own principal under that person and its key (conn_...) only places asks for that person.
-- connections.member_id / panel_id / person_name: where it was made; its asks reach that person (every membership of theirs
-- with the same name on that panel, or that one membership). lab: made by the operator for a lab program (the operator's
-- standing checks apply). quiet: its asks never ring. blocked: its asks are refused ("not available"). revoked_at: one tap.
CREATE TABLE IF NOT EXISTS connections (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  panel_id TEXT NOT NULL,
  person_name TEXT,
  principal_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  lab INTEGER NOT NULL DEFAULT 0,
  quiet INTEGER NOT NULL DEFAULT 0,
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS connections_member ON connections(member_id);
CREATE INDEX IF NOT EXISTS connections_key ON connections(key_id);
ALTER TABLE tasks ADD COLUMN connection_id TEXT;
