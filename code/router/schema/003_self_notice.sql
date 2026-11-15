-- release 3 (additive): the panel that holds a visitor's own seat on pool "self" (D29), and what a member agreed to on
-- joining (trust: policy/DATA.md members row: which notice, when, and the US-residence statement).
INSERT OR IGNORE INTO panels (id, principal_id, name, kind, created_at) VALUES ('p_self', 'pr_anonymous', 'self', 'team-test', 0);
ALTER TABLE members ADD COLUMN notice_id TEXT;
ALTER TABLE members ADD COLUMN notice_at INTEGER;
ALTER TABLE members ADD COLUMN us_resident_at INTEGER;
INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', '3');
-- what an outsider tells us about a security hole (ops/SECURITY.md; policy/DATA.md "Security reports": kept 2 years)
CREATE TABLE IF NOT EXISTS security_reports (
  id TEXT PRIMARY KEY,
  what TEXT NOT NULL,
  how_to_reproduce TEXT,
  reply_to TEXT,
  ip_hash TEXT,
  created_at INTEGER NOT NULL
);
