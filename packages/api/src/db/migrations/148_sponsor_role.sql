-- `sponsor`: a copy of `ambassador` — member-level, assigned by an admin or an
-- invite, kept when the membership changes. Starts with the same permission
-- grants the ambassador role has.
INSERT INTO roles (key, label, description, base_role, is_system, sort_order) VALUES
    ('sponsor', 'Sponsor', 'A sponsor: everything a member has, plus what is granted to sponsors. Assigned by an admin or by an invite.', 'member', false, 16)
ON CONFLICT (key) DO NOTHING;

INSERT INTO permission_grants (permission_key, subject_type, subject_id, granted, created_by)
SELECT g.permission_key, 'role', 'sponsor', g.granted, g.created_by
  FROM permission_grants g
 WHERE g.subject_type = 'role' AND g.subject_id = 'ambassador'
   AND NOT EXISTS (SELECT 1 FROM permission_grants x WHERE x.subject_type = 'role' AND x.subject_id = 'sponsor' AND x.permission_key = g.permission_key);
