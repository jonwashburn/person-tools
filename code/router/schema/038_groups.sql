-- release 38 (additive): OWNER_router_31 item 1, groups (27.8): several asks of one service about one thing, each answered alone.
ALTER TABLE tasks ADD COLUMN group_name TEXT;
CREATE INDEX IF NOT EXISTS tasks_group ON tasks(key_id, group_name) WHERE group_name IS NOT NULL;
