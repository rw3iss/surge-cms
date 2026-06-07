-- Unify block_type and content_block_type enums so both page blocks
-- and post content blocks can use the full set of block types.

-- Add post-only types to block_type (pages)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='block_type' AND e.enumlabel='text') THEN
    ALTER TYPE block_type ADD VALUE 'text';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='block_type' AND e.enumlabel='social_media') THEN
    ALTER TYPE block_type ADD VALUE 'social_media';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='block_type' AND e.enumlabel='document') THEN
    ALTER TYPE block_type ADD VALUE 'document';
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='block_type' AND e.enumlabel='url_link') THEN
    ALTER TYPE block_type ADD VALUE 'url_link';
  END IF;
END $$;
