-- release 22 (additive): ACCOUNTS BY PASSKEY (owner/OWNER_router_10 A, 12:54 PM CT 15 Nov 2026). A person and their memberships; their
-- passkeys (the public key only, as the authenticator gave it); one-use challenges (five minutes); sessions (a hash of the session
-- credential, 30 days).
CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  handle TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS person_members (
  member_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  added_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS person_members_person ON person_members(person_id);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  alg INTEGER NOT NULL,
  jwk TEXT NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  backed_up INTEGER,
  transports TEXT,
  name TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_person ON passkeys(person_id);
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  challenge TEXT NOT NULL,
  person_id TEXT,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  passkey_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at INTEGER
);
