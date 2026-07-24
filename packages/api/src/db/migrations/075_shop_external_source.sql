-- @feature shop
-- External product source (Printify + future print-on-demand / marketplace
-- integrations). Products synced from an external provider are ingested as
-- native shop_products so the storefront, reviews, categories, collections, and
-- admin all work — with provenance columns for idempotent upserts + an
-- external-image path so the provider's CDN images render without importing a
-- media file.

ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS external_provider VARCHAR(32);
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS external_id VARCHAR(128);
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS external_url TEXT;
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS external_synced_at TIMESTAMPTZ;

-- One shop_products row per (provider, external id) for idempotent sync upserts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_products_external
    ON shop_products (external_provider, external_id)
    WHERE external_provider IS NOT NULL;

-- Printify variant id (maps 1:1 to a shop_variant).
ALTER TABLE shop_variants ADD COLUMN IF NOT EXISTS external_id VARCHAR(128);

-- Allow a media row to reference an external image URL instead of an imported
-- media asset. Read queries COALESCE(media.url, shop_product_media.external_url).
ALTER TABLE shop_product_media ADD COLUMN IF NOT EXISTS external_url TEXT;
ALTER TABLE shop_product_media ALTER COLUMN media_id DROP NOT NULL;
