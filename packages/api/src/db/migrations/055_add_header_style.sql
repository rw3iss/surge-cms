-- Per-page / per-post header color style ("default" vs "alt").
--
-- The Site Header settings now carry an alternate ("alt"/dark) background
-- + text color. A page or post can render the header in either style so
-- custom page content (e.g. an image backdrop under a floating header)
-- stays legible.
--
--   pages.header_style  — nullable; NULL/'' → 'default'.
--   posts.header_style  — nullable; NULL → inherit the site's
--                         defaultPostHeaderStyle (stored in site_header).

ALTER TABLE pages ADD COLUMN IF NOT EXISTS header_style VARCHAR(16);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS header_style VARCHAR(16);
