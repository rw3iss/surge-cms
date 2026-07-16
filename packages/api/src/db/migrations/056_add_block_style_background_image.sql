-- Block style templates gain a background image.
--
-- Rendered over the background color (image wins) and covering the block's
-- full box — content is inset by the style's padding, the image itself is
-- not clipped by it (default background-clip: border-box). Inline/custom
-- per-block styles carry this in their freeform JSON already; this column
-- is for saved style templates.

ALTER TABLE block_styles ADD COLUMN IF NOT EXISTS background_image TEXT;
