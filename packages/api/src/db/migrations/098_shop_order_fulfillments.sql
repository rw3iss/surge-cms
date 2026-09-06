-- @feature shop
--
-- Per-provider fulfilment records.
--
-- Until now an order could track exactly ONE supplier: migration 076 added
-- `printify_order_id` / `printify_status` to `shop_orders`, named after the only
-- integration that existed. A cart could already MIX suppliers at the line-item
-- level, but there was nowhere to put a second supplier's order id — so a mixed
-- order was untrackable by construction.

CREATE TABLE IF NOT EXISTS shop_order_fulfillments (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id          UUID NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
    provider          VARCHAR(32) NOT NULL,
    external_order_id VARCHAR(128),
    status            VARCHAR(32) NOT NULL DEFAULT 'pending',
    carrier           VARCHAR(64),
    tracking_numbers  TEXT[],
    tracking_url      TEXT,
    submitted_at      TIMESTAMPTZ,
    shipped_at        TIMESTAMPTZ,
    last_error        TEXT,
    attempts          INTEGER NOT NULL DEFAULT 0,
    raw               JSONB,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- One record per supplier per order. Makes re-submission idempotent.
    UNIQUE (order_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_shop_order_fulfillments_order
    ON shop_order_fulfillments (order_id);
CREATE INDEX IF NOT EXISTS idx_shop_order_fulfillments_pending
    ON shop_order_fulfillments (provider, status)
    WHERE external_order_id IS NULL;

-- Which group fulfilled each line.
--
-- STORED rather than derived by joining back to shop_products.external_provider:
-- a product can be reassigned to another supplier later, and an order must stay
-- a faithful record of what was actually ordered and by whom.
ALTER TABLE shop_order_items ADD COLUMN IF NOT EXISTS fulfillment_group VARCHAR(32);
ALTER TABLE shop_order_items ADD COLUMN IF NOT EXISTS external_product_id VARCHAR(128);
ALTER TABLE shop_order_items ADD COLUMN IF NOT EXISTS external_variant_id VARCHAR(128);

-- Backfill existing orders so history is not lost. Everything external today is
-- Printify; everything else was fulfilled by us.
-- The variant lookup is a subquery, not a join: an UPDATE ... FROM cannot
-- reference the target table (`oi`) from inside a JOIN in its FROM clause.
UPDATE shop_order_items oi
SET fulfillment_group = COALESCE(p.external_provider, 'native'),
    external_product_id = p.external_id,
    external_variant_id = (SELECT v.external_id FROM shop_variants v WHERE v.id = oi.variant_id)
FROM shop_products p
WHERE oi.product_id = p.id AND oi.fulfillment_group IS NULL;

UPDATE shop_order_items SET fulfillment_group = 'native'
WHERE fulfillment_group IS NULL;

-- Carry the single-provider column into the new table.
INSERT INTO shop_order_fulfillments (order_id, provider, external_order_id, status, submitted_at)
SELECT id, 'printify', printify_order_id,
       COALESCE(printify_status, 'submitted'), updated_at
FROM shop_orders
WHERE printify_order_id IS NOT NULL
ON CONFLICT (order_id, provider) DO NOTHING;

-- `shop_orders.printify_order_id` / `printify_status` are intentionally LEFT IN
-- PLACE and become read-only. Dropping them in the same release as the cutover
-- would make a rollback lossy. A later migration can remove them once this has
-- run in production for a while. `tracking_number` / `tracking_url` / `carrier`
-- stay meaningful at order level as the aggregate of the first shipment, so the
-- existing order views and emails keep working untouched.
