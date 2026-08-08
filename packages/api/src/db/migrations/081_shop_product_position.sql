-- @feature shop
-- Manual sort order for shop products. Nullable: products WITH a position sort
-- first (ascending); products WITHOUT one fall back to updated_at DESC. Set by
-- drag-reorder in the admin table or the per-product "Position" dropdown.
ALTER TABLE shop_products ADD COLUMN IF NOT EXISTS position INT;

CREATE INDEX IF NOT EXISTS idx_shop_products_position ON shop_products (position);
