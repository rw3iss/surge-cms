-- Granular permissions layered on top of the role ladder.
--
-- Two tables on purpose:
--   permissions       the CATALOG + each permission's default rule
--   permission_grants only the EXCEPTIONS to that default
--
-- The default lives on the permission itself so the common case ("all staff may
-- do this") costs zero grant rows. Without that, a site would need one row per
-- user per permission just to express "everyone can".

CREATE TABLE IF NOT EXISTS permissions (
    key             VARCHAR(120) PRIMARY KEY,
    feature         VARCHAR(64)  NOT NULL DEFAULT 'core',
    label           VARCHAR(160) NOT NULL,
    description     TEXT,
    action          VARCHAR(40),
    -- everyone | roles | nobody
    default_access  VARCHAR(16)  NOT NULL DEFAULT 'roles',
    default_roles   TEXT[]       NOT NULL DEFAULT '{}',
    -- Registered by code. Hand-made permissions are editable/deletable;
    -- system ones would just be re-registered on the next boot.
    is_system       BOOLEAN      NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT permissions_default_access_chk
        CHECK (default_access IN ('everyone', 'roles', 'nobody'))
);

CREATE INDEX IF NOT EXISTS idx_permissions_feature ON permissions (feature);

CREATE TABLE IF NOT EXISTS permission_grants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    permission_key  VARCHAR(120) NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
    subject_type    VARCHAR(8)   NOT NULL,
    -- A role name or a user id. Not an FK: it holds two different kinds of
    -- identifier, and a role has no table of its own.
    subject_id      VARCHAR(64)  NOT NULL,
    -- false = an explicit DENY. Revoking one person's access to something their
    -- role allows is a real requirement, so "row exists" cannot mean "allowed".
    granted         BOOLEAN      NOT NULL DEFAULT true,
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT permission_grants_subject_type_chk
        CHECK (subject_type IN ('role', 'user')),
    -- One rule per (permission, subject): a second row would make the answer
    -- depend on row order.
    CONSTRAINT permission_grants_unique UNIQUE (permission_key, subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_permission_grants_subject
    ON permission_grants (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_permission_grants_key ON permission_grants (permission_key);
