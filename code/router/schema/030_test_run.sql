-- release 30 (additive): a cold test marks its own keys (owner/OWNER_router_16, ADDED 5:29 PM CT 15 Nov 2026; the CEO's ruling of 5:25 PM CT).
-- principals.test_run: the label a harness or probe sent with POST /v1/keys {"test_run": "<label>"}; /v1/proof never counts a principal
-- that carries one, as ours or as an outsider. The address rule (meta team_ip:*) stays as the backstop.
ALTER TABLE principals ADD COLUMN test_run TEXT;
