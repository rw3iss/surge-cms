-- Additional roles + account invites.
--
-- users.role stays the PRIMARY role — the one memberships control (Free →
-- member, a paid tier → its role). users.extra_roles holds roles an admin
-- ASSIGNS (e.g. `ambassador`); a membership change never touches them, so a
-- paying subscriber can also be an ambassador. Permissions combine both.
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_roles TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_users_extra_roles ON users USING GIN (extra_roles);

INSERT INTO roles (key, label, description, base_role, is_system, sort_order) VALUES
    ('ambassador', 'Ambassador', 'A brand ambassador: everything a member has, plus what is granted to ambassadors. Assigned by an admin or by an invite.', 'member', false, 15)
ON CONFLICT (key) DO NOTHING;

-- Invite someone to create an account that gets roles on sign-up. The link
-- carries a random token; only its SHA-256 is stored. Expires (3 days).
CREATE TABLE IF NOT EXISTS user_invites (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email        TEXT NOT NULL,
    name         TEXT,
    roles        TEXT[] NOT NULL DEFAULT '{}',
    token_hash   TEXT NOT NULL UNIQUE,
    expires_at   TIMESTAMPTZ NOT NULL,
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    accepted_at  TIMESTAMPTZ,
    accepted_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_invites_email ON user_invites (lower(email));
