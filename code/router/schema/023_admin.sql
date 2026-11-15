-- release 23 (additive): ADMIN (owner/OWNER_router_10 B, 12:54 PM CT 15 Nov 2026). Who holds operator scope (the owner names them), who
-- holds owner scope over which principal, and one line per admin action (who, how they signed in, what, on which ids; never a secret).
CREATE TABLE IF NOT EXISTS admins (
  person_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('operator')),
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (person_id, scope)
);
CREATE TABLE IF NOT EXISTS principal_admins (
  principal_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (principal_id, person_id)
);
CREATE TABLE IF NOT EXISTS admin_log (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  via TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT
);
CREATE INDEX IF NOT EXISTS admin_log_at ON admin_log(at);
