-- release 16 (additive): who owns a principal, for counting only (owner/OWNER_router_5.md; the CEO, 11:21 AM CT 15 Nov 2026:
-- "ours" is a property the count reads from the key's owner, not a list someone has to remember to extend).
-- principals.owner: 'team' (made by the admin route, or by a request carrying the team's check header), 'outside' (anyone
-- else), 'visitor' (a front-page demo key: a person trying the page), 'keyless' (the principal of keyless calls).
-- /v1/proof reads only this. Permissions keep reading the key (class, team), never this column (TRUST 11:26 AM CT).
-- owner_note: why the operator set it by hand (POST /internal/principals/{id}/owner).
-- stranger_requests.owner: the same, for a request made without a key.
ALTER TABLE principals ADD COLUMN owner TEXT;
ALTER TABLE principals ADD COLUMN owner_note TEXT;
ALTER TABLE stranger_requests ADD COLUMN owner TEXT;
-- The rows made before today's change: everything our own checks made from this server's address was ours (TRUST 11:27 AM CT).
UPDATE principals SET owner = CASE
  WHEN id = 'pr_anonymous' THEN 'keyless'
  WHEN name = 'a visitor trying the front page' THEN 'visitor'
  WHEN team = 1 OR class = 'real' OR created_ip_hash IS NULL OR name LIKE 'Team check principal %' THEN 'team'
  WHEN created_ip_hash IN (SELECT substr(k, 9) FROM meta WHERE k LIKE 'team_ip:%') THEN 'team'
  ELSE 'outside' END
WHERE owner IS NULL;
UPDATE stranger_requests SET owner = CASE
  WHEN principal_id IS NOT NULL THEN COALESCE((SELECT p.owner FROM principals p WHERE p.id = stranger_requests.principal_id), 'outside')
  WHEN substr(asker, 6) IN (SELECT substr(k, 9) FROM meta WHERE k LIKE 'team_ip:%') THEN 'team'
  ELSE 'outside' END
WHERE owner IS NULL;
-- OWNER_router_5 item 2, for the rows made before it: a member on a team check principal's panel (not the operator's own) is
-- one of our tools, never a person. None of them ever answered a call.
UPDATE members SET is_real = 0 WHERE is_real = 1 AND panel_id IN (SELECT pn.id FROM panels pn JOIN principals pp ON pp.id = pn.principal_id WHERE pp.owner = 'team' AND pp.class != 'real');
-- Keyless calls our own checks made from our address before they sent the header: marked as the header marks them.
UPDATE OR IGNORE idempotency SET key_id = 'anon:team:' || substr(key_id, 6)
WHERE op = 'call' AND key_id LIKE 'anon:%' AND key_id NOT LIKE 'anon:team:%' AND substr(key_id, 6) IN (SELECT substr(k, 9) FROM meta WHERE k LIKE 'team_ip:%');
