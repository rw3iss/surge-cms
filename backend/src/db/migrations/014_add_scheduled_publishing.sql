-- Add 'scheduled' to post/page status enums and publish_at column for scheduled publishing.

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

CREATE INDEX IF NOT EXISTS idx_posts_publish_at ON posts(publish_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_pages_publish_at ON pages(publish_at) WHERE status = 'scheduled';
