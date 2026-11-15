-- release 6 (additive): quotes kept one day so GET /v1/quotes/{id} can show a quote's lines and total to the human who
-- approves (D35). No ask, no fields, no principal (policy/DATA.md row "Quotes"; RETENTION_JOBS row 13).
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  lines_json TEXT NOT NULL,
  total_cents INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', '6');
