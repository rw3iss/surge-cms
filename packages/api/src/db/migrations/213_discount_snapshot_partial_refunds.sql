-- @feature shop
-- 1. The discount rule an order was placed under (`shop_orders.discount_snapshot`):
--    written at checkout from the LOCKED re-check, read when the order is paid,
--    so an affiliate commission uses the split the buyer checked out with —
--    not the code's value at payment time. NULL on older orders (fallback:
--    the code's current commission).
--      { codeId, kind, percent, amountCents, appliesToTickets, affiliateUserId, commissionPercent }
ALTER TABLE shop_orders ADD COLUMN IF NOT EXISTS discount_snapshot JSONB;

-- 2. Partial refunds reverse a commission in proportion, possibly over
--    several refunds — so an order may carry SEVERAL `reversal` rows. The old
--    UNIQUE (order_id, user_id, kind) becomes "one COMMISSION per order and
--    affiliate". `affiliate_earnings` belongs to the affiliates feature (193,
--    which now creates this shape itself); convert it only where it exists.
DO $$
BEGIN
    IF to_regclass('affiliate_earnings') IS NOT NULL THEN
        ALTER TABLE affiliate_earnings DROP CONSTRAINT IF EXISTS affiliate_earnings_order_id_user_id_kind_key;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_affiliate_earnings_commission
            ON affiliate_earnings (order_id, user_id) WHERE kind = 'commission';
        CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_order ON affiliate_earnings (order_id);
    END IF;
END $$;
