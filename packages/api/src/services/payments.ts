/**
 * Payments service.
 *
 * Sits on top of the provider layer in `services/payment/` (Stripe today).
 * Owns donations, subscriptions, transaction history, admin lists/plans,
 * the public plan list, and the Stripe webhook event-dispatch. The route
 * layer in `routes/payments.ts` is a thin shell; the webhook route stays
 * raw (Buffer body) and calls `handleWebhook` here.
 */
import { config, } from '../config';
import { query, } from '../db';
import { AppError, NotFoundError, ValidationError, } from '../core/errors';
import { getPaymentProvider, } from './payment';
import { paginate, type Paginated, } from './payment/pagination';
import { uuidOrNull, } from '../utils/uuid';

const paymentProvider = getPaymentProvider();

export { handleWebhook, } from './payment/webhook';

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

export {
    adminListSubscriptions,
    adminListTransactions,
    adminListUserTransactions,
} from './payments.admin';

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
