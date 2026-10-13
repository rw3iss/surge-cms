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
    MembershipCardResponse, MembershipCardSetupResponse, MembershipFailedAttempt, MembershipPendingApplication,
    MembershipChangeResponse, MembershipCurrent, MembershipPreviewResponse, MembershipPublicTiersResponse, MembershipResponse, MembershipTierOption,
} from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../core/errors';
import { query, } from '../db';
import { logger, } from '../utils/logger';
import { sendPurposeMail, } from './mail/purposes';
import { getPaymentProvider, } from './payment';
import { getStripeClient, } from './payment/stripe';
import { cache, CACHE_KEYS, } from './cache';
import { invoiceClientSecret, subscriptionPeriod, } from './payment/stripeCompat';
import { createCustomer, } from './payments';
import { ENTITLED_STATUSES, } from './permissions';
import { listTiers, stripePrices, syncUserRole, userSubscription, } from './subscriptionTiers';
import { getPolicy as getSubscriptionPolicy, type SubscriptionPolicy, } from './subscriptionAccess';

// ─── Tier catalogue (with Stripe amounts) ────────────────────────────────

type PriceDetail = { amount: number; currency: string; interval: string; intervalCount: number; productDescription: string | null; };

/**
 * Stripe price amounts/intervals + product descriptions, by price id. Cached
 * in Redis for an hour (shared by every server process) and cleared whenever a
 * subscription tier is saved or deleted (`cache.invalidateMembershipCache`),
 * so a changed Stripe price or description shows up after a tier save, or
 * within the hour otherwise.
 */
async function priceDetails(): Promise<Map<string, PriceDetail>> {
    const cached = await cache.get<Record<string, PriceDetail>>(CACHE_KEYS.membershipStripePrices,);
    if (cached) return new Map(Object.entries(cached,),);
    const byId = new Map<string, PriceDetail>();
    const stripe = getStripeClient('default',);
    let ok = true;
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
            ok = false;
            logger.warn('membership: stripe prices failed', { error: (e as Error).message, },);
        }
    }
    // Do not pin a failed fetch for an hour.
    if (ok) await cache.set(CACHE_KEYS.membershipStripePrices, Object.fromEntries(byId,), 3600,);
    return byId;
}
void stripePrices; // (admin listing lives in subscriptionTiers)

/** Free first, then purchasable tiers by price. */
/** Published application forms' slugs, by form id (tiers that require approval). */
async function applicationFormSlugs(ids: string[],): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const r = await query<{ id: string; slug: string; }>(`SELECT id, slug FROM forms WHERE id = ANY($1) AND status = 'published'`, [ids,],);
    return new Map(r.rows.map((f,) => [f.id, f.slug,]),);
}

/** A member's open (pending) membership application, if any. */
export async function pendingApplicationFor(userId: string | null,): Promise<MembershipPendingApplication | null> {
    if (!userId) return null;
    const r = await query<{ id: string; plan_id: string; name: string; created_at: Date; has_card: boolean; }>(
        `SELECT a.id, a.plan_id, p.name, a.created_at, (a.payment_method_id IS NOT NULL) AS has_card FROM membership_applications a
           JOIN subscription_plans p ON p.id = a.plan_id
          WHERE a.user_id = $1 AND a.status = 'pending' LIMIT 1`,
        [userId,],
    ).catch(() => ({ rows: [], }),);
    const a = r.rows[0];
    return a ? { id: a.id, tierId: a.plan_id, tierName: a.name, createdAt: new Date(a.created_at,).toISOString(), hasCard: a.has_card, } : null;
}

async function tierOptions(currentTierId: string | null, pendingTierId: string | null = null,): Promise<MembershipTierOption[]> {
    const prices = await priceDetails();
    const out: MembershipTierOption[] = [];
    const all = await listTiers();
    const formSlugs = await applicationFormSlugs(all.flatMap((t,) => (t.requiresApproval && t.applicationFormId ? [t.applicationFormId,] : [])),);
    for (const t of all) {
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
            intervalCount: p?.intervalCount ?? t.intervalCount ?? 1,
            display: t.isFree ? null : t.displayPrice ?? null,
            requiresApproval: !t.isFree && t.requiresApproval,
            applicationFormSlug: t.requiresApproval && t.applicationFormId ? formSlugs.get(t.applicationFormId,) ?? null : null,
            isPending: !!pendingTierId && t.id === pendingTierId,
            isCurrent: t.id === currentTierId,
            rank: t.sortOrder,
        },);
    }
    return out.sort((a, b,) => Number(b.isFree,) - Number(a.isFree,) || a.priceCents - b.priceCents);
}

/**
 * The public tier catalogue for `/subscribe`: every active tier (free first,
 * then paid by price) with its price and description — the tier's own
 * description, else the Stripe product's. `isCurrent` marks the signed-in
 * viewer's tier; `paidAvailable` is false when the site only has free tiers.
 */
export async function publicTiers(userId: string | null,): Promise<MembershipPublicTiersResponse> {
    let currentId: string | null = null;
    if (userId) {
        try {
            currentId = (await userSubscription(userId,)).tier?.id ?? null;
        } catch { /* signed-in but no tier row → free */ }
    }
    const policy = await getSubscriptionPolicy();
    const pending = await pendingApplicationFor(userId,);
    const tiers = offered(await tierOptions(currentId, pending?.tierId ?? null,), policy,);
    return {
        tiers, paidAvailable: tiers.some((t,) => !t.isFree), signedIn: !!userId, subscriptionRequired: policy.required,
        pendingApplication: pending,
    };
}

/**
 * The tiers a member may CHOOSE. Subscription-required mode hides Free (kept,
 * still usable to cancel) and paid tiers below the minimum — except the
 * member's current tier, so they can still see what they have.
 */
function offered(tiers: MembershipTierOption[], policy: SubscriptionPolicy,): MembershipTierOption[] {
    if (!policy.required) return tiers;
    return tiers.filter((t,) => t.isCurrent ? !t.isFree : !t.isFree && (t.rank ?? 0) >= policy.minimumRank);
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
        intervalCount: opt && !opt.isFree ? opt.intervalCount : undefined,
        display: opt && !opt.isFree ? opt.display ?? null : null,
        currentPeriodEnd: info.currentPeriodEnd,
        cancelAtPeriodEnd: info.cancelAtPeriodEnd,
        card: await cardFor(local?.stripe_subscription_id ?? null,),
    };
}

export async function overview(userId: string,): Promise<MembershipResponse> {
    const cur = await current(userId,);
    const policy = await getSubscriptionPolicy();
    const pending = await pendingApplicationFor(userId,);
    return {
        current: cur, tiers: offered(await tierOptions(cur.tier?.id ?? null, pending?.tierId ?? null,), policy,),
        subscriptionRequired: policy.required, pendingApplication: pending,
        lastFailedAttempt: cur.tier && !cur.tier.isFree ? null : await lastFailedAttempt(userId,),
    };
}

// ─── Preview ─────────────────────────────────────────────────────────────

async function targetTier(userId: string, tierId: string, opts: { approved?: boolean; } = {},) {
    const cur = await current(userId,);
    const tiers = await tierOptions(cur.tier?.id ?? null,);
    const to = tiers.find((t,) => t.id === tierId,);
    if (!to) throw new NotFoundError('Membership',);
    // A level that requires approval is joined by APPLYING; only an approval
    // (startApprovedMembership) moves a member onto it.
    if (to.requiresApproval && !to.isCurrent && !opts.approved) {
        throw new ValidationError(`${to.name} requires an application — choose Apply and an admin will review it.`,);
    }
    // Subscription-required mode: below-minimum paid tiers are not for sale
    // (Free stays reachable — it is how a member cancels).
    const policy = await getSubscriptionPolicy();
    if (policy.required && !to.isFree && !to.isCurrent && (to.rank ?? 0) < policy.minimumRank) {
        throw new ValidationError('That membership level is not available.',);
    }
    if (!to.isFree && !to.isCurrent) {
        const row = await query<{ stripe_price_id: string | null; }>(`SELECT stripe_price_id FROM subscription_plans WHERE id = $1`, [tierId,],);
        if (!row.rows[0]?.stripe_price_id) throw new ValidationError('That membership is not available to buy yet.',);
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
            // The price members were shown (custom display when set).
            price: t.isFree ? 'Free' : `${((t.display?.priceCents ?? t.priceCents) / 100).toFixed(2,)} ${t.currency.toUpperCase()}`,
            frequency: t.isFree ? '' : t.display ? frequency(t.display.interval, t.display.intervalCount,) : frequency(t.interval, t.intervalCount,),
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

export async function change(userId: string, tierId: string, opts: { approved?: boolean; } = {},): Promise<MembershipChangeResponse> {
    const { cur, to, from, } = await targetTier(userId, tierId, opts,);
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
            const required = (await getSubscriptionPolicy()).required;
            await email(userId, from, to, required
                ? `Your ${from?.name ?? ''} membership stays active until ${ends}. You will not be charged again; after that date you will need to become a member again to keep access.`
                : `Your ${from?.name ?? ''} membership stays active until ${ends}, then your account moves to the free plan. You will not be charged again.`,);
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

    // free (or hand-assigned) → paid: a new Stripe subscription — after settling
    // earlier unpaid attempts (reuse the same level's, cancel the rest).
    if (!local?.stripe_subscription_id) {
        const open = await settleOpenAttempts(userId, { tierId: to.id, priceId, },);
        if (open.activated) return confirm(userId, open.activated,);
        if (open.reuse) {
            return { result: 'payment_required', clientSecret: open.reuse.clientSecret, subscriptionId: open.reuse.subscriptionId, current: cur, };
        }
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
    await email(userId, from, to, `Your membership was ${direction} today. Any unused time on your previous plan was credited against the new one.`,);
    return { result: 'changed', current: await current(userId,), };
}

/** After the browser confirmed the first payment of a new subscription. */
export async function confirm(userId: string, stripeSubscriptionId: string,): Promise<MembershipChangeResponse> {
    const r = await query<{ id: string; plan_id: string; status: string; }>(
        `SELECT id, plan_id, status FROM subscriptions WHERE user_id = $1 AND stripe_subscription_id = $2`,
        [userId, stripeSubscriptionId,],
    );
    const row = r.rows[0];
    if (!row) throw new NotFoundError('Membership',);
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
        await email(userId, tiers.find((t,) => t.id === fromId,) ?? tiers.find((t,) => t.isFree,) ?? null, tiers.find((t,) => t.id === row.plan_id,) ?? null, 'Your membership is active. Thank you for your support!',);
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

// ─── Cancel (subscription-required mode hides Free, so it gets its own call) ──

/** Cancel the paid subscription at the end of the period already paid for. */
export async function cancel(userId: string,): Promise<MembershipChangeResponse> {
    const free = await query<{ id: string; }>(`SELECT id FROM subscription_plans WHERE is_free = true ORDER BY sort_order LIMIT 1`,);
    if (!free.rows[0]) throw new ValidationError('There is no plan to move to.',);
    return change(userId, free.rows[0].id,);
}

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
            sub = await stripe.subscriptions.retrieve(row.stripe_subscription_id, { expand: ['latest_invoice.payment_intent',], },);
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

/** The member's latest unpaid attempt (no active membership), for the "your payment did not go through" notices. */
export async function lastFailedAttempt(userId: string,): Promise<MembershipFailedAttempt | null> {
    const r = await query<{ plan_id: string; name: string; status: string; created_at: Date; }>(
        `SELECT s.plan_id, p.name, s.status, s.created_at FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
          WHERE s.user_id = $1 AND p.is_free = false AND s.status IN ('incomplete', 'incomplete_expired', 'unpaid', 'past_due')
            AND s.created_at > NOW() - INTERVAL '60 days'
            AND NOT EXISTS (SELECT 1 FROM subscriptions a WHERE a.user_id = s.user_id AND a.status IN ('active', 'trialing'))
          ORDER BY s.created_at DESC LIMIT 1`,
        [userId,],
    ).catch(() => ({ rows: [], }),);
    const a = r.rows[0];
    return a ? { tierId: a.plan_id, tierName: a.name, status: a.status, createdAt: new Date(a.created_at,).toISOString(), } : null;
}

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
export async function startApprovedMembership(userId: string, tierId: string, paymentMethodId: string | null,): Promise<MembershipChangeResponse> {
    const local = await activeLocalSub(userId,);
    if (local?.stripe_subscription_id) return change(userId, tierId, { approved: true, },);

    const { to, from, } = await targetTier(userId, tierId, { approved: true, },);
    if (to.isCurrent) return { result: 'unchanged', current: await current(userId,), };
    // An approval starts billing off-session: earlier unpaid attempts are cancelled first.
    await settleOpenAttempts(userId, null,);
    const stripe = getStripeClient('default',);
    if (!stripe) throw new ValidationError('Payments are not configured.',);
    const priceId = (await query<{ stripe_price_id: string; }>(`SELECT stripe_price_id FROM subscription_plans WHERE id = $1`, [to.id,],)).rows[0]!.stripe_price_id;
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
            items: [{ price: priceId, },],
            default_payment_method: pm,
            off_session: true,
            payment_behavior: 'error_if_incomplete',
            metadata: { userId, planId: to.id, type: 'membership', fromPlanId: from?.id ?? '', approved: 'true', },
        },);
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

// ─── Payment card ────────────────────────────────────────────────────────

/** The member's Stripe customer: from their membership subscription, else a new one. */
async function customerFor(userId: string,): Promise<string> {
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

