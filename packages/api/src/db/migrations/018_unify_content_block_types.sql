-- Add page-only types to content_block_type (post content blocks).
-- Split from 017 because Postgres cannot use newly-added enum values
-- in the same transaction they were added.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='content_block_type' AND e.enumlabel='rich_text') THEN
    ALTER TYPE content_block_type ADD VALUE 'rich_text';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='content_block_type' AND e.enumlabel='hero') THEN
    ALTER TYPE content_block_type ADD VALUE 'hero';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='content_block_type' AND e.enumlabel='html') THEN
    ALTER TYPE content_block_type ADD VALUE 'html';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='content_block_type' AND e.enumlabel='campaign') THEN
    ALTER TYPE content_block_type ADD VALUE 'campaign';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='content_block_type' AND e.enumlabel='form') THEN
    ALTER TYPE content_block_type ADD VALUE 'form';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='content_block_type' AND e.enumlabel='post') THEN
    ALTER TYPE content_block_type ADD VALUE 'post';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='content_block_type' AND e.enumlabel='social_feed') THEN
    ALTER TYPE content_block_type ADD VALUE 'social_feed';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='content_block_type' AND e.enumlabel='gallery') THEN
    ALTER TYPE content_block_type ADD VALUE 'gallery';
  END IF;
END $$;
