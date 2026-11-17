-- release 41 (additive): OWNER_router_37 (spec 26.13, MEMBER-24), test members for a conformance run. On a member a test key made:
-- which key made it (at most five live per key) and when it goes (the timer removes it then; its row goes a day later). Nothing of a person.
ALTER TABLE members ADD COLUMN test_key_id TEXT;
ALTER TABLE members ADD COLUMN test_until INTEGER;
CREATE INDEX IF NOT EXISTS members_test_key ON members(test_key_id) WHERE test_key_id IS NOT NULL;
