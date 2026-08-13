-- @feature shop
-- Default new products to 'calculated' shipping now that live rate calculation
-- (Printify + flat-rate fallback) is wired at checkout. Only the column DEFAULT
-- changes here — existing rows keep their current shipping_type (per-install
-- data, not a schema concern).

ALTER TABLE shop_products
    ALTER COLUMN shipping_type SET DEFAULT 'calculated';
