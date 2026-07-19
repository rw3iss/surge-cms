-- Block style: min-height + horizontal alignment (justify-content of the
-- block's item row/grid — e.g. social posts). Inline custom styles ride JSONB.
ALTER TABLE block_styles ADD COLUMN IF NOT EXISTS min_height VARCHAR(100);
ALTER TABLE block_styles ADD COLUMN IF NOT EXISTS horizontal_align VARCHAR(20);
