-- `developer`: member-level role for people testing the site. Besides what is
-- granted to it, it sees "Dev only" membership levels (with admins). Usually
-- given as an extra role; a fresh install gets it from this migration.
INSERT INTO roles (key, label, description, base_role, is_system, sort_order) VALUES
    ('developer', 'Developer', 'A developer: everything a member has, plus "Dev only" membership levels and what is granted to developers. Assigned by an admin or by an invite.', 'member', false, 17)
ON CONFLICT (key) DO NOTHING;
