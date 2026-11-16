-- release 33 (additive): TRUST's 6:47 PM CT findings on asks between people (OWNER_router_18). task_passes.shows_at: when a passed ask
-- shows on the receiver's list (a pass counts against the receiver's daily limit like a send, and waits the same way). tasks.passed_from:
-- the name a passed ask is shown "from" (an AI's typed name that fails the asker-name check shows as one of the passer's AIs).
ALTER TABLE task_passes ADD COLUMN shows_at INTEGER;
ALTER TABLE tasks ADD COLUMN passed_from TEXT;
