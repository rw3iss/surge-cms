-- Add 'scheduled' to post/page status enums and publish_at column for scheduled publishing.
--
-- NOTE: Postgres does not allow a newly-added enum value to be used in the same
-- transaction (error 55P04). Since the migration runner wraps each file in a
-- single BEGIN/COMMIT, we can only add the enum values and the column here;
-- any indexes or code that reference 'scheduled' must live in a separate
-- migration (see 016).

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'post_status' AND e.enumlabel = 'scheduled'
    ) THEN
        ALTER TYPE post_status ADD VALUE 'scheduled';
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'page_status' AND e.enumlabel = 'scheduled'
    ) THEN
        ALTER TYPE page_status ADD VALUE 'scheduled';
    END IF;
END $$;

ALTER TABLE posts ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ;
