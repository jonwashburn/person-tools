-- release 2 (additive): the outcome lines of a call (spec 15.2), and the principal and key that stand for calls made
-- without a key (AUTH-5; the foreign keys need a row).
ALTER TABLE calls ADD COLUMN outcomes_json TEXT;
INSERT OR IGNORE INTO principals (id, class, name, team, created_at) VALUES ('pr_anonymous', 'test', 'an unnamed test caller', 0, 0);
INSERT OR IGNORE INTO keys (id, principal_id, key_hash, class, label, cap_call_cents, cap_day_cents, team, created_at)
  VALUES ('k_anonymous', 'pr_anonymous', 'none: calls made without a key', 'test', 'no key', 0, 0, 0, 0);
INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', '2');
