-- release 40 (additive): OWNER_router_31, connecting from the service (27.9). On the connection: the brand it was connected to, and
-- its single-use code (hash only) and when the code expires (ten minutes). Nothing of the person.
ALTER TABLE connections ADD COLUMN brand_principal_id TEXT;
ALTER TABLE connections ADD COLUMN connect_code_hash TEXT;
ALTER TABLE connections ADD COLUMN connect_code_until INTEGER;
