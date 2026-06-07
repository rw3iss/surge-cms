-- Add 'carousel' to block type enums.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='block_type' AND e.enumlabel='carousel') THEN
    ALTER TYPE block_type ADD VALUE 'carousel';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid WHERE t.typname='content_block_type' AND e.enumlabel='carousel') THEN
    ALTER TYPE content_block_type ADD VALUE 'carousel';
  END IF;
END $$;
