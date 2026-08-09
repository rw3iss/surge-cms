-- Add the `entity` block type (renders a content-block template bound to an
-- entity) to both block enums. ADD VALUE IF NOT EXISTS is idempotent; on PG12+
-- it is safe inside the migration transaction because the value is only added
-- here, never used in the same transaction.

ALTER TYPE block_type ADD VALUE IF NOT EXISTS 'entity';
ALTER TYPE content_block_type ADD VALUE IF NOT EXISTS 'entity';
