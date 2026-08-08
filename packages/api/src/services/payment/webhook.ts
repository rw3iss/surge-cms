/**
 * Stripe webhook verify + dispatch.
 *
 * Split out of `services/payments.ts` so the webhook consumer of the
 * provider + Stripe compat shims owns its own module. `payments.ts`
 * re-exports `handleWebhook` so the public import surface is unchanged.
 * Dependency is one-directional (this file never imports `payments.ts`).
 */
import Stripe from 'stripe';
import { query, } from '../../db';
import { cache, } from '../cache';
import { allWebhookSecrets, } from './credentials';
import { getPaymentProvider, } from './index';
import { invoicePaymentIntentId, invoiceSubscriptionId, subscriptionPeriod, } from './stripeCompat';
import { logger, } from '../../utils/logger';
import { uuidOrNull, } from '../../utils/uuid';

const paymentProvider = getPaymentProvider();

/**
 * Verify + dispatch a Stripe webhook. `rawBody` is the EXACT request
 * body (a Buffer when the app.ts raw-body middleware applied) — signature
 * verification depends on it being byte-identical to what Stripe sent, so
 * it must never be re-parsed before reaching here.
 *
 * Returns the HTTP contract the route must echo verbatim:
 *   - { status: 400, body } on signature/parse failure (Stripe retries).
 *   - { status: 200, body: { received: true } } otherwise — ALWAYS 200
 *     even when internal processing throws, so Stripe stops retrying.
 */
export async function handleWebhook(
    rawBody: string | Buffer,
    signature: string | undefined,
): Promise<{ status: number; body: Record<string, unknown>; }> {
    let event: Stripe.Event;

    try {
        if (allWebhookSecrets().length > 0) {
            // Production mode: verify webhook signature using raw body.
            if (!signature) {
                logger.warn('Webhook received without stripe-signature header',);
                return { status: 400, body: { error: 'Missing stripe-signature header', }, };
            }
            event = paymentProvider.verifyWebhookSignature(rawBody, signature,) as Stripe.Event;
        } else {
            // Development mode: skip verification, parse body directly.
            logger.warn(
                'STRIPE_WEBHOOK_SECRET is not set - skipping webhook signature verification (development mode)',
            );
            event = (Buffer.isBuffer(rawBody,) ? JSON.parse(rawBody.toString(),) : rawBody) as Stripe.Event;
        }
    } catch (err) {
        logger.error('Webhook signature verification failed', { error: err, },);
        return { status: 400, body: { error: 'Webhook signature verification failed', }, };
    }

    // Always respond 200 to Stripe; process synchronously but swallow
    // processing errors so Stripe doesn't retry endlessly.
    try {
        await dispatchWebhookEvent(event,);
    } catch (processingError) {
        logger.error('Error processing webhook event', {
            eventType: event.type,
            eventId: event.id,
            error: processingError,
        },);
    }

    return { status: 200, body: { received: true, }, };
}

async function dispatchWebhookEvent(event: Stripe.Event,): Promise<void> {
    logger.info('Processing webhook event', { type: event.type, id: event.id, },);

    switch (event.type) {
        case 'payment_intent.succeeded': {
            const paymentIntent = event.data.object as Stripe.PaymentIntent;

            // Shop orders route here too — delegate to the shop fulfillment
            // handler and stop (donations never carry orderType='shop').
            if (paymentIntent.metadata?.orderType === 'shop') {
                const { fulfillShopOrder, } = await import('../shop/fulfillment.js');
                await fulfillShopOrder(paymentIntent,);
                break;
            }

            // Donations are persisted ONLY here, on confirmed payment — the row
            // is INSERTed from the PaymentIntent metadata (set in payments.donate)
            // so abandoned/failed attempts never create a row. Idempotent:
            // stripe_payment_intent_id is UNIQUE, so a webhook retry is a no-op.
            const md = paymentIntent.metadata ?? {};
            const campaignId = md.campaignId && md.campaignId !== 'general' ? md.campaignId : null;
            const donationResult = await query(
                `INSERT INTO donations
                    (campaign_id, user_id, donor_name, donor_email, amount_cents, message,
                     visibility, stripe_payment_intent_id, stripe_charge_id, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'completed')
                 ON CONFLICT (stripe_payment_intent_id) DO NOTHING
                 RETURNING id, campaign_id, user_id, amount_cents`,
                [
                    campaignId,
                    uuidOrNull(md.userId,),
                    md.donorName || null,
                    md.donorEmail || paymentIntent.receipt_email || '',
                    paymentIntent.amount,
                    md.message || null,
                    (md.visibility as string) || 'public',
                    paymentIntent.id,
                    paymentIntent.latest_charge,
                ],
            );

            if (donationResult.rows.length > 0) {
                const donation = donationResult.rows[0];
                await query(
                    `INSERT INTO transactions (user_id, type, amount_cents, status, stripe_payment_intent_id,
                                               stripe_charge_id, campaign_id, donation_id, description)
                     VALUES ($1, 'donation', $2, 'completed', $3, $4, $5, $6, $7)
                     ON CONFLICT DO NOTHING`,
                    [
                        donation.user_id,
                        donation.amount_cents,
                        paymentIntent.id,
                        paymentIntent.latest_charge,
                        donation.campaign_id,
                        donation.id,
                        donation.campaign_id ? 'Campaign donation' : 'General donation',
                    ],
                );
                logger.info('Donation recorded via webhook', { paymentIntentId: paymentIntent.id, donationId: donation.id, },);
            } else {
                logger.info('Donation webhook duplicate (already recorded)', { paymentIntentId: paymentIntent.id, },);
            }

            await cache.invalidateCampaignCache();
            break;
        }

        case 'payment_intent.payment_failed': {
            const paymentIntent = event.data.object as Stripe.PaymentIntent;
            const failureMessage = paymentIntent.last_payment_error?.message || 'Unknown failure';

            // No row is persisted for a failed/abandoned donation attempt — just
            // log it (operator visibility; surfaced later if needed).
            logger.warn('Donation payment failed (not persisted)', {
                paymentIntentId: paymentIntent.id,
                reason: failureMessage,
                donorEmail: paymentIntent.metadata?.donorEmail,
                amountCents: paymentIntent.amount,
                campaignId: paymentIntent.metadata?.campaignId,
            },);
            break;
        }

        case 'charge.refunded': {
            const charge = event.data.object as Stripe.Charge;

            const refundResult = await query(
                `UPDATE donations SET status = 'refunded' WHERE stripe_charge_id = $1
                 RETURNING id, user_id, amount_cents, campaign_id`,
                [charge.id,],
            );

            if (refundResult.rows.length > 0) {
                const donation = refundResult.rows[0];
                await query(
                    `INSERT INTO transactions (user_id, type, amount_cents, status, stripe_charge_id,
                                               campaign_id, donation_id, description)
                     VALUES ($1, 'refund', $2, 'completed', $3, $4, $5, 'Donation refund')`,
                    [donation.user_id, donation.amount_cents, charge.id, donation.campaign_id, donation.id,],
                );
            }

            await cache.invalidateCampaignCache();
            logger.info('Donation refunded via webhook', { chargeId: charge.id, },);
            break;
        }

        case 'customer.subscription.created': {
            const subscription = event.data.object as Stripe.Subscription;

            const result = await query(
                `UPDATE subscriptions SET
                    status = $1,
                    current_period_start = $2,
                    current_period_end = $3,
                    updated_at = NOW()
                 WHERE stripe_subscription_id = $4`,
                [
                    subscription.status === 'incomplete' ? 'active' : subscription.status,
                    new Date(subscriptionPeriod(subscription,).start * 1000,),
                    new Date(subscriptionPeriod(subscription,).end * 1000,),
                    subscription.id,
                ],
            );

            logger.info('Subscription created event processed', {
                subscriptionId: subscription.id,
                updated: (result.rowCount ?? 0) > 0,
            },);
            break;
        }

        case 'customer.subscription.updated': {
            const subscription = event.data.object as Stripe.Subscription;

            let localStatus = subscription.status;
            if (subscription.status === 'active') localStatus = 'active';
            else if (subscription.status === 'past_due') localStatus = 'past_due';
            else if (subscription.status === 'canceled') localStatus = 'canceled';
            else if (subscription.status === 'unpaid') localStatus = 'unpaid';

            await query(
                `UPDATE subscriptions SET
                    status = $1,
                    current_period_start = $2,
                    current_period_end = $3,
                    cancel_at_period_end = $4,
                    updated_at = NOW()
                 WHERE stripe_subscription_id = $5`,
                [
                    localStatus,
                    new Date(subscriptionPeriod(subscription,).start * 1000,),
                    new Date(subscriptionPeriod(subscription,).end * 1000,),
                    subscription.cancel_at_period_end,
                    subscription.id,
                ],
            );

            logger.info('Subscription updated via webhook', {
                subscriptionId: subscription.id,
                status: localStatus,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
            },);
            break;
        }

        case 'customer.subscription.deleted': {
            const subscription = event.data.object as Stripe.Subscription;

            await query(
                `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
                 WHERE stripe_subscription_id = $1`,
                [subscription.id,],
            );

            logger.info('Subscription cancelled via webhook', { subscriptionId: subscription.id, },);
            break;
        }

        case 'invoice.payment_succeeded': {
            const invoice = event.data.object as Stripe.Invoice;
            const subscriptionId = invoiceSubscriptionId(invoice,);

            if (subscriptionId) {
                const subResult = await query(
                    'SELECT id, user_id FROM subscriptions WHERE stripe_subscription_id = $1',
                    [subscriptionId,],
                );

                if (subResult.rows.length > 0) {
                    const sub = subResult.rows[0];
                    await query(
                        `INSERT INTO transactions (user_id, type, amount_cents, status, stripe_payment_intent_id,
                                                   subscription_id, description)
                         VALUES ($1, 'subscription_payment', $2, 'completed', $3, $4, 'Subscription payment')`,
                        [sub.user_id, invoice.amount_paid, invoicePaymentIntentId(invoice,), sub.id,],
                    );
                }
            }

            logger.info('Invoice payment succeeded', { invoiceId: invoice.id, subscriptionId, },);
            break;
        }

        case 'invoice.payment_failed': {
            const invoice = event.data.object as Stripe.Invoice;
            const subscriptionId = invoiceSubscriptionId(invoice,);

            if (subscriptionId) {
                await query(
                    `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
                     WHERE stripe_subscription_id = $1 AND status = 'active'`,
                    [subscriptionId,],
                );

                const subResult = await query(
                    `SELECT s.id, s.user_id, u.email, u.display_name
                     FROM subscriptions s
                     JOIN users u ON s.user_id = u.id
                     WHERE s.stripe_subscription_id = $1`,
                    [subscriptionId,],
                );

                if (subResult.rows.length > 0) {
                    const sub = subResult.rows[0];
                    logger.warn('Subscription invoice payment failed - user may need notification', {
                        invoiceId: invoice.id,
                        subscriptionId,
                        userId: sub.user_id,
                        userEmail: sub.email,
                    },);
                    // TODO: Send email notification to user about failed payment
                }
            }

            logger.warn('Invoice payment failed', { invoiceId: invoice.id, subscriptionId, },);
            break;
        }

        default:
            logger.debug('Unhandled webhook event type', { type: event.type, },);
    }
}
