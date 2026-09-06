-- Per-page background colour.
--
-- NULL means inherit the site background (Settings → Appearance → Colors), so
-- every existing page keeps rendering exactly as it does now. Stored as the raw
-- string the admin picked, which may be a literal hex OR a `swatch:<id>`
-- reference — the same convention the appearance system already uses, so a
-- swatch edited later reflows into every page using it.
ALTER TABLE pages ADD COLUMN IF NOT EXISTS background_color VARCHAR(64);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS background_color VARCHAR(64);
