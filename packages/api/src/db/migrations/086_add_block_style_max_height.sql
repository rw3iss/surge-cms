-- Block style: max-height (companion to min-height/height; same value space).
-- Applied to the block wrapper by blockStyleLayoutCss on both the public
-- renderer and the admin preview. Inline custom styles ride the style JSONB;
-- this column persists it for saved block-style templates.
ALTER TABLE block_styles ADD COLUMN IF NOT EXISTS max_height VARCHAR(100);
