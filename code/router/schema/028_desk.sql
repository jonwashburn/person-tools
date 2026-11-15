-- release 28 (additive): SIGN IN TO THE DESK WITH THE PHONE (owner/OWNER_router_14; TRUST 3:50 PM CT 15 Nov 2026). A sign-in code (hashes only:
-- the code in the QR and the Desk's poll secret are never stored), its two-digit number, where the computer was (city, browser, system),
-- and its one approval; and the Desk's sessions (a hash of ds_..., the membership it acts for, where, made, last used, revoked).
CREATE TABLE IF NOT EXISTS desk_codes (
  code_hash TEXT PRIMARY KEY,
  poll_hash TEXT NOT NULL UNIQUE,
  number INTEGER NOT NULL,
  ip_hash TEXT,
  where_text TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  approved_member_id TEXT,
  approved_at INTEGER,
  session_issued_at INTEGER,
  killed_at INTEGER
);
CREATE INDEX IF NOT EXISTS desk_codes_ip ON desk_codes(ip_hash, created_at);
CREATE TABLE IF NOT EXISTS desk_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  member_id TEXT NOT NULL,
  where_text TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS desk_sessions_member ON desk_sessions(member_id);
