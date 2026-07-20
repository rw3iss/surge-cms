-- @feature shop
-- Per-product shipping model: a product ships either at a flat fee (static) or
-- 'calculated' (dynamic, via a future rate provider — stubbed for now). Flat-fee
-- products either use the shop's configured flat rate (use_default_shipping) or
-- a per-variant override (shop_variants.shipping_cents).

ALTER TABLE shop_products
    ADD COLUMN IF NOT EXISTS shipping_type VARCHAR(16) NOT NULL DEFAULT 'flat';

ALTER TABLE shop_products
    ADD COLUMN IF NOT EXISTS use_default_shipping BOOLEAN NOT NULL DEFAULT true;

-- Per-variant flat shipping cost (cents). NULL → falls back to 0 (or the shop
-- default flat rate when use_default_shipping is on).
ALTER TABLE shop_variants
    ADD COLUMN IF NOT EXISTS shipping_cents INT;
