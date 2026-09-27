-- "Custom" banner Vertical Position: any CSS background-position, used when
-- banner_image_position = 'custom'. NULL for the three presets.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS banner_image_position_custom VARCHAR(100);
