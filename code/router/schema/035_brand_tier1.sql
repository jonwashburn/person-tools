-- release 35 (additive): OWNER_router_26 tier 1. A brand's own id (br_..., served with the brand) and when its domain was last
-- checked (POST /v1/brand/verify is at most once a minute). Neither holds anything of a person.
ALTER TABLE brands ADD COLUMN brand_id TEXT;
ALTER TABLE brands ADD COLUMN verify_tried_at INTEGER;
