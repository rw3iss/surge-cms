-- Add height column to block_styles.
ALTER TABLE block_styles ADD COLUMN IF NOT EXISTS height VARCHAR(100);
