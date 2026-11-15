-- release 4 (additive): a member's private settings (RING_RULES rule 2: 'screen reader' or 'longer to answer' holds an offer
-- for 3 minutes; never shown to an asker, never used in ranking).
ALTER TABLE members ADD COLUMN slow_hold INTEGER NOT NULL DEFAULT 0;
INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', '4');
