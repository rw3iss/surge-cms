-- @feature shop
-- 1) Buyers' own orders are matched by email case-insensitively (a guest
--    checkout as Jane@x.com belongs to the account jane@x.com), so the lookup
--    is on lower(customer_email).
-- 2) A per-order secret for the anonymous confirmation page. The order number
--    alone (in subjects, receipts, screenshots) no longer reveals the buyer's
--    identity or their digital downloads: those need the order's access key
--    (sent in the post-checkout redirect and the confirmation email) or a
--    signed-in owner. Existing orders get a key too, so old links that carry
--    only the number keep working for the non-sensitive status view.
CREATE INDEX IF NOT EXISTS idx_shop_orders_customer_email_lower
    ON shop_orders (lower(customer_email));

ALTER TABLE shop_orders
    ADD COLUMN IF NOT EXISTS access_key VARCHAR(64);

UPDATE shop_orders
   SET access_key = replace(gen_random_uuid()::text, '-', '')
 WHERE access_key IS NULL;
