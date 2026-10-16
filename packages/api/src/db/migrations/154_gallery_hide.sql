-- @feature gallery
-- "Hide from gallery": the item / collection still exists everywhere (its own
-- page, Gallery blocks, {{gallery()}}, email, the entity type, the admin) but
-- is left out of the public gallery LISTINGS (GalleryQuery.listing). An item
-- in a hidden collection is left out of listings too, except its own
-- collection's page.
ALTER TABLE gallery_items ADD COLUMN IF NOT EXISTS hidden_in_gallery BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE gallery_collections ADD COLUMN IF NOT EXISTS hidden_in_gallery BOOLEAN NOT NULL DEFAULT false;
