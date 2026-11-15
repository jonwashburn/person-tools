-- release 19 (additive): what a person's own AI sends with an ask, and the answer sent back (owner/OWNER_all_10 part C; TRUST's
-- policy/CONNECTIONS.md and DATA.md rows "connections", "a person's own material", "webhook deliveries").
-- connections.secret_enc: the webhook signing secret, encrypted with the service's key (shown to the person once); secret_at: made.
-- tasks.webhook_url: where the answer to this ask is sent. members.material_days: the person's deletion schedule (7 by default).
-- own_material: one photo or clip, encrypted in storage; task_id is empty for the hour before an ask uses it.
ALTER TABLE connections ADD COLUMN secret_enc TEXT;
ALTER TABLE connections ADD COLUMN secret_at INTEGER;
ALTER TABLE tasks ADD COLUMN webhook_url TEXT;
ALTER TABLE members ADD COLUMN material_days INTEGER NOT NULL DEFAULT 7;
CREATE TABLE IF NOT EXISTS own_material (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  connection_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  seconds REAL,
  created_at INTEGER NOT NULL,
  delete_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS own_material_task ON own_material(task_id);
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  url TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER,
  last_status INTEGER,
  delivered_at INTEGER,
  given_up_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_due ON webhook_deliveries(next_at);
