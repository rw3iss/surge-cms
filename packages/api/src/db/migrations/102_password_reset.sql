-- Password reset tokens.
--
-- NOT feature-gated: `users` is base schema and the auth flow references these
-- columns unconditionally, exactly like the email-verification columns in 077.
--
-- Stored as a HASH, not the token itself. A reset token is a bearer credential
-- that grants account takeover for its lifetime, so the database must not hold
-- anything an attacker with read access could replay. The plaintext exists only
-- in the email we send.
--
-- `reset_token_expires_at` is separate from the hash so expiry can be checked in
-- SQL and a sweep can clear stale rows without parsing anything.
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_expires_at TIMESTAMPTZ;

-- Partial index: only rows mid-reset are ever looked up this way, and that is a
-- vanishingly small slice of the user table.
CREATE INDEX IF NOT EXISTS idx_users_reset_token_hash
    ON users (reset_token_hash) WHERE reset_token_hash IS NOT NULL;
