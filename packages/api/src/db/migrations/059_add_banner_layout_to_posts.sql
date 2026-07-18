-- Per-post banner image layout: how the featured/banner image + title/meta
-- header renders on the public post page.
--   'standalone' (default) — title/meta at top, image full-width below (prior behavior)
--   'hero'                 — full-width image at top with title/meta overlaid
--   'thumbnail'            — small image left, title/meta right, single-row header
-- Nullable/defaulted so existing rows keep the current (standalone) rendering.
ALTER TABLE posts ADD COLUMN IF NOT EXISTS banner_layout VARCHAR(16) NOT NULL DEFAULT 'standalone';
