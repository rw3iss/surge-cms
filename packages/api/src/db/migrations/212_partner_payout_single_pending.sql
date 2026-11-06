-- Partner payouts: at most ONE pending payout per (partner, program). A
-- pending payout holds claimed earnings while its Stripe transfer is made;
-- a second one at the same time could only come from two runs racing. The
-- payout code treats a conflict as "a payout is already in progress"
-- (services/partners/payouts.ts). Pending rows left by an unclear Stripe
-- failure are resumed by the next payout, not duplicated.
-- Only created when no duplicates exist (an older install with two stuck
-- pending rows would otherwise fail to boot); the payout code still works
-- without it.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM affiliate_payouts WHERE status = 'pending'
         GROUP BY user_id, source HAVING COUNT(*) > 1
    ) THEN
        CREATE UNIQUE INDEX IF NOT EXISTS uq_affiliate_payouts_pending
            ON affiliate_payouts (user_id, source) WHERE status = 'pending';
    ELSE
        RAISE NOTICE 'uq_affiliate_payouts_pending not created: duplicate pending payouts exist';
    END IF;
END $$;
