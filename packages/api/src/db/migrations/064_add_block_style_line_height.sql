-- Line height for block style templates (inline custom styles ride in JSONB).
ALTER TABLE block_styles ADD COLUMN IF NOT EXISTS line_height VARCHAR(20);
