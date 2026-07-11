/**
 * Payments service.
 *
 * Sits on top of the provider layer in `services/payment/` (Stripe today).
 * Owns donations, subscriptions, transaction history, admin lists/plans,
 * the public plan list, and the Stripe webhook event-dispatch. The route
 * layer in `routes/payments.ts` is a thin shell; the webhook route stays
 * raw (Buffer body) and calls `handleWebhook` here.
 */
import Stripe from 'stripe';
import { config, } from '../config';
import { query, } from '../db';
import { AppError, NotFoundError, ValidationError, } from '../core/errors';
import { cache, } from './cache';
import { getPaymentProvider, } from './payment';
import { logger, } from '../utils/logger';
import { uuidOrNull, } from '../utils/uuid';

const paymentProvider = getPaymentProvider();

// ─── Customer / donations / subscriptions (user tier) ────────────────

export async function createCustomer(userId: string,): Promise<{ customerId: string; }> {
    const userResult = await query(
        'SELECT email, display_name, stripe_customer_id FROM users WHERE id = $1',
        [userId,],
    );
    if (userResult.rows.length === 0) throw new NotFoundError('User',);
    const user = userResult.rows[0];

    if (user.stripe_customer_id) {
        return { customerId: user.stripe_customer_id, };
    }

    const customer = await paymentProvider.createCustomer({
        email: user.email,
        name: user.display_name,
        userId,
    },);

    await query(
        'UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2',
        [customer.id, userId,],
    );

    return { customerId: customer.id, };
}

export interface DonateInput {
    amountCents: number;
    campaignId?: string;
    donorName?: string;
    donorEmail: string;
    message?: string;
    visibility?: 'public' | 'anonymous' | 'hidden';
}

/** Create a donation payment intent + pending donation row. Anonymous
 *  donations are allowed (actorUserId undefined). */
export async function donate(input: DonateInput, actorUserId: string | undefined,) {
    // Verify campaign exists if provided.
    if (input.campaignId) {
        const campaign = await query(
            `SELECT id FROM campaigns WHERE id = $1 AND is_published = true AND status = 'active'`,
            [input.campaignId,],
        );
        if (campaign.rows.length === 0) throw new NotFoundError('Campaign',);
    }

    const metadata: Record<string, string> = {
        campaignId: input.campaignId || 'general',
        donorEmail: input.donorEmail,
        donorName: input.donorName || 'Anonymous',
        message: input.message || '',
        visibility: input.visibility || 'public',
        // Stripe metadata is free-form string — keep the original ''
        // sentinel for anonymous donors.
        userId: actorUserId || '',
    };

    const paymentIntent = await paymentProvider.createPaymentIntent({
        amountCents: input.amountCents,
        customerEmail: input.donorEmail,
        metadata,
    },);

    // donations.user_id is a UUID FK — synthetic actors → NULL.
    await query(
        `INSERT INTO donations (campaign_id, user_id, donor_name, donor_email, amount_cents,
                                message, visibility, stripe_payment_intent_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
        [
            input.campaignId || null,
            uuidOrNull(actorUserId,),
            input.donorName,
            input.donorEmail,
            input.amountCents,
            input.message,
            input.visibility || 'public',
            paymentIntent.id,
        ],
    );

    return {
        clientSecret: paymentIntent.clientSecret,
        paymentIntentId: paymentIntent.id,
    };
}

export async function subscribe(userId: string, planId: string,) {
    const planResult = await query(
        'SELECT * FROM subscription_plans WHERE id = $1 AND is_active = true',
        [planId,],
    );
    if (planResult.rows.length === 0) throw new NotFoundError('Subscription plan',);
    const plan = planResult.rows[0];

    if (!plan.stripe_price_id) {
        throw new ValidationError('Plan is not configured for payments',);
    }

    const existingSub = await query(
        `SELECT id FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'past_due')`,
        [userId,],
    );
    if (existingSub.rows.length > 0) {
        throw new ValidationError('You already have an active subscription',);
    }

    const userResult = await query(
        'SELECT email, display_name, stripe_customer_id FROM users WHERE id = $1',
        [userId,],
    );
    const user = userResult.rows[0];
    let customerId = user.stripe_customer_id;

    if (!customerId) {
        const customer = await paymentProvider.createCustomer({
            email: user.email,
            name: user.display_name,
            userId,
        },);
        customerId = customer.id;
        await query(
            'UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2',
            [customerId, userId,],
        );
    }

    const subscription = await paymentProvider.createSubscription({
        customerId,
        priceId: plan.stripe_price_id,
        metadata: { userId, planId, },
    },);

    await query(
        `INSERT INTO subscriptions (user_id, plan_id, stripe_subscription_id, stripe_customer_id,
                                    status, current_period_start, current_period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
            userId,
            planId,
            subscription.id,
            customerId,
            subscription.status === 'incomplete' ? 'active' : subscription.status,
            subscription.currentPeriodStart,
            subscription.currentPeriodEnd,
        ],
    );

    return {
        subscriptionId: subscription.id,
        status: subscription.status,
        clientSecret: subscription.clientSecret,
    };
}

export async function unsubscribe(userId: string,): Promise<{ message: string; }> {
    const subResult = await query(
        `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active'`,
        [userId,],
    );
    if (subResult.rows.length === 0) {
        throw new AppError(404, 'NOT_FOUND', 'No active subscription found',);
    }
    const sub = subResult.rows[0];

    if (sub.stripe_subscription_id) {
        await paymentProvider.cancelSubscription(sub.stripe_subscription_id,);
    }

    await query(
        `UPDATE subscriptions SET cancel_at_period_end = true, cancelled_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [sub.id,],
    );

    return { message: 'Subscription will cancel at end of billing period', };
}

export async function listUserSubscriptions(userId: string,) {
    const result = await query(
        `SELECT s.*, sp.name as plan_name, sp.description as plan_description,
                sp.price_cents as plan_price_cents, sp.interval as plan_interval, sp.features as plan_features
         FROM subscriptions s
         JOIN subscription_plans sp ON s.plan_id = sp.id
         WHERE s.user_id = $1
         ORDER BY s.created_at DESC`,
        [userId,],
    );

    return result.rows.map((row,) => ({
        id: row.id,
        planName: row.plan_name,
        planDescription: row.plan_description,
        planPriceCents: row.plan_price_cents,
        planInterval: row.plan_interval,
        planFeatures: row.plan_features,
        status: row.status,
        currentPeriodStart: row.current_period_start,
        currentPeriodEnd: row.current_period_end,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        cancelledAt: row.cancelled_at,
        createdAt: row.created_at,
    }));
}

interface Paginated<T> {
    data: T[];
    meta: { page: number; limit: number; total: number; totalPages: number; };
}

function paginate<T>(data: T[], page: number, limit: number, total: number,): Paginated<T> {
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit,), }, };
}

export async function listUserTransactions(userId: string, page: number, limit: number,): Promise<Paginated<unknown>> {
    const offset = (page - 1) * limit;

    const countResult = await query('SELECT COUNT(*) FROM transactions WHERE user_id = $1', [userId,],);
    const total = parseInt(countResult.rows[0].count, 10,);

    const result = await query(
        `SELECT t.*, c.title as campaign_title
         FROM transactions t
         LEFT JOIN campaigns c ON t.campaign_id = c.id
         WHERE t.user_id = $1
         ORDER BY t.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset,],
    );

    const transactions = result.rows.map((row,) => ({
        id: row.id,
        type: row.type,
        amountCents: row.amount_cents,
        currency: row.currency,
        status: row.status,
        description: row.description,
        campaignTitle: row.campaign_title,
        createdAt: row.created_at,
    }));

    return paginate(transactions, page, limit, total,);
}

// ─── Admin endpoints ─────────────────────────────────────────────────

export async function adminListSubscriptions(status: string | undefined, page: number, limit: number,): Promise<Paginated<unknown>> {
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (status) {
        params.push(status,);
        whereClause += ` AND s.status = $${params.length}`;
    }

    const countResult = await query(`SELECT COUNT(*) FROM subscriptions s ${whereClause}`, params,);
    const total = parseInt(countResult.rows[0].count, 10,);

    params.push(limit, offset,);
    const result = await query(
        `SELECT s.*, sp.name as plan_name, sp.price_cents as plan_price_cents,
                u.email as user_email, u.display_name as user_name
         FROM subscriptions s
         JOIN subscription_plans sp ON s.plan_id = sp.id
         JOIN users u ON s.user_id = u.id
         ${whereClause}
         ORDER BY s.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );

    const subscriptions = result.rows.map((row,) => ({
        id: row.id,
        userId: row.user_id,
        userEmail: row.user_email,
        userName: row.user_name,
        planName: row.plan_name,
        planPriceCents: row.plan_price_cents,
        status: row.status,
        currentPeriodEnd: row.current_period_end,
        cancelAtPeriodEnd: row.cancel_at_period_end,
        createdAt: row.created_at,
    }));

    return paginate(subscriptions, page, limit, total,);
}

export async function adminListTransactions(
    filters: { type?: string; status?: string; },
    page: number,
    limit: number,
): Promise<Paginated<unknown>> {
    const offset = (page - 1) * limit;
    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];

    if (filters.type) {
        params.push(filters.type,);
        whereClause += ` AND t.type = $${params.length}`;
    }
    if (filters.status) {
        params.push(filters.status,);
        whereClause += ` AND t.status = $${params.length}`;
    }

    const countResult = await query(`SELECT COUNT(*) FROM transactions t ${whereClause}`, params,);
    const total = parseInt(countResult.rows[0].count, 10,);

    params.push(limit, offset,);
    const result = await query(
        `SELECT t.*, u.email as user_email, u.display_name as user_name, c.title as campaign_title
         FROM transactions t
         LEFT JOIN users u ON t.user_id = u.id
         LEFT JOIN campaigns c ON t.campaign_id = c.id
         ${whereClause}
         ORDER BY t.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );

    const transactions = result.rows.map((row,) => ({
        id: row.id,
        userId: row.user_id,
        userEmail: row.user_email,
        userName: row.user_name,
        type: row.type,
        amountCents: row.amount_cents,
        currency: row.currency,
        status: row.status,
        description: row.description,
        campaignTitle: row.campaign_title,
        createdAt: row.created_at,
    }));

    return paginate(transactions, page, limit, total,);
}

export async function adminListUserTransactions(userId: string, page: number, limit: number,): Promise<Paginated<unknown>> {
    const offset = (page - 1) * limit;

    const countResult = await query('SELECT COUNT(*) FROM transactions WHERE user_id = $1', [userId,],);
    const total = parseInt(countResult.rows[0].count, 10,);

    const result = await query(
        `SELECT t.*, c.title as campaign_title
         FROM transactions t
         LEFT JOIN campaigns c ON t.campaign_id = c.id
         WHERE t.user_id = $1
         ORDER BY t.created_at DESC
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset,],
    );

    const transactions = result.rows.map((row,) => ({
        id: row.id,
        type: row.type,
        amountCents: row.amount_cents,
        currency: row.currency,
        status: row.status,
        description: row.description,
        campaignTitle: row.campaign_title,
        createdAt: row.created_at,
    }));

    return paginate(transactions, page, limit, total,);
}

function mapPlanRow(row: Record<string, unknown>,) {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        priceCents: row.price_cents,
        interval: row.interval,
        stripePriceId: row.stripe_price_id,
        isActive: row.is_active,
        features: row.features,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
    };
}

export async function adminListPlans() {
    const result = await query(
        'SELECT * FROM subscription_plans ORDER BY sort_order ASC, created_at ASC',
    );
    return result.rows.map(mapPlanRow,);
}

export interface PlanInput {
    name: string;
    description?: string;
    priceCents: number;
    interval?: 'month' | 'year';
    features?: string[];
    sortOrder?: number;
    isActive?: boolean;
}

export async function createPlan(input: PlanInput,) {
    // Create Stripe Price (with a product).
    const stripe = new (await import('stripe')).default(config.stripe.secretKey!,);

    const product = await stripe.products.create({
        name: input.name,
        description: input.description || undefined,
    },);

    const price = await stripe.prices.create({
        product: product.id,
        unit_amount: input.priceCents,
        currency: 'usd',
        recurring: { interval: input.interval || 'month', },
    },);

    const result = await query(
        `INSERT INTO subscription_plans (name, description, price_cents, interval, stripe_price_id, is_active, features, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
            input.name,
            input.description || null,
            input.priceCents,
            input.interval || 'month',
            price.id,
            input.isActive !== false,
            JSON.stringify(input.features || [],),
            input.sortOrder || 0,
        ],
    );

    return mapPlanRow(result.rows[0],);
}

export async function updatePlan(id: string, patch: Partial<PlanInput>,): Promise<{ message: string; } | ReturnType<typeof mapPlanRow>> {
    const existing = await query('SELECT id FROM subscription_plans WHERE id = $1', [id,],);
    if (existing.rows.length === 0) throw new NotFoundError('Plan',);

    const updates: string[] = [];
    const values: unknown[] = [];

    if (patch.name !== undefined) {
        values.push(patch.name,);
        updates.push(`name = $${values.length}`,);
    }
    if (patch.description !== undefined) {
        values.push(patch.description,);
        updates.push(`description = $${values.length}`,);
    }
    if (patch.isActive !== undefined) {
        values.push(patch.isActive,);
        updates.push(`is_active = $${values.length}`,);
    }
    if (patch.features !== undefined) {
        values.push(JSON.stringify(patch.features,),);
        updates.push(`features = $${values.length}`,);
    }
    if (patch.sortOrder !== undefined) {
        values.push(patch.sortOrder,);
        updates.push(`sort_order = $${values.length}`,);
    }

    if (updates.length === 0) {
        return { message: 'No changes', };
    }

    values.push(id,);
    const result = await query(
        `UPDATE subscription_plans SET ${updates.join(', ',)}, updated_at = NOW()
         WHERE id = $${values.length}
         RETURNING *`,
        values,
    );

    return mapPlanRow(result.rows[0],);
}

/** Public plans for the subscribe page. Active-only; safe to cache for
 *  anonymous readers (no admin bypass / shaping). Currently uncached —
 *  the public list is a single fast query and matches the original. */
export async function publicPlans() {
    const result = await query(
        'SELECT * FROM subscription_plans WHERE is_active = true ORDER BY sort_order ASC, created_at ASC',
    );
    return result.rows.map((row,) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        priceCents: row.price_cents,
        interval: row.interval,
        features: row.features,
    }));
}

// ─── Stripe webhook event dispatch ───────────────────────────────────

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
        if (config.stripe.webhookSecret) {
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
                const { fulfillShopOrder, } = await import('./shop/fulfillment.js');
                await fulfillShopOrder(paymentIntent,);
                break;
            }

            const donationResult = await query(
                `UPDATE donations SET status = 'completed', stripe_charge_id = $1
                 WHERE stripe_payment_intent_id = $2
                 RETURNING id, campaign_id, user_id, amount_cents`,
                [paymentIntent.latest_charge, paymentIntent.id,],
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
            }

            await cache.invalidateCampaignCache();
            logger.info('Donation completed via webhook', { paymentIntentId: paymentIntent.id, },);
            break;
        }

        case 'payment_intent.payment_failed': {
            const paymentIntent = event.data.object as Stripe.PaymentIntent;
            const failureMessage = paymentIntent.last_payment_error?.message || 'Unknown failure';

            await query(
                `UPDATE donations SET status = 'failed' WHERE stripe_payment_intent_id = $1`,
                [paymentIntent.id,],
            );

            logger.warn('Donation payment failed', { paymentIntentId: paymentIntent.id, reason: failureMessage, },);
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
                    new Date(subscription.current_period_start * 1000,),
                    new Date(subscription.current_period_end * 1000,),
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
                    new Date(subscription.current_period_start * 1000,),
                    new Date(subscription.current_period_end * 1000,),
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
            const subscriptionId = invoice.subscription as string;

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
                        [sub.user_id, invoice.amount_paid, invoice.payment_intent, sub.id,],
                    );
                }
            }

            logger.info('Invoice payment succeeded', { invoiceId: invoice.id, subscriptionId, },);
            break;
        }

        case 'invoice.payment_failed': {
            const invoice = event.data.object as Stripe.Invoice;
            const subscriptionId = invoice.subscription as string;

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
