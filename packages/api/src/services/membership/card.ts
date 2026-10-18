/** The member's payment CARD (SetupIntent + default payment method; retries a past-due invoice). */
import type { MembershipCardResponse, MembershipCardSetupResponse, } from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { getStripeClient, } from '../payment/stripe';
import { createCustomer, } from '../payments';
import { syncUserRole, } from '../subscriptionTiers';
import { current, } from './current';

// ─── Payment card ────────────────────────────────────────────────────────

/** The member's Stripe customer: from their membership subscription, else a new one. */
export async function customerFor(userId: string,): Promise<string> {
    const r = await query<{ stripe_customer_id: string | null; }>(
        `SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 AND stripe_customer_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`,
        [userId,],
    );
    return r.rows[0]?.stripe_customer_id ?? (await createCustomer(userId,)).customerId;
}

/** Step 1 of a card change: a SetupIntent the browser confirms with the new card. */
export async function cardSetup(userId: string,): Promise<MembershipCardSetupResponse> {
    const stripe = getStripeClient('default',);
    if (!stripe) throw new ValidationError('Payments are not configured.',);
    const intent = await stripe.setupIntents.create({
        customer: await customerFor(userId,), usage: 'off_session', payment_method_types: ['card',], metadata: { userId, type: 'membership_card', },
    },);
    return { clientSecret: intent.client_secret!, };
}

/**
 * Step 2: make the confirmed card the default for the customer and the
 * subscription, and — when the subscription is past due — retry its open
 * invoice now, so a member locked out by a declined card is back at once.
 */
export async function updateCard(userId: string, paymentMethodId: string,): Promise<MembershipCardResponse> {
    const stripe = getStripeClient('default',);
    if (!stripe) throw new ValidationError('Payments are not configured.',);
    const customer = await customerFor(userId,);
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId,);
    if (pm.customer && pm.customer !== customer) throw new ValidationError('That card belongs to another account.',);
    if (!pm.customer) await stripe.paymentMethods.attach(paymentMethodId, { customer, },);
    await stripe.customers.update(customer, { invoice_settings: { default_payment_method: paymentMethodId, }, },);

    // The latest membership subscription, entitled or not (a lapsed one is what needs paying).
    const sub = (await query<{ id: string; stripe_subscription_id: string | null; }>(
        `SELECT id, stripe_subscription_id FROM subscriptions WHERE user_id = $1 AND stripe_subscription_id IS NOT NULL
          ORDER BY created_at DESC LIMIT 1`, [userId,],
    )).rows[0];
    let paid = false;
    if (sub?.stripe_subscription_id) {
        try {
            const s = await stripe.subscriptions.update(sub.stripe_subscription_id, { default_payment_method: paymentMethodId, },);
            if (s.status === 'past_due' || s.status === 'unpaid') {
                const inv = typeof s.latest_invoice === 'string' ? await stripe.invoices.retrieve(s.latest_invoice,) : s.latest_invoice;
                if (inv && inv.status === 'open') {
                    const r = await stripe.invoices.pay(inv.id!, { payment_method: paymentMethodId, },);
                    paid = r.status === 'paid';
                }
                const fresh = await stripe.subscriptions.retrieve(s.id,);
                await query(`UPDATE subscriptions SET status = $2, updated_at = NOW() WHERE id = $1`, [sub.id, fresh.status,],);
                await syncUserRole(userId,);
            }
        } catch (e) {
            // The card is saved either way; report the retry failure.
            throw new ValidationError(`Your card was saved, but the payment failed: ${(e as Error).message}`,);
        }
    }
    return { current: await current(userId,), paid, };
}

