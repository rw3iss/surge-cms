-- Add 'post_list' to both block-type enums.
--
-- The post-list block (configurable feed of posts with brief / short /
-- full brevity) is a new content block type. The Postgres enum that
-- backs `blocks.type` and `post_content_blocks.type` must learn the
-- new value before any insert can succeed — without this migration,
-- saving a page or post that contains a post-list block fails with
-- 'invalid input value for enum'.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'block_type' AND e.enumlabel = 'post_list') THEN
    ALTER TYPE block_type ADD VALUE 'post_list';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'content_block_type' AND e.enumlabel = 'post_list') THEN
    ALTER TYPE content_block_type ADD VALUE 'post_list';
  END IF;
END $$;
