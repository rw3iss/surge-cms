-- Permission grant MODES: an allowing grant is either `allow` (do it) or
-- `approval` (may do it, but the result waits for someone with the plain
-- `allow` — e.g. a contributor's `posts:publish` = "Submit for review").
-- A deny (granted = false) ignores the mode.
ALTER TABLE permission_grants ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'allow';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'permission_grants_mode_chk') THEN
        ALTER TABLE permission_grants ADD CONSTRAINT permission_grants_mode_chk CHECK (mode IN ('allow', 'approval'));
    END IF;
END $$;
