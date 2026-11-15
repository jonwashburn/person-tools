-- release 24 (additive): THE SIGNED ANSWER (owner/OWNER_router_4 item 2; SPEC 4.5.3). A member's device key (the public key only, as an
-- uncompressed P-256 point; whether Apple's App Attest vouched for it, and if not, why), and on each response when the device signed it
-- and whether that makes it device_approved.
CREATE TABLE IF NOT EXISTS device_keys (
  member_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  attested INTEGER NOT NULL DEFAULT 0,
  environment TEXT,
  why_not TEXT,
  created_at INTEGER NOT NULL
);
ALTER TABLE responses ADD COLUMN device_signed_at INTEGER;
ALTER TABLE responses ADD COLUMN device_approved INTEGER;
