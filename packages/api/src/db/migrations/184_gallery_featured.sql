-- @feature gallery
-- "Is featured": a curation marker on a gallery item (like a product's
-- is_featured) — meant to be QUERIED (`featured` filter / {{gallery(featured=true)}}),
-- not a visibility state. Partial index on the (few) true rows.
ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_gallery_items_featured ON gallery_items (sort_order) WHERE is_featured;
