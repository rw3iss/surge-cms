/** Settle a member's earlier UNPAID attempts before a new paid membership starts. */
import type Stripe from 'stripe';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { getStripeClient, } from '../payment/stripe';
import { invoiceClientSecret, } from '../payment/stripeCompat';

// ─── Earlier unfinished attempts ─────────────────────────────────────────

/**
 * Before a NEW paid membership starts, settle the member's earlier attempts
 * that never got paid (Stripe `incomplete`: the card was never confirmed).
 * Each click on "Pay" used to create another Stripe subscription, so a member
 * who retried after a card typo left several open invoices behind.
 *
 *   paid in the meantime            → `activated` (the caller confirms it)
 *   same level, still incomplete    → `reuse`: its invoice is paid with the new card
 *   anything else still incomplete  → cancelled in Stripe (its invoice is voided)
 *   expired / cancelled in Stripe   → the local row follows
 */
export async function settleOpenAttempts(
    userId: string,
    target: { tierId: string; priceId: string; } | null,
): Promise<{ reuse?: { subscriptionId: string; clientSecret: string; }; activated?: string; }> {
    const stripe = getStripeClient('default',);
    if (!stripe) return {};
    const rows = await query<{ id: string; plan_id: string; stripe_subscription_id: string; }>(
        `SELECT id, plan_id, stripe_subscription_id FROM subscriptions
          WHERE user_id = $1 AND status = 'incomplete' AND stripe_subscription_id IS NOT NULL
          ORDER BY created_at DESC`,
        [userId,],
    );
    const out: { reuse?: { subscriptionId: string; clientSecret: string; }; activated?: string; } = {};
    for (const row of rows.rows) {
        let sub: Stripe.Subscription;
        try {
            sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id, { expand: ['latest_invoice.confirmation_secret',], },);
        } catch (e) {
            logger.warn('membership: could not read an earlier attempt', { subscriptionId: row.stripe_subscription_id, error: (e as Error).message, },);
            continue;
        }
        if ((sub.status === 'active' || sub.status === 'trialing') && !out.activated) {
            out.activated = sub.id;
            continue;
        }
        const samePrice = !!target && row.plan_id === target.tierId && sub.items.data[0]?.price?.id === target.priceId;
        if (sub.status === 'incomplete' && samePrice && !out.reuse) {
            const secret = sub.latest_invoice && typeof sub.latest_invoice !== 'string' ? invoiceClientSecret(sub.latest_invoice,) : undefined;
            if (secret) {
                out.reuse = { subscriptionId: sub.id, clientSecret: secret, };
                continue;
            }
        }
        if (sub.status === 'incomplete') {
            try {
                await stripe.subscriptions.cancel(sub.id,);
            } catch (e) {
                logger.warn('membership: could not cancel an earlier attempt', { subscriptionId: sub.id, error: (e as Error).message, },);
                continue;
            }
            // `incomplete_expired`, not `cancelled`: it was never a membership (the
            // wall's "your membership has ended" wording counts only paid ones).
            await query(`UPDATE subscriptions SET status = 'incomplete_expired', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`, [row.id,],);
            logger.info('membership: cancelled an unpaid earlier attempt', { userId, subscriptionId: sub.id, },);
        } else if (sub.status !== 'active' && sub.status !== 'trialing') {
            await query(`UPDATE subscriptions SET status = $2, updated_at = NOW() WHERE id = $1`, [row.id, sub.status,],);
        }
    }
    return out;
}

