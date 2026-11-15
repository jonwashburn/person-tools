-- release 26 (additive): BLOCK THE CALLER (owner/OWNER_router_4 item 1; SPEC 4.5.2). One row per membership the person's block
-- covers and principal blocked, with the principal's display name as the person saw it; kept until the person removes it.
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  name TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (member_id, principal_id)
);
CREATE INDEX IF NOT EXISTS blocks_principal ON blocks(principal_id);
