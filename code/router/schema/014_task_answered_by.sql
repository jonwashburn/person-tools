-- release 14 (additive): who answered a task (the member id), so /v1/proof counts a task only when a real person answered it
-- (the CEO, OWNER_all_8 item 1: a headless test member is not a real person, whichever key placed the task).
ALTER TABLE tasks ADD COLUMN answered_by TEXT;
