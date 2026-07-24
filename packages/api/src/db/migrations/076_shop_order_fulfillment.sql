-- @feature shop
-- External order fulfillment (Printify). When a paid order contains Printify
-- products it's submitted to Printify's Orders API; we store the provider order
-- id + status and the tracking info synced back.

ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS printify_order_id VARCHAR(128);
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS printify_status VARCHAR(48);
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS tracking_url TEXT;
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS carrier VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_shop_orders_printify
    ON shop_orders (printify_order_id) WHERE printify_order_id IS NOT NULL;
