-- release 15 (additive): OWNER_router_3 (withdraw a task: shown struck through for a day, then gone) and OWNER_router_1 item 4
-- (every refused task recorded for the operator: when, program, session, title with any secret masked, the rule, the message).
ALTER TABLE tasks ADD COLUMN withdrawn_at INTEGER;
ALTER TABLE tasks ADD COLUMN withdraw_why TEXT;
CREATE TABLE IF NOT EXISTS task_refusals (
  id TEXT PRIMARY KEY,
  principal_id TEXT,
  program TEXT,
  session TEXT,
  title TEXT,                          -- key-shaped strings replaced by [removed]; never the matched value
  rule TEXT,                           -- the refusing code (secret_in_task, withheld_material, private_material, invalid_field...)
  field TEXT,
  message TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS task_refusals_created ON task_refusals(created_at);
