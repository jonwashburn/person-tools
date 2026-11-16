-- release 29 (additive): an ask that expires in minutes (owner/OWNER_router_15.md, 3:58 PM CT 15 Nov 2026). tasks.expires_at: when an
-- unanswered ask lapses (the asker's expires_in, 60 seconds to 30 days; 30 days when not given).
ALTER TABLE tasks ADD COLUMN expires_at INTEGER;
