-- release 17 (additive): a person may have no sounds from us (owner/OWNER_router_6.md, 11:44 AM CT 15 Nov 2026).
-- members.sounds: 1 by default; 0 means no Apple alert carries a sound and the web ring is silent. It is the person's setting: a
-- change applies to every membership with the same person_name on the same principal's panels, and a later membership named the
-- same takes the quietest choice already made.
ALTER TABLE members ADD COLUMN sounds INTEGER NOT NULL DEFAULT 1;
