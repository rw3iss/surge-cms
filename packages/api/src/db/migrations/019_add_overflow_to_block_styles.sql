-- Add overflow-x and overflow-y controls to block style templates.
ALTER TABLE block_styles ADD COLUMN IF NOT EXISTS overflow_x VARCHAR(20);
ALTER TABLE block_styles ADD COLUMN IF NOT EXISTS overflow_y VARCHAR(20);
