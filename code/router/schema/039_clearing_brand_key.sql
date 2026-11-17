-- release 39 (additive): OWNER_router_31 tier 3. An ask withdrawn because it was settled in the service's own app (27.2), and a
-- brand's one key for many connections, kept only as its hash (27.4, ASKS-9).
ALTER TABLE tasks ADD COLUMN elsewhere INTEGER;
ALTER TABLE brands ADD COLUMN brand_key_hash TEXT;
ALTER TABLE brands ADD COLUMN brand_key_at INTEGER;
ALTER TABLE tasks ADD COLUMN brand_principal_id TEXT;
