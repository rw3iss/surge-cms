-- Per-post banner height (any CSS height: 420px, 50vh, clamp(240px, 40vw, 520px)).
-- Applies to every banner layout; NULL keeps each layout's default (Hero uses
-- Appearance → Post header banner height, Standalone its natural height,
-- Thumbnail 120px).
ALTER TABLE posts ADD COLUMN IF NOT EXISTS banner_height VARCHAR(100);
