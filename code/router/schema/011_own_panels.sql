-- release 11 (additive): bring your own people (the CEO, OWNER_all_6, 15 Nov 2026; policy/OWN_PANELS.md) and the in-band ask
-- for strangers (policy/DATA.md row `stranger_requests`).
-- panels.asker_name: the name a principal gives itself for its own panel (rule 12), shown with "(named by the asker; not
--   checked by person.tools)"; paused_at: set when two reports about the principal's calls fall within 30 days (rule 9).
-- calls.asker_name: that name, copied onto each call to the panel, for its ring card and receipts.
ALTER TABLE panels ADD COLUMN asker_name TEXT;
ALTER TABLE panels ADD COLUMN paused_at INTEGER;
ALTER TABLE calls ADD COLUMN asker_name TEXT;
-- who asked for real strangers, for what, and the contact for the agent's user; seen by the owner only; 90 days
CREATE TABLE IF NOT EXISTS stranger_requests (
  id TEXT PRIMARY KEY,
  asker TEXT NOT NULL,          -- the principal id, or 'anon:' and the salted address hash for no key
  principal_id TEXT,
  key_id TEXT,
  ref_id TEXT,                  -- the call or quote it came with (id only)
  purpose TEXT NOT NULL,        -- at most 300 characters, anything shaped like a key removed
  contact TEXT,                 -- at most 200 characters: one email, phone or address
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS stranger_requests_created ON stranger_requests(created_at);
