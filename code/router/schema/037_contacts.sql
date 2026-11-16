-- release 37 (additive): OWNER_router_29 tier 2. Someone else's contact details on an ask (policy/DATA.md 'contacts on an ask', TRUST
-- 2:43 PM CT 16 Nov): name, phone and email held only while the ask is open, then cleared within a minute; id, role, ref, consent stay.
ALTER TABLE tasks ADD COLUMN contacts_json TEXT;
