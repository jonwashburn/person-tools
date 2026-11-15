-- release 5 (additive): outside pools through adapters (N2, N3; code/router/ADAPTERS.md). A call on an adapter pool keeps the
-- pool's job reference; a seat keeps the pool's own id for its person (never shown to an asker); the panel row below holds
-- the router's member rows for a pool's people (each person's own seat link needs one), and is never offered to anyone.
ALTER TABLE calls ADD COLUMN pool_ref TEXT;
ALTER TABLE calls ADD COLUMN pool_polled_at INTEGER;
ALTER TABLE seats ADD COLUMN pool_pid TEXT;
INSERT OR IGNORE INTO panels (id, principal_id, name, kind, created_at) VALUES ('p_pool_prolific', 'pr_anonymous', 'pool: prolific', 'team-test', 0);
INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', '5');
