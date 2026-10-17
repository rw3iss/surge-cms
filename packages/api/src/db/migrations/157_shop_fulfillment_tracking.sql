-- @feature shop
--
-- Supplier order tracking detail, filled in by the order reconcile
-- (services/printify/orderSync.ts) and by provider webhooks.
--
-- `status` keeps OUR vocabulary (pending / in_production / on_hold / shipped /
-- partially_shipped / delivered / cancelled / submitted / failed);
-- `external_status` keeps the supplier's own word so nothing is lost in mapping.
-- `shipments` holds every parcel ({carrier, number, url, shippedAt, deliveredAt}),
-- while `tracking_numbers` / `carrier` / `tracking_url` stay the flat summary.

ALTER TABLE shop_order_fulfillments ADD COLUMN IF NOT EXISTS external_status  VARCHAR(48);
ALTER TABLE shop_order_fulfillments ADD COLUMN IF NOT EXISTS shipments        JSONB;
ALTER TABLE shop_order_fulfillments ADD COLUMN IF NOT EXISTS in_production_at TIMESTAMPTZ;
ALTER TABLE shop_order_fulfillments ADD COLUMN IF NOT EXISTS delivered_at     TIMESTAMPTZ;
ALTER TABLE shop_order_fulfillments ADD COLUMN IF NOT EXISTS last_synced_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_shop_order_fulfillments_external
    ON shop_order_fulfillments (provider, external_order_id);
