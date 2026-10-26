-- Role login routes: where a role lands after sign-in (a path WITHOUT the
-- leading slash; '' = homepage; NULL = inherit from the base role) and the
-- priority that decides among a user's roles (main + additional).
ALTER TABLE roles ADD COLUMN IF NOT EXISTS login_route TEXT;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS login_priority INTEGER NOT NULL DEFAULT 0;

UPDATE roles SET login_route = '', login_priority = 0 WHERE key IN ('anonymous', 'member') AND login_route IS NULL;
UPDATE roles SET login_route = 'admin', login_priority = 100 WHERE key IN ('admin', 'sysadmin') AND login_route IS NULL;
UPDATE roles SET login_route = 'admin', login_priority = 90 WHERE key = 'editor' AND login_route IS NULL;

-- The brand-ambassador role becomes `affiliate` (the Affiliate program's role).
-- Copy → move every reference → drop, so FKs without ON UPDATE CASCADE hold.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM roles WHERE key = 'ambassador') AND NOT EXISTS (SELECT 1 FROM roles WHERE key = 'affiliate') THEN
        INSERT INTO roles (key, label, description, base_role, is_system, sort_order, created_at, updated_at, login_route, login_priority)
        SELECT 'affiliate', 'Affiliate', 'Affiliate program member: shares codes for the shop and earns a commission on sales. Assigned by approval of the Affiliate program, an admin or an invite.',
               base_role, is_system, sort_order, created_at, NOW(), login_route, login_priority
          FROM roles WHERE key = 'ambassador';
        UPDATE roles SET base_role = 'affiliate' WHERE base_role = 'ambassador';
        UPDATE users SET role = 'affiliate' WHERE role = 'ambassador';
        UPDATE users SET extra_roles = array_replace(extra_roles, 'ambassador', 'affiliate') WHERE 'ambassador' = ANY(extra_roles);
        UPDATE subscription_plans SET role = 'affiliate' WHERE role = 'ambassador';
        UPDATE permission_grants SET subject_id = 'affiliate' WHERE subject_type = 'role' AND subject_id = 'ambassador';
        UPDATE user_invites SET roles = array_replace(roles, 'ambassador', 'affiliate') WHERE 'ambassador' = ANY(roles);
        DELETE FROM roles WHERE key = 'ambassador';
    END IF;
END $$;

-- Role lists stored in other tables / JSON settings.
DO $$
BEGIN
    IF to_regclass('public.gallery_items') IS NOT NULL THEN
        UPDATE gallery_items SET access_roles = array_replace(access_roles, 'ambassador', 'affiliate') WHERE 'ambassador' = ANY(access_roles);
    END IF;
    IF to_regclass('public.gallery_collections') IS NOT NULL THEN
        UPDATE gallery_collections SET access_roles = array_replace(access_roles, 'ambassador', 'affiliate') WHERE 'ambassador' = ANY(access_roles);
    END IF;
    IF to_regclass('public.plugins') IS NOT NULL THEN
        UPDATE plugins SET config = replace(config::text, '"ambassador"', '"affiliate"')::jsonb WHERE config::text LIKE '%"ambassador"%';
    END IF;
END $$;
UPDATE site_settings SET value = replace(value::text, '"ambassador"', '"affiliate"')::jsonb WHERE value::text LIKE '%"ambassador"%';

-- Program roles land in their own area.
UPDATE roles SET login_route = 'admin', login_priority = 50 WHERE key = 'contributor' AND login_route IS NULL;
UPDATE roles SET login_route = 'profile?tab=affiliate', login_priority = 40 WHERE key = 'affiliate' AND login_route IS NULL;
