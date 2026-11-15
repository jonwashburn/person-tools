-- release 25 (additive): CARDS (owner/OWNER_router_9.md, 12:41 PM CT 15 Nov 2026; SPEC_v0 8.1 "Cards"). A brand per principal (a
-- connection is one): {name, mark, colours, grounds} as checked JSON. A card per ask: {blocks: [...]} from the fixed set, as checked JSON.
CREATE TABLE IF NOT EXISTS brands (
  principal_id TEXT PRIMARY KEY,
  brand_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  domain TEXT,
  domain_token TEXT,
  verified_at INTEGER,
  verified_how TEXT
);
ALTER TABLE tasks ADD COLUMN card_json TEXT;
