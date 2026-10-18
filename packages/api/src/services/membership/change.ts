/** Preview + CHANGE a membership (free → paid, paid → paid, → free), confirm, resume, cancel. */
import type Stripe from 'stripe';
import type { MembershipChangeResponse, MembershipCurrent, MembershipPreviewResponse, MembershipTierOption, } from '@sitesurge/types';
import { billingFrequency, formatMoney, isUpgrade, } from '@sitesurge/types';
import { NotFoundError, ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { sendPurposeMail, } from '../mail/purposes';
import { getPaymentProvider, } from '../payment';
import { getStripeClient, } from '../payment/stripe';
import { subscriptionPeriod, } from '../payment/stripeCompat';
import { createCustomer, } from '../payments';
import { ENTITLED_STATUSES, } from '../permissions';
import { syncUserRole, } from '../subscriptionTiers';
import { getPolicy as getSubscriptionPolicy, } from '../subscriptionAccess';
import { seesDevOnly, tierOptions, withPrice, } from './catalog';
import { activeLocalSub, current, loadCurrent, type LocalSub, } from './current';
import { settleOpenAttempts, } from './attempts';
import { approvedOfferFor, markApplicationStarted, } from './state';

// ─── Preview ─────────────────────────────────────────────────────────────

export interface TargetTier {
    cur: MembershipCurrent;
    tiers: MembershipTierOption[];
    to: MembershipTierOption;
    from: MembershipTierOption | null;
    billingOnly: boolean;
    local: LocalSub | null;
    sub: Stripe.Subscription | null;
}

export async function targetTier(userId: string, tierId: string, opts: { approved?: boolean; priceId?: string | null; } = {},): Promise<TargetTier> {
    const offer = await approvedOfferFor(userId,);
    const ctx = await loadCurrent(userId, { approvedTierId: offer?.tierId, },);
    const { cur, tiers, } = ctx;
    const found = tiers.find((t,) => t.id === tierId,);
    if (!found) throw new NotFoundError('Membership',);
    // An APPROVED application (hide-price levels) is the approval: buying it is allowed.
    if (offer?.tierId === tierId) opts = { ...opts, approved: true, };
    if (found.devOnly && !found.isCurrent && !opts.approved && !(await seesDevOnly(userId,))) throw new NotFoundError('Membership',);
    // The chosen price (default when omitted). Same level at ANOTHER price is a
    // change (e.g. monthly → yearly), not "current".
    const priced = withPrice(found, opts.priceId,);
    const samePrice = !cur.priceId || !priced.selectedPriceId || cur.priceId === priced.selectedPriceId;
    const to = { ...priced, isCurrent: found.isCurrent && samePrice, };
    // A level that requires approval is joined by APPLYING; only an approval
    // (startApprovedMembership) moves a member onto it.
    // Gate on the LEVEL, not the price: a member already on it may change
    // billing (monthly ↔ yearly) without applying again.
    if (to.requiresApproval && !found.isCurrent && !opts.approved) {
        throw new ValidationError(`${to.name} requires an application — choose Apply and an admin will review it.`,);
    }
    // Subscription-required mode: below-minimum paid tiers are not for sale
    // (Free stays reachable — it is how a member cancels).
    const policy = await getSubscriptionPolicy();
    if (policy.required && !to.isFree && !to.isCurrent && !to.devOnly && (to.rank ?? 0) < policy.minimumRank) {
        throw new ValidationError('That membership level is not available.',);
    }
    if (!to.isFree && !to.isCurrent) {
        const row = await query<{ stripe_price_id: string | null; }>(`SELECT stripe_price_id FROM subscription_plans WHERE id = $1`, [tierId,],);
        if (!row.rows[0]?.stripe_price_id) throw new ValidationError('That membership is not available to buy yet.',);
    }
    const fromBase = tiers.find((t,) => t.isCurrent,) ?? null;
    const from = fromBase && cur.priceId && fromBase.prices?.some((p,) => p.priceId === cur.priceId,) ? withPrice(fromBase, cur.priceId,) : fromBase;
    return { cur, tiers, to, from, billingOnly: found.isCurrent && !samePrice, local: ctx.local, sub: ctx.sub, };
}

export async function preview(userId: string, tierId: string, priceId?: string | null,): Promise<MembershipPreviewResponse> {
    const { cur, to, from, billingOnly, local, sub: liveSub, } = await targetTier(userId, tierId, { priceId, },);
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
    // Already retrieved by loadCurrent (one Stripe call per request).
    const sub = liveSub ?? await stripe.subscriptions.retrieve(local.stripe_subscription_id,);
    const newPrice = to.selectedPriceId!;
    const inv = await stripe.invoices.createPreview({
        customer: typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
        subscription: sub.id,
        subscription_details: {
            items: [{ id: sub.items.data[0]!.id, price: newPrice, },],
            proration_behavior: 'always_invoice',
            proration_date: Math.floor(Date.now() / 1000,),
        },
    },);
    const due = Math.max(0, inv.amount_due,);
    const credit = inv.total < 0 ? -inv.total : 0;
    // Per month, so $25/month → $250/year is not an "upgrade".
    const direction = billingOnly ? 'billing' : isUpgrade(priceOf(to,)!, priceOf(from,),) ? 'upgrade' : 'downgrade';
    return {
        ...base, direction, amountDueNow: due, creditAfter: credit,
        effective: 'now', effectiveDate: new Date().toISOString(),
        nextDate: new Date(subscriptionPeriod(sub,).end * 1000,).toISOString(),
        requiresPayment: false,
    };
}

// ─── Change ──────────────────────────────────────────────────────────────

/** "monthly", "yearly", "every 3 months" (the shared `billingFrequency`). */
export const frequency = billingFrequency;

/** Price of an option for the direction maths. */
const priceOf = (t: MembershipTierOption | null,) => (t ? { amount: t.priceCents, interval: t.interval || 'month', intervalCount: t.intervalCount, } : null);

async function email(userId: string, from: MembershipTierOption | null, to: MembershipTierOption | null, note: string,) {
    const u = await query<{ email: string; display_name: string | null; }>(`SELECT email, display_name FROM users WHERE id = $1`, [userId,],);
    const user = u.rows[0];
    if (!user) return;
    const describe = (t: MembershipTierOption | null,) => t
        ? {
            name: t.name, description: t.description ?? '',
            // The price members were shown (custom display when set).
            price: t.isFree ? 'Free' : formatMoney(t.display?.priceCents ?? t.priceCents, t.currency,),
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

export async function change(userId: string, tierId: string, opts: { approved?: boolean; priceId?: string | null; } = {},): Promise<MembershipChangeResponse> {
    const { cur, to, from, billingOnly, local, sub: liveSub, } = await targetTier(userId, tierId, opts,);
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
    // The chosen price (validated against the level's product in targetTier).
    const priceId = to.selectedPriceId!;

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
        // Without the secret the browser cannot pay; never let that read as a change.
        if (!sub.clientSecret) {
            logger.error('membership: Stripe returned no payment secret for a new subscription', { subscriptionId: sub.id, },);
            throw new ValidationError('The payment could not be started. Nothing was charged — please try again.',);
        }
        return { result: 'payment_required', clientSecret: sub.clientSecret, subscriptionId: sub.id, current: cur, };
    }

    // paid → paid: immediate switch with proration.
    const sub = liveSub ?? await stripe.subscriptions.retrieve(local.stripe_subscription_id,);
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
    await markApplicationStarted(userId, to.id,);
    const direction = isUpgrade(priceOf(to,)!, priceOf(from,),) ? 'upgraded' : 'changed';
    await email(userId, from, to, billingOnly
        ? `Your ${to.name} billing changed to ${frequency(to.interval, to.intervalCount,)} today. Any unused time on your previous billing was credited.`
        : `Your membership was ${direction} today. Any unused time on your previous plan was credited against the new one.`,);
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
    await markApplicationStarted(userId, row.plan_id,);
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

