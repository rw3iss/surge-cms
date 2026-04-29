import { Request, Router, } from 'express';
import Stripe from 'stripe';
import { z, } from 'zod';
import { config, } from '../config';
import { query, } from '../db';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { NotFoundError, } from '../middleware/error';
import { cache, } from '../services/cache';
import { getPaymentProvider, } from '../services/payment';
import { logger, } from '../utils/logger';

const router = Router();
const paymentProvider = getPaymentProvider();

const donateSchema = z.object({
    amountCents: z.number().int().min(100,),
    campaignId: z.string().uuid().optional(),
    donorName: z.string().optional(),
    donorEmail: z.string().email(),
    message: z.string().max(500,).optional(),
    visibility: z.enum(['public', 'anonymous', 'hidden',],).optional(),
},);

const subscribeSchema = z.object({
    planId: z.string().uuid(),
},);

const planSchema = z.object({
    name: z.string().min(1,).max(255,),
    description: z.string().optional(),
    priceCents: z.number().int().positive(),
    interval: z.enum(['month', 'year',],).optional(),
    features: z.array(z.string(),).optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
},);

// --- Public endpoints (auth required) ---

// Create or retrieve Stripe customer for logged-in user
router.post('/create-customer', authenticate(), async (req: AuthenticatedRequest, res,) => {
    try {
        const userId = req.userId!;

        // Check if user already has a Stripe customer ID
        const userResult = await query(
            'SELECT email, display_name, stripe_customer_id FROM users WHERE id = $1',
            [userId,],
        );

        if (userResult.rows.length === 0) {
            throw new NotFoundError('User',);
        }

        const user = userResult.rows[0];

        if (user.stripe_customer_id) {
            return res.json({
                success: true,
                data: { customerId: user.stripe_customer_id, },
            },);
        }

        // Create new Stripe customer
        const customer = await paymentProvider.createCustomer({
            email: user.email,
            name: user.display_name,
            userId,
        },);

        // Store customer ID on user
        await query(
            'UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2',
            [customer.id, userId,],
        );

        res.json({
            success: true,
            data: { customerId: customer.id, },
        },);
    } catch (error) {
        logger.error('Error creating customer', { error, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to create customer', },
        },);
    }
},);

// Create donation payment intent
router.post('/donate', authenticate(false,), async (req: AuthenticatedRequest, res,) => {
    try {
        const data = donateSchema.parse(req.body,);

        // Verify campaign exists if provided
        if (data.campaignId) {
            const campaign = await query(
                `SELECT id FROM campaigns WHERE id = $1 AND is_published = true AND status = 'active'`,
                [data.campaignId,],
            );
            if (campaign.rows.length === 0) {
                throw new NotFoundError('Campaign',);
            }
        }

        const metadata: Record<string, string> = {
            campaignId: data.campaignId || 'general',
            donorEmail: data.donorEmail,
            donorName: data.donorName || 'Anonymous',
            message: data.message || '',
            visibility: data.visibility || 'public',
            userId: req.userId || '',
        };

        const paymentIntent = await paymentProvider.createPaymentIntent({
            amountCents: data.amountCents,
            customerEmail: data.donorEmail,
            metadata,
        },);

        // Create pending donation record
        await query(
            `INSERT INTO donations (campaign_id, user_id, donor_name, donor_email, amount_cents,
                              message, visibility, stripe_payment_intent_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')`,
            [
                data.campaignId || null,
                req.userId || null,
                data.donorName,
                data.donorEmail,
                data.amountCents,
                data.message,
                data.visibility || 'public',
                paymentIntent.id,
            ],
        );

        res.json({
            success: true,
            data: {
                clientSecret: paymentIntent.clientSecret,
                paymentIntentId: paymentIntent.id,
            },
        },);
    } catch (error) {
        if (error instanceof NotFoundError) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: error.message, },
            },);
        }
        logger.error('Error creating donation intent', { error, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to create donation', },
        },);
    }
},);

// Create subscription
router.post('/subscribe', authenticate(), async (req: AuthenticatedRequest, res,) => {
    try {
        const data = subscribeSchema.parse(req.body,);
        const userId = req.userId!;

        // Fetch plan
        const planResult = await query(
            'SELECT * FROM subscription_plans WHERE id = $1 AND is_active = true',
            [data.planId,],
        );
        if (planResult.rows.length === 0) {
            throw new NotFoundError('Subscription plan',);
        }
        const plan = planResult.rows[0];

        if (!plan.stripe_price_id) {
            return res.status(400,).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Plan is not configured for payments', },
            },);
        }

        // Check for existing active subscription
        const existingSub = await query(
            `SELECT id FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'past_due')`,
            [userId,],
        );
        if (existingSub.rows.length > 0) {
            return res.status(400,).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'You already have an active subscription', },
            },);
        }

        // Get or create Stripe customer
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

        // Create Stripe subscription
        const subscription = await paymentProvider.createSubscription({
            customerId,
            priceId: plan.stripe_price_id,
            metadata: { userId, planId: data.planId, },
        },);

        // Create local subscription record
        await query(
            `INSERT INTO subscriptions (user_id, plan_id, stripe_subscription_id, stripe_customer_id,
                                   status, current_period_start, current_period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
                userId,
                data.planId,
                subscription.id,
                customerId,
                subscription.status === 'incomplete' ? 'active' : subscription.status,
                subscription.currentPeriodStart,
                subscription.currentPeriodEnd,
            ],
        );

        res.json({
            success: true,
            data: {
                subscriptionId: subscription.id,
                status: subscription.status,
                clientSecret: subscription.clientSecret,
            },
        },);
    } catch (error) {
        if (error instanceof NotFoundError) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: error.message, },
            },);
        }
        logger.error('Error creating subscription', { error, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to create subscription', },
        },);
    }
},);

// Cancel subscription
router.post('/unsubscribe', authenticate(), async (req: AuthenticatedRequest, res,) => {
    try {
        const userId = req.userId!;

        const subResult = await query(
            `SELECT * FROM subscriptions WHERE user_id = $1 AND status = 'active'`,
            [userId,],
        );
        if (subResult.rows.length === 0) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'No active subscription found', },
            },);
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

        res.json({
            success: true,
            data: { message: 'Subscription will cancel at end of billing period', },
        },);
    } catch (error) {
        logger.error('Error cancelling subscription', { error, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel subscription', },
        },);
    }
},);

// Get current user's subscriptions
router.get('/subscriptions', authenticate(), async (req: AuthenticatedRequest, res,) => {
    try {
        const userId = req.userId!;

        const result = await query(
            `SELECT s.*, sp.name as plan_name, sp.description as plan_description,
              sp.price_cents as plan_price_cents, sp.interval as plan_interval, sp.features as plan_features
       FROM subscriptions s
       JOIN subscription_plans sp ON s.plan_id = sp.id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC`,
            [userId,],
        );

        const subscriptions = result.rows.map((row,) => ({
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

        res.json({ success: true, data: subscriptions, },);
    } catch (error) {
        logger.error('Error fetching subscriptions', { error, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch subscriptions', },
        },);
    }
},);

// Get current user's transaction history
router.get('/transactions', authenticate(), async (req: AuthenticatedRequest, res,) => {
    try {
        const userId = req.userId!;
        const { page = 1, limit = 20, } = req.query;
        const offset = (Number(page,) - 1) * Number(limit,);

        const countResult = await query(
            'SELECT COUNT(*) FROM transactions WHERE user_id = $1',
            [userId,],
        );
        const total = parseInt(countResult.rows[0].count, 10,);

        const result = await query(
            `SELECT t.*, c.title as campaign_title
       FROM transactions t
       LEFT JOIN campaigns c ON t.campaign_id = c.id
       WHERE t.user_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
            [userId, Number(limit,), offset,],
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

        res.json({
            success: true,
            data: transactions,
            meta: {
                page: Number(page,),
                limit: Number(limit,),
                total,
                totalPages: Math.ceil(total / Number(limit,),),
            },
        },);
    } catch (error) {
        logger.error('Error fetching transactions', { error, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch transactions', },
        },);
    }
},);

// --- Stripe webhook (no auth, raw body) ---
// The raw body middleware in app.ts ensures req.body is a Buffer for this route.
// Always return 200 to Stripe quickly, even if internal processing fails.

router.post('/webhook', async (req: Request, res,) => {
    let event: Stripe.Event;

    try {
        const sig = req.headers['stripe-signature'] as string;

        if (config.stripe.webhookSecret) {
            // Production mode: verify webhook signature using raw body
            if (!sig) {
                logger.warn('Webhook received without stripe-signature header',);
                return res.status(400,).json({ error: 'Missing stripe-signature header', },);
            }
            event = paymentProvider.verifyWebhookSignature(req.body, sig,) as Stripe.Event;
        } else {
            // Development mode: skip verification, parse body directly
            logger.warn(
                'STRIPE_WEBHOOK_SECRET is not set - skipping webhook signature verification (development mode)',
            );
            event = (Buffer.isBuffer(req.body,) ? JSON.parse(req.body.toString(),) : req.body) as Stripe.Event;
        }
    } catch (err) {
        logger.error('Webhook signature verification failed', { error: err, },);
        return res.status(400,).json({ error: 'Webhook signature verification failed', },);
    }

    // Always respond 200 to Stripe immediately; process asynchronously below
    // but we do it synchronously here and still return 200 even on internal errors.
    try {
        logger.info('Processing webhook event', { type: event.type, id: event.id, },);

        switch (event.type) {
            case 'payment_intent.succeeded': {
                const paymentIntent = event.data.object as Stripe.PaymentIntent;

                // Update donation status
                const donationResult = await query(
                    `UPDATE donations SET status = 'completed', stripe_charge_id = $1
           WHERE stripe_payment_intent_id = $2
           RETURNING id, campaign_id, user_id, amount_cents`,
                    [paymentIntent.latest_charge, paymentIntent.id,],
                );

                // Record transaction
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

                // Update the subscription record status if it already exists (created during /subscribe)
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

                // Map Stripe status to local status
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
                    // Update subscription status to past_due
                    await query(
                        `UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
             WHERE stripe_subscription_id = $1 AND status = 'active'`,
                        [subscriptionId,],
                    );

                    // Log for potential email notification trigger
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
    } catch (processingError) {
        // Log the error but still return 200 to Stripe so it doesn't retry endlessly
        logger.error('Error processing webhook event', {
            eventType: event.type,
            eventId: event.id,
            error: processingError,
        },);
    }

    // Always return 200 to acknowledge receipt
    res.json({ received: true, },);
},);

// --- Admin endpoints ---

// Get all subscriptions (admin)
router.get('/admin/subscriptions', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { status, page = 1, limit = 50, } = req.query;
        const offset = (Number(page,) - 1) * Number(limit,);

        let whereClause = 'WHERE 1=1';
        const params: unknown[] = [];

        if (status) {
            params.push(status,);
            whereClause += ` AND s.status = $${params.length}`;
        }

        const countResult = await query(
            `SELECT COUNT(*) FROM subscriptions s ${whereClause}`,
            params,
        );
        const total = parseInt(countResult.rows[0].count, 10,);

        params.push(Number(limit,), offset,);
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

        res.json({
            success: true,
            data: subscriptions,
            meta: {
                page: Number(page,),
                limit: Number(limit,),
                total,
                totalPages: Math.ceil(total / Number(limit,),),
            },
        },);
    } catch (error) {
        logger.error('Error fetching admin subscriptions', { error, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch subscriptions', },
        },);
    }
},);

// Get all transactions (admin)
router.get('/admin/transactions', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { type, status, page = 1, limit = 50, } = req.query;
        const offset = (Number(page,) - 1) * Number(limit,);

        let whereClause = 'WHERE 1=1';
        const params: unknown[] = [];

        if (type) {
            params.push(type,);
            whereClause += ` AND t.type = $${params.length}`;
        }
        if (status) {
            params.push(status,);
            whereClause += ` AND t.status = $${params.length}`;
        }

        const countResult = await query(
            `SELECT COUNT(*) FROM transactions t ${whereClause}`,
            params,
        );
        const total = parseInt(countResult.rows[0].count, 10,);

        params.push(Number(limit,), offset,);
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

        res.json({
            success: true,
            data: transactions,
            meta: {
                page: Number(page,),
                limit: Number(limit,),
                total,
                totalPages: Math.ceil(total / Number(limit,),),
            },
        },);
    } catch (error) {
        logger.error('Error fetching admin transactions', { error, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch transactions', },
        },);
    }
},);

// Get specific user's transactions (admin)
router.get(
    '/admin/user/:userId/transactions',
    authenticate(),
    requireAdmin,
    async (req: AuthenticatedRequest, res,) => {
        try {
            const { userId, } = req.params;
            const { page = 1, limit = 50, } = req.query;
            const offset = (Number(page,) - 1) * Number(limit,);

            const countResult = await query(
                'SELECT COUNT(*) FROM transactions WHERE user_id = $1',
                [userId,],
            );
            const total = parseInt(countResult.rows[0].count, 10,);

            const result = await query(
                `SELECT t.*, c.title as campaign_title
       FROM transactions t
       LEFT JOIN campaigns c ON t.campaign_id = c.id
       WHERE t.user_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
                [userId, Number(limit,), offset,],
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

            res.json({
                success: true,
                data: transactions,
                meta: {
                    page: Number(page,),
                    limit: Number(limit,),
                    total,
                    totalPages: Math.ceil(total / Number(limit,),),
                },
            },);
        } catch (error) {
            logger.error('Error fetching user transactions', { error, },);
            res.status(500,).json({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch transactions', },
            },);
        }
    },
);

// List subscription plans (admin)
router.get('/admin/plans', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const result = await query(
            'SELECT * FROM subscription_plans ORDER BY sort_order ASC, created_at ASC',
        );

        const plans = result.rows.map((row,) => ({
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
        }));

        res.json({ success: true, data: plans, },);
    } catch (error) {
        logger.error('Error fetching plans', { error, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch plans', },
        },);
    }
},);

// Create subscription plan (admin)
router.post('/admin/plans', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = planSchema.parse(req.body,);

        // Create Stripe Price (with a product)
        const stripe = new (await import('stripe')).default(config.stripe.secretKey!,);

        const product = await stripe.products.create({
            name: data.name,
            description: data.description || undefined,
        },);

        const price = await stripe.prices.create({
            product: product.id,
            unit_amount: data.priceCents,
            currency: 'usd',
            recurring: { interval: data.interval || 'month', },
        },);

        const result = await query(
            `INSERT INTO subscription_plans (name, description, price_cents, interval, stripe_price_id, is_active, features, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
            [
                data.name,
                data.description || null,
                data.priceCents,
                data.interval || 'month',
                price.id,
                data.isActive !== false,
                JSON.stringify(data.features || [],),
                data.sortOrder || 0,
            ],
        );

        const plan = result.rows[0];
        res.status(201,).json({
            success: true,
            data: {
                id: plan.id,
                name: plan.name,
                description: plan.description,
                priceCents: plan.price_cents,
                interval: plan.interval,
                stripePriceId: plan.stripe_price_id,
                isActive: plan.is_active,
                features: plan.features,
                sortOrder: plan.sort_order,
                createdAt: plan.created_at,
            },
        },);
    } catch (error) {
        logger.error('Error creating plan', { error, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to create plan', },
        },);
    }
},);

// Update subscription plan (admin)
router.put('/admin/plans/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { id, } = req.params;
        const data = planSchema.partial().parse(req.body,);

        const existing = await query('SELECT id FROM subscription_plans WHERE id = $1', [id,],);
        if (existing.rows.length === 0) {
            throw new NotFoundError('Plan',);
        }

        const updates: string[] = [];
        const values: unknown[] = [];

        if (data.name !== undefined) {
            values.push(data.name,);
            updates.push(`name = $${values.length}`,);
        }
        if (data.description !== undefined) {
            values.push(data.description,);
            updates.push(`description = $${values.length}`,);
        }
        if (data.isActive !== undefined) {
            values.push(data.isActive,);
            updates.push(`is_active = $${values.length}`,);
        }
        if (data.features !== undefined) {
            values.push(JSON.stringify(data.features,),);
            updates.push(`features = $${values.length}`,);
        }
        if (data.sortOrder !== undefined) {
            values.push(data.sortOrder,);
            updates.push(`sort_order = $${values.length}`,);
        }

        if (updates.length === 0) {
            return res.json({ success: true, data: { message: 'No changes', }, },);
        }

        values.push(id,);
        const result = await query(
            `UPDATE subscription_plans SET ${updates.join(', ',)}, updated_at = NOW()
       WHERE id = $${values.length}
       RETURNING *`,
            values,
        );

        const plan = result.rows[0];
        res.json({
            success: true,
            data: {
                id: plan.id,
                name: plan.name,
                description: plan.description,
                priceCents: plan.price_cents,
                interval: plan.interval,
                stripePriceId: plan.stripe_price_id,
                isActive: plan.is_active,
                features: plan.features,
                sortOrder: plan.sort_order,
                createdAt: plan.created_at,
            },
        },);
    } catch (error) {
        if (error instanceof NotFoundError) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: error.message, },
            },);
        }
        logger.error('Error updating plan', { error, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to update plan', },
        },);
    }
},);

// Get public plans (for subscribe page - no admin required)
router.get('/plans', async (req, res,) => {
    try {
        const result = await query(
            'SELECT * FROM subscription_plans WHERE is_active = true ORDER BY sort_order ASC, created_at ASC',
        );

        const plans = result.rows.map((row,) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            priceCents: row.price_cents,
            interval: row.interval,
            features: row.features,
        }));

        res.json({ success: true, data: plans, },);
    } catch (error) {
        logger.error('Error fetching public plans', { error, },);
        res.status(500,).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch plans', },
        },);
    }
},);

export default router;
