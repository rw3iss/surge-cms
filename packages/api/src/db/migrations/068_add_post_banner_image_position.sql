-- Per-post banner image vertical position (start/center/end). Controls
-- background-position (hero layouts) / object-position (standalone/thumbnail)
-- so large images can be anchored to the top or bottom instead of centered.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS banner_image_position VARCHAR(8) NOT NULL DEFAULT 'center';
