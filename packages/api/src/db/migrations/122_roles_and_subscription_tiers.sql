-- Roles become data, and subscription plans become TIERS that assign one.
--
-- roles: the built-ins (locked, `is_system`) plus operator-defined roles. A
--   custom role has a BASE role it inherits permissions from (`subscriber`
--   → `member`). Custom roles may only build on member-level roles — the route
--   auth tiers (staff/admin) compare built-in names, so a custom role is
--   always treated as a member by them, whatever its permissions.
-- users.role: enum → text with a FK to roles, so a custom role is assignable
--   and a role in use cannot be deleted out from under its users.
-- subscription_plans: slug, the role a subscriber is given, the Stripe
--   product, and `is_free` for the implicit tier of everyone without a paid
--   subscription. Seeds `free` (member) and `subscriber` (subscriber).
-- permission_grants: a third subject type, `plan` — extra permissions a tier
--   grants on top of its role.

CREATE TABLE IF NOT EXISTS roles (
    key         VARCHAR(32) PRIMARY KEY,
    label       VARCHAR(80) NOT NULL,
    description TEXT,
    base_role   VARCHAR(32) REFERENCES roles(key) ON DELETE SET NULL,
    is_system   BOOLEAN NOT NULL DEFAULT false,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT roles_key_chk CHECK (key ~ '^[a-z][a-z0-9_]{1,31}$'),
    CONSTRAINT roles_not_own_base CHECK (base_role IS NULL OR base_role <> key)
);

INSERT INTO roles (key, label, description, is_system, sort_order) VALUES
    ('anonymous', 'Anonymous', 'Not signed in.', true, 0),
    ('member', 'Member', 'A signed-in user.', true, 10),
    ('editor', 'Editor', 'Content-editing staff.', true, 80),
    ('admin', 'Admin', 'Site administrator.', true, 90),
    ('sysadmin', 'Sysadmin', 'Full access; never locked out.', true, 100)
ON CONFLICT (key) DO NOTHING;

INSERT INTO roles (key, label, description, base_role, is_system, sort_order) VALUES
    ('subscriber', 'Subscriber', 'A member with a paid subscription. Everything a member has, plus what its subscription grants.', 'member', false, 20)
ON CONFLICT (key) DO NOTHING;

-- users.role: enum → text + FK. Idempotent (re-running is a no-op).
ALTER TABLE users ALTER COLUMN role DROP DEFAULT;
ALTER TABLE users ALTER COLUMN role TYPE VARCHAR(32) USING role::text;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'member';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_fk') THEN
        ALTER TABLE users ADD CONSTRAINT users_role_fk
            FOREIGN KEY (role) REFERENCES roles(key) ON UPDATE CASCADE;
    END IF;
END $$;

-- Subscription tiers.
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS slug VARCHAR(64);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS role VARCHAR(32) REFERENCES roles(key) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS stripe_product_id VARCHAR(255);
ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT false;
UPDATE subscription_plans
   SET slug = trim(both '-' from regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g')) || '-' || left(id::text, 4)
 WHERE slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_slug_key ON subscription_plans (slug);
-- At most one free tier.
CREATE UNIQUE INDEX IF NOT EXISTS subscription_plans_one_free ON subscription_plans (is_free) WHERE is_free;

INSERT INTO subscription_plans (slug, name, description, price_cents, interval, role, is_free, is_active, sort_order)
VALUES
    ('free', 'Free', 'Everyone with an account and no paid subscription.', 0, 'month', 'member', true, true, 0),
    ('subscriber', 'Subscriber', 'The paid subscription.', 0, 'month', 'subscriber', false, true, 10)
ON CONFLICT (slug) DO NOTHING;

-- Plan-level permission grants.
ALTER TABLE permission_grants DROP CONSTRAINT IF EXISTS permission_grants_subject_type_chk;
ALTER TABLE permission_grants ADD CONSTRAINT permission_grants_subject_type_chk
    CHECK (subject_type IN ('role', 'user', 'plan'));
