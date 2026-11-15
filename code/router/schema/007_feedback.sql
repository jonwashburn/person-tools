-- release 7 (additive): what a tester tells us to change (policy/DATA.md row "Tester feedback"; RETENTION_JOBS row 14):
-- the text, the member, the time; 90 days or until the member leaves (the one-tap leave deletes it).
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_member ON feedback(member_id);
INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', '7');
