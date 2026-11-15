-- release 7 (additive): top-ups against the stand-in processor (B6). Money records: kept 7 years with the ledger
-- (policy/DATA.md rows "Top-ups" and "Processor events"). No card data; an event's body is not stored.
CREATE TABLE IF NOT EXISTS topups (
  id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  payment_intent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS topups_pi ON topups(payment_intent);
CREATE TABLE IF NOT EXISTS processor_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  outcome TEXT
);
INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', '7');
