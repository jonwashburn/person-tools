-- release 27 (additive): an ask nobody answers lapses (owner/OWNER_router_13.md, 3:07 PM CT 15 Nov 2026): at 30 days an open task becomes
-- "lapsed" (never a default answer), its webhook fires with that state, and the row stays 30 more days for the asker to read.
ALTER TABLE tasks ADD COLUMN lapsed_at INTEGER;
