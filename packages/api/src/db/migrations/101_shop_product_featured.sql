-- @feature shop
-- "Featured" flag for shop products.
--
-- A curation marker, not a status: it says "this product is worth surfacing",
-- and is meant to be QUERIED rather than read on a single record — a carousel
-- or entity block filters `isFeatured = true` to pull a live set instead of the
-- author hand-picking products that then go stale when stock changes.
--
-- NOT NULL DEFAULT false so every existing product is unfeatured and nothing
-- changes until an operator opts a product in.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

-- Partial index: the only query that matters is "the featured ones", which is a
-- small slice of the catalogue. Indexing just those rows keeps it tiny and
-- still serves `WHERE is_featured = true`.
CREATE INDEX IF NOT EXISTS idx_shop_products_is_featured
    ON shop_products (is_featured) WHERE is_featured;
