-- Public member pages (/members/:handle). Core, not feature-gated: the page
-- exists for every site; its Comments tab appears when Comments/Forum are on.
--   handle          URL-safe, unique case-insensitively; derived from the
--                   display name at sign-up, editable in Profile.
--   profile_public  the member can hide their page (it then 404s and their
--                   name on comments is shown without a link).
ALTER TABLE users ADD COLUMN IF NOT EXISTS handle VARCHAR(40);
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_public BOOLEAN NOT NULL DEFAULT true;

-- Backfill: slug of the display name (else the email's local part), at least
-- 3 chars, reserved words suffixed; duplicates get a short id suffix so the
-- unique index below can never fail.
WITH base AS (
    SELECT id, created_at,
           COALESCE(NULLIF(left(trim(both '-' from regexp_replace(
               lower(COALESCE(NULLIF(display_name, ''), split_part(email, '@', 1), 'member')),
               '[^a-z0-9]+', '-', 'g')), 30), ''), 'member') AS b
      FROM users
     WHERE handle IS NULL
), fixed AS (
    SELECT id, created_at,
           CASE WHEN length(b) < 3 OR b IN ('admin', 'api', 'me', 'new', 'edit', 'settings', 'members', 'anonymous', 'staff', 'system')
                THEN b || '-member' ELSE b END AS b
      FROM base
), ranked AS (
    SELECT f.id, f.b, ROW_NUMBER() OVER (PARTITION BY f.b ORDER BY f.created_at, f.id) AS n,
           EXISTS (SELECT 1 FROM users x WHERE x.handle IS NOT NULL AND lower(x.handle) = f.b) AS taken
      FROM fixed f
)
UPDATE users u
   SET handle = CASE WHEN r.n = 1 AND NOT r.taken THEN r.b
                     ELSE r.b || '-' || substr(replace(u.id::text, '-', ''), 1, 6) END
  FROM ranked r
 WHERE r.id = u.id;

CREATE UNIQUE INDEX IF NOT EXISTS users_handle_lower ON users (lower(handle));
