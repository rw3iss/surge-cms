/** An admin APPROVED a membership application: start billing now (off-session charge). */
import type Stripe from 'stripe';
import type { MembershipChangeResponse, } from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { getStripeClient, } from '../payment/stripe';
import { subscriptionPeriod, } from '../payment/stripeCompat';
import { settleOpenAttempts, } from './attempts';
import { customerFor, } from './card';
import { activeLocalSub, current, } from './current';
import { change, confirm, targetTier, } from './change';

// ─── Approved application → start billing ────────────────────────────────

/**
 * An admin approved a membership application: start the membership NOW.
 *
 *   already on a paid Stripe subscription → the normal paid→paid switch
 *     (proration, `error_if_incomplete`);
 *   otherwise → a new Stripe subscription charged OFF-SESSION to the card the
 *     applicant saved (`error_if_incomplete`: a declined card or a card that
 *     needs the member present fails here, and nothing is half-created).
 * Then `confirm` activates the local row, syncs the role and emails the member.
 * Throws ValidationError with Stripe's reason on a failed charge.
 */
export async function startApprovedMembership(
    userId: string, tierId: string, paymentMethodId: string | null, priceId?: string | null,
    opts: { idempotencyKey?: string; } = {},
): Promise<MembershipChangeResponse> {
    const local = await activeLocalSub(userId,);
    if (local?.stripe_subscription_id) return change(userId, tierId, { approved: true, priceId, },);

    const { to, from, } = await targetTier(userId, tierId, { approved: true, priceId, },);
    if (to.isCurrent) return { result: 'unchanged', current: await current(userId,), };
    // An approval starts billing off-session: earlier unpaid attempts are cancelled first.
    await settleOpenAttempts(userId, null,);
    const stripe = getStripeClient('default',);
    if (!stripe) throw new ValidationError('Payments are not configured.',);
    const chosenPrice = to.selectedPriceId!;
    const customer = await customerFor(userId,);
    let pm = paymentMethodId;
    if (pm) {
        const p = await stripe.paymentMethods.retrieve(pm,);
        if (!p.customer) await stripe.paymentMethods.attach(pm, { customer, },);
        await stripe.customers.update(customer, { invoice_settings: { default_payment_method: pm, }, },);
    } else {
        const c = await stripe.customers.retrieve(customer,);
        const def = 'deleted' in c ? null : c.invoice_settings?.default_payment_method;
        pm = typeof def === 'string' ? def : def?.id ?? null;
    }
    if (!pm) throw new ValidationError('The applicant has no saved card to charge.',);

    let sub: Stripe.Subscription;
    try {
        sub = await stripe.subscriptions.create({
            customer,
            items: [{ price: chosenPrice, },],
            default_payment_method: pm,
            off_session: true,
            payment_behavior: 'error_if_incomplete',
            metadata: { userId, planId: to.id, type: 'membership', fromPlanId: from?.id ?? '', approved: 'true', },
        }, opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey, } : undefined,);
    } catch (e) {
        throw new ValidationError(`The card could not be charged: ${(e as Error).message}`,);
    }
    const period = subscriptionPeriod(sub,);
    await query(
        `INSERT INTO subscriptions (user_id, plan_id, stripe_subscription_id, stripe_customer_id, status, current_period_start, current_period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, to.id, sub.id, customer, sub.status, new Date(period.start * 1000,), new Date(period.end * 1000,),],
    );
    return confirm(userId, sub.id,);
}

