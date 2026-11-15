-- release 6 (additive): over-cap approvals (A3). No person's data, no asker words: the key, a hash of the call, the
-- approved total and the quote's lines. Kept 30 days (policy/DATA.md row "Approvals").
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  call_hash TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  quote_json TEXT,
  created_at INTEGER NOT NULL,
  approved_at INTEGER,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS approvals_key_call ON approvals(key_id, call_hash);
INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', '6');
