-- Email verification for self-registered members.
--
-- NOT feature-gated: the `users` table is base schema and the auth
-- login/register queries always reference these columns, so they must
-- exist on every install regardless of the `users` feature flag.
--
-- DEFAULT true grandfathers every existing user (and every non-self-signup
-- path — seed admin, admin-created accounts, Patreon OAuth) into "verified"
-- automatically. Only the public self-registration flow explicitly writes
-- email_verified = false (and a token) when the operator has verification
-- enabled, so nobody is ever unexpectedly locked out by this migration.

ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_verification_token
    ON users (verification_token) WHERE verification_token IS NOT NULL;
