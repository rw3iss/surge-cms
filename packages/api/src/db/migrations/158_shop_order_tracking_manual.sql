-- @feature shop
--
-- An admin can type an order's carrier / tracking number / tracking URL by hand.
-- `tracking_manual` marks those three order-level columns as the admin's, so the
-- supplier order reconcile (refreshOrderFulfillmentStatus) leaves them alone.

ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS tracking_manual BOOLEAN NOT NULL DEFAULT false;
