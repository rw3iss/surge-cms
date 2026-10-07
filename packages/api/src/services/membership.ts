/**
 * A signed-in user managing their own subscription tier (profile → Membership).
 * Stripe stays the source of truth for paid tiers; the local `subscriptions`
 * row mirrors it and the user's role follows the tier (`syncUserRole`).
 *
 *   free → paid  : Stripe subscription created `default_incomplete`; the browser
 *                  confirms the first payment with a card, then `confirm` marks
 *                  it active (the webhook does the same, idempotently).
 *   paid → paid  : immediate, with Stripe proration (`always_invoice`): unused
 *                  time on the old price is credited, the difference is charged
 *                  now — or, on a downgrade, left as credit on the next invoice.
 *                  Refund-and-recharge would mean two card charges and a refund
 *                  delay for the same outcome.
 *   paid → free  : cancel at the end of the period already paid for (`resume`
 *                  undoes it); a hand-assigned tier ends immediately.
 *
 * Every change emails the user (`user_subscription_changed`).
 */
import type Stripe from 'stripe';
import type {
    MembershipChangeResponse, MembershipCurrent, MembershipPreviewResponse, MembershipResponse, MembershipTierOption,
} from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../core/errors';
import { query, } from '../db';
import { logger, } from '../utils/logger';
import { sendPurposeMail, } from './mail/purposes';
import { getPaymentProvider, } from './payment';
import { getStripeClient, } from './payment/stripe';
import { subscriptionPeriod, } from './payment/stripeCompat';
import { createCustomer, } from './payments';
import { ENTITLED_STATUSES, } from './permissions';
import { listTiers, stripePrices, syncUserRole, userSubscription, } from './subscriptionTiers';

// ─── Tier catalogue (with Stripe amounts) ────────────────────────────────

let priceCache: { at: number; byId: Map<string, { amount: number; currency: string; interval: string; intervalCount: number; productDescription: string | null; }>; } | null = null;

async function priceDetails() {
    if (priceCache && Date.now() - priceCache.at < 5 * 60_000) return priceCache.byId;
    const byId = new Map<string, { amount: number; currency: string; interval: string; intervalCount: number; productDescription: string | null; }>();
    const stripe = getStripeClient('default',);
    if (stripe) {
        try {
            for await (const p of stripe.prices.list({ active: true, type: 'recurring', expand: ['data.product',], limit: 100, },)) {
                const product = typeof p.product === 'string' ? null : p.product as Stripe.Product;
                byId.set(p.id, {
                    amount: p.unit_amount ?? 0,
                    currency: p.currency,
                    interval: p.recurring?.interval ?? 'month',
                    intervalCount: p.recurring?.interval_count ?? 1,
                    productDescription: product && !('deleted' in product && product.deleted) ? product.description ?? null : null,
                },);
            }
        } catch (e) {
            logger.warn('membership: stripe prices failed', { error: (e as Error).message, },);
        }
    }
    priceCache = { at: Date.now(), byId, };
    return byId;
}
void stripePrices; // (admin listing lives in subscriptionTiers)

/** Free first, then purchasable tiers by price. */
async function tierOptions(currentTierId: string | null,): Promise<MembershipTierOption[]> {
    const prices = await priceDetails();
    const out: MembershipTierOption[] = [];
    for (const t of await listTiers()) {
        if (!t.isActive && t.id !== currentTierId) continue;
        if (!t.isFree && !t.stripePriceId && t.id !== currentTierId) continue; // not purchasable
        const p = t.stripePriceId ? prices.get(t.stripePriceId,) : undefined;
        out.push({
            id: t.id,
            slug: t.slug,
            name: t.name,
            description: t.description || p?.productDescription || null,
            isFree: t.isFree,
            priceCents: t.isFree ? 0 : p?.amount ?? t.priceCents,
            currency: p?.currency ?? 'usd',
            interval: p?.interval ?? t.interval,
            intervalCount: p?.intervalCount ?? 1,
            isCurrent: t.id === currentTierId,
        },);
    }
    return out.sort((a, b,) => Number(b.isFree,) - Number(a.isFree,) || a.priceCents - b.priceCents);
}

// ─── Current ─────────────────────────────────────────────────────────────

interface LocalSub {
    id: string;
    plan_id: string;
    stripe_subscription_id: string | null;
    status: string;
    current_period_end: Date | null;
    cancel_at_period_end: boolean;
}

async function activeLocalSub(userId: string,): Promise<LocalSub | null> {
    const r = await query<LocalSub>(
        `SELECT id, plan_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end
           FROM subscriptions WHERE user_id = $1 AND status = ANY($2) ORDER BY created_at DESC LIMIT 1`,
        [userId, ENTITLED_STATUSES,],
    );
    return r.rows[0] ?? null;
}

async function cardFor(stripeSubId: string | null,): Promise<MembershipCurrent['card']> {
    const stripe = getStripeClient('default',);
    if (!stripe || !stripeSubId) return null;
    try {
        const sub = await stripe.subscriptions.retrieve(stripeSubId, { expand: ['default_payment_method',], },);
        const pm = sub.default_payment_method as Stripe.PaymentMethod | null;
        return pm?.card ? { brand: pm.card.brand, last4: pm.card.last4, } : null;
    } catch {
        return null;
    }
}

export async function current(userId: string,): Promise<MembershipCurrent> {
    const [info, user, local,] = await Promise.all([
        userSubscription(userId,),
        query<{ role: string; }>(`SELECT role FROM users WHERE id = $1`, [userId,],),
        activeLocalSub(userId,),
    ],);
    const tiers = await tierOptions(info.tier?.id ?? null,);
    const opt = tiers.find((t,) => t.isCurrent,);
    return {
        tier: info.tier ? { id: info.tier.id, slug: info.tier.slug, name: info.tier.name, description: opt?.description ?? null, isFree: info.tier.isFree, } : null,
        role: user.rows[0]?.role ?? 'member',
        status: info.status,
        source: info.source,
        priceCents: opt?.priceCents ?? 0,
        currency: opt?.currency ?? 'usd',
        interval: opt && !opt.isFree ? opt.interval : null,
        currentPeriodEnd: info.currentPeriodEnd,
        cancelAtPeriodEnd: info.cancelAtPeriodEnd,
        card: await cardFor(local?.stripe_subscription_id ?? null,),
    };
}

export async function overview(userId: string,): Promise<MembershipResponse> {
    const cur = await current(userId,);
    return { current: cur, tiers: await tierOptions(cur.tier?.id ?? null,), };
}

// ─── Preview ─────────────────────────────────────────────────────────────

async function targetTier(userId: string, tierId: string,) {
    const cur = await current(userId,);
    const tiers = await tierOptions(cur.tier?.id ?? null,);
    const to = tiers.find((t,) => t.id === tierId,);
    if (!to) throw new NotFoundError('Subscription',);
    if (!to.isFree && !to.isCurrent) {
        const row = await query<{ stripe_price_id: string | null; }>(`SELECT stripe_price_id FROM subscription_plans WHERE id = $1`, [tierId,],);
        if (!row.rows[0]?.stripe_price_id) throw new ValidationError('That subscription is not available to buy yet.',);
    }
    return { cur, tiers, to, from: tiers.find((t,) => t.isCurrent,) ?? null, };
}

export async function preview(userId: string, tierId: string,): Promise<MembershipPreviewResponse> {
    const { cur, to, from, } = await targetTier(userId, tierId,);
    const local = await activeLocalSub(userId,);
    const base = { from, to, currency: to.currency, creditAfter: 0, nextAmount: to.priceCents, };

    if (to.isCurrent && !cur.cancelAtPeriodEnd) {
        return { ...base, direction: 'same', amountDueNow: 0, effective: 'now', effectiveDate: null, nextDate: cur.currentPeriodEnd, requiresPayment: false, };
    }
    if (to.isFree) {
        return {
            ...base, direction: 'cancel', amountDueNow: 0, nextAmount: 0, nextDate: null,
            effective: local?.stripe_subscription_id ? 'period_end' : 'now',
            effectiveDate: local?.stripe_subscription_id ? cur.currentPeriodEnd : new Date().toISOString(),
            requiresPayment: false,
        };
    }
    // Nothing paid in Stripe yet → a new subscription, first period now.
    if (!local?.stripe_subscription_id) {
        return { ...base, direction: 'new', amountDueNow: to.priceCents, effective: 'now', effectiveDate: new Date().toISOString(), nextDate: null, requiresPayment: true, };
    }
    // paid → paid: ask Stripe what the proration invoice comes to.
    const stripe = getStripeClient('default',);
    if (!stripe) throw new ValidationError('Payments are not configured.',);
    const sub = await stripe.subscriptions.retrieve(local.stripe_subscription_id,);
    const priceId = (await query<{ stripe_price_id: string; }>(`SELECT stripe_price_id FROM subscription_plans WHERE id = $1`, [to.id,],)).rows[0].stripe_price_id;
    const inv = await stripe.invoices.createPreview({
        customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        subscription: sub.id,
        subscription_details: {
            items: [{ id: sub.items.data[0]!.id, price: priceId, },],
            proration_behavior: 'always_invoice',
            proration_date: Math.floor(Date.now() / 1000,),
        },
    },);
    const due = Math.max(0, inv.amount_due,);
    const credit = inv.total < 0 ? -inv.total : 0;
    const direction = to.priceCents > (from?.priceCents ?? 0) ? 'upgrade' : 'downgrade';
    return {
        ...base, direction, amountDueNow: due, creditAfter: credit,
        effective: 'now', effectiveDate: new Date().toISOString(),
        nextDate: new Date(subscriptionPeriod(sub,).end * 1000,).toISOString(),
        requiresPayment: false,
    };
}

// ─── Change ──────────────────────────────────────────────────────────────

/** "monthly", "yearly", "every 3 months". */
export function frequency(interval: string, count = 1,): string {
    if (count > 1) return `every ${count} ${interval}s`;
    return ({ day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly', } as Record<string, string>)[interval] ?? `every ${interval}`;
}

async function email(userId: string, from: MembershipTierOption | null, to: MembershipTierOption | null, note: string,) {
    const u = await query<{ email: string; display_name: string | null; }>(`SELECT email, display_name FROM users WHERE id = $1`, [userId,],);
    const user = u.rows[0];
    if (!user) return;
    const describe = (t: MembershipTierOption | null,) => t
        ? {
            name: t.name, description: t.description ?? '',
            price: t.isFree ? 'Free' : `${(t.priceCents / 100).toFixed(2,)} ${t.currency.toUpperCase()}`,
            frequency: t.isFree ? '' : frequency(t.interval, t.intervalCount,),
        }
        : { name: 'None', description: '', price: '', frequency: '', };
    void sendPurposeMail('user_subscription_changed', {
        to: user.email,
        context: {
            user: { name: user.display_name ?? '', email: user.email, },
            subscription: { previous: describe(from,), current: describe(to,), note, },
        },
    },);
}

export async function change(userId: string, tierId: string,): Promise<MembershipChangeResponse> {
    const { cur, to, from, } = await targetTier(userId, tierId,);
    const local = await activeLocalSub(userId,);
    const stripe = getStripeClient('default',);

    // Re-choosing the current tier while a cancellation is scheduled = resume.
    if (to.isCurrent) {
        if (cur.cancelAtPeriodEnd) return resume(userId,);
        return { result: 'unchanged', current: cur, };
    }

    // → free
    if (to.isFree) {
        if (local?.stripe_subscription_id) {
            if (!stripe) throw new ValidationError('Payments are not configured.',);
            await stripe.subscriptions.update(local.stripe_subscription_id, { cancel_at_period_end: true, },);
            await query(`UPDATE subscriptions SET cancel_at_period_end = true, updated_at = NOW() WHERE id = $1`, [local.id,],);
            const ends = local.current_period_end ? new Date(local.current_period_end,).toLocaleDateString('en-US', { dateStyle: 'long', },) : 'the end of the period';
            await email(userId, from, to, `Your ${from?.name ?? ''} subscription stays active until ${ends}, then your account moves to the free plan. You will not be charged again.`,);
            return { result: 'cancel_scheduled', current: await current(userId,), };
        }
        if (local) {
            await query(`UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`, [local.id,],);
        }
        await syncUserRole(userId,);
        await email(userId, from, to, 'Your account is now on the free plan.',);
        return { result: 'cancelled', current: await current(userId,), };
    }

    if (!stripe) throw new ValidationError('Payments are not configured.',);
    const priceId = (await query<{ stripe_price_id: string; }>(`SELECT stripe_price_id FROM subscription_plans WHERE id = $1`, [to.id,],)).rows[0]!.stripe_price_id;

    // free (or hand-assigned) → paid: a new Stripe subscription.
    if (!local?.stripe_subscription_id) {
        const { customerId, } = await createCustomer(userId,);
        const sub = await getPaymentProvider().createSubscription({
            customerId, priceId, metadata: { userId, planId: to.id, type: 'membership', fromPlanId: from?.id ?? '', },
        },);
        await query(
            `INSERT INTO subscriptions (user_id, plan_id, stripe_subscription_id, stripe_customer_id, status, current_period_start, current_period_end)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [userId, to.id, sub.id, customerId, sub.status, sub.currentPeriodStart, sub.currentPeriodEnd,],
        );
        if (sub.status === 'active' || sub.status === 'trialing') return confirm(userId, sub.id,);
        return { result: 'payment_required', clientSecret: sub.clientSecret, subscriptionId: sub.id, current: cur, };
    }

    // paid → paid: immediate switch with proration.
    const sub = await stripe.subscriptions.retrieve(local.stripe_subscription_id,);
    let updated: Stripe.Subscription;
    try {
        updated = await stripe.subscriptions.update(sub.id, {
            items: [{ id: sub.items.data[0]!.id, price: priceId, },],
            proration_behavior: 'always_invoice',
            // A declined card fails the call instead of half-switching the plan.
            payment_behavior: 'error_if_incomplete',
            cancel_at_period_end: false,
            metadata: { ...sub.metadata, planId: to.id, },
        },);
    } catch (e) {
        throw new ValidationError(`The change could not be charged: ${(e as Error).message}`,);
    }
    const period = subscriptionPeriod(updated,);
    await query(
        `UPDATE subscriptions SET plan_id = $2, status = $3, current_period_start = $4, current_period_end = $5,
                cancel_at_period_end = false, updated_at = NOW() WHERE id = $1`,
        [local.id, to.id, updated.status, new Date(period.start * 1000,), new Date(period.end * 1000,),],
    );
    await syncUserRole(userId,);
    const direction = to.priceCents > (from?.priceCents ?? 0) ? 'upgraded' : 'changed';
    await email(userId, from, to, `Your subscription was ${direction} today. Any unused time on your previous plan was credited against the new one.`,);
    return { result: 'changed', current: await current(userId,), };
}

/** After the browser confirmed the first payment of a new subscription. */
export async function confirm(userId: string, stripeSubscriptionId: string,): Promise<MembershipChangeResponse> {
    const r = await query<{ id: string; plan_id: string; status: string; }>(
        `SELECT id, plan_id, status FROM subscriptions WHERE user_id = $1 AND stripe_subscription_id = $2`,
        [userId, stripeSubscriptionId,],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundError('Subscription',);
    const stripe = getStripeClient('default',);
    if (!stripe) throw new ValidationError('Payments are not configured.',);
    const sub = await stripe.subscriptions.retrieve(stripeSubscriptionId,);
    if (sub.status !== 'active' && sub.status !== 'trialing') {
        return { result: 'payment_required', subscriptionId: stripeSubscriptionId, current: await current(userId,), };
    }
    const wasActive = ENTITLED_STATUSES.includes(row.status,);
    const period = subscriptionPeriod(sub,);
    // A previous hand-assigned tier ends now that a paid one started.
    await query(
        `UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
          WHERE user_id = $1 AND stripe_subscription_id IS NULL AND status = ANY($2)`,
        [userId, ENTITLED_STATUSES,],
    );
    await query(
        `UPDATE subscriptions SET status = $2, current_period_start = $3, current_period_end = $4, updated_at = NOW() WHERE id = $1`,
        [row.id, sub.status, new Date(period.start * 1000,), new Date(period.end * 1000,),],
    );
    await syncUserRole(userId,);
    if (!wasActive) {
        const tiers = await tierOptions(row.plan_id,);
        const fromId = sub.metadata?.fromPlanId;
        await email(userId, tiers.find((t,) => t.id === fromId,) ?? tiers.find((t,) => t.isFree,) ?? null, tiers.find((t,) => t.id === row.plan_id,) ?? null, 'Your subscription is active. Thank you for your support!',);
    }
    return { result: 'changed', current: await current(userId,), };
}

/** Undo a scheduled cancellation. */
export async function resume(userId: string,): Promise<MembershipChangeResponse> {
    const local = await activeLocalSub(userId,);
    if (!local?.stripe_subscription_id || !local.cancel_at_period_end) return { result: 'unchanged', current: await current(userId,), };
    const stripe = getStripeClient('default',);
    if (!stripe) throw new ValidationError('Payments are not configured.',);
    await stripe.subscriptions.update(local.stripe_subscription_id, { cancel_at_period_end: false, },);
    await query(`UPDATE subscriptions SET cancel_at_period_end = false, updated_at = NOW() WHERE id = $1`, [local.id,],);
    return { result: 'changed', current: await current(userId,), };
}
