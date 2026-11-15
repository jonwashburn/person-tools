-- release 9 (additive): a principal's own account with an outside pool (N2's second mode; policy/DATA.md row 'pool_accounts').
-- The principal's pool token is sealed at rest (AES-GCM, key POOL_TOKEN_KEY, the row's principal and pool bound in); only its
-- last four characters are kept in the clear, to show which token is connected. Deleted at once when the principal disconnects.
CREATE TABLE IF NOT EXISTS pool_accounts (
  principal_id TEXT NOT NULL,
  pool TEXT NOT NULL,
  token_sealed TEXT NOT NULL,
  token_hint TEXT NOT NULL,
  recorded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (principal_id, pool)
);
INSERT OR REPLACE INTO meta(k, v) VALUES ('schema', '9');
