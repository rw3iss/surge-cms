-- @feature shop
-- Store the human label of the shipping method applied to an order
-- (e.g. 'Standard', 'Express', 'Priority') alongside shipping_cents, so it can
-- be shown in order details, receipts, and admin.
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS shipping_method VARCHAR(32);
