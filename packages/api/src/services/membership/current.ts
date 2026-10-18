/** The member's CURRENT membership (one read of everything a request needs: `loadCurrent`). */
import type Stripe from 'stripe';
import type { MembershipCurrent, MembershipResponse, MembershipTierOption, } from '@sitesurge/types';
import { query, } from '../../db';
import { getStripeClient, } from '../payment/stripe';
import { ENTITLED_STATUSES, } from '../permissions';
import { userSubscription, } from '../subscriptionTiers';
import { getPolicy as getSubscriptionPolicy, } from '../subscriptionAccess';
import { offered, seesDevOnly, tierOptions, withPrice, } from './catalog';
import { approvedOfferFor, lastFailedAttempt, pendingApplicationFor, } from './state';

// ─── Current ─────────────────────────────────────────────────────────────

export interface LocalSub {
    id: string;
    plan_id: string;
    stripe_subscription_id: string | null;
    status: string;
    current_period_end: Date | null;
    cancel_at_period_end: boolean;
}

export async function activeLocalSub(userId: string,): Promise<LocalSub | null> {
    const r = await query<LocalSub>(
        `SELECT id, plan_id, stripe_subscription_id, status, current_period_end, cancel_at_period_end
           FROM subscriptions WHERE user_id = $1 AND status = ANY($2) ORDER BY created_at DESC LIMIT 1`,
        [userId, ENTITLED_STATUSES,],
    );
    return r.rows[0] ?? null;
}

/** The member's Stripe subscription (card expanded), or null. One retrieve per request — see `loadCurrent`. */
export async function retrieveSub(stripeSubId: string | null,): Promise<Stripe.Subscription | null> {
    const stripe = getStripeClient('default',);
    if (!stripe || !stripeSubId) return null;
    try {
        return await stripe.subscriptions.retrieve(stripeSubId, { expand: ['default_payment_method',], },);
    } catch {
        return null;
    }
}

/** The card + the price of a member's Stripe subscription. */
function subDetails(sub: Stripe.Subscription | null,): { card: MembershipCurrent['card']; priceId: string | null; } {
    if (!sub) return { card: null, priceId: null, };
    const pm = sub.default_payment_method as Stripe.PaymentMethod | null;
    return { card: pm?.card ? { brand: pm.card.brand, last4: pm.card.last4, } : null, priceId: sub.items.data[0]?.price?.id ?? null, };
}

/**
 * Everything one membership request needs about the member, read ONCE:
 * the current state, the tier catalogue (with the viewer's pending/approved
 * flags), the local subscription row and the Stripe subscription. Before,
 * `preview` read the catalogue twice and retrieved the Stripe subscription
 * twice (each retrieve ≈ 300 ms, and close to Stripe's rate limit under load).
 */
export interface CurrentCtx {
    cur: MembershipCurrent;
    tiers: MembershipTierOption[];
    local: LocalSub | null;
    sub: Stripe.Subscription | null;
}

export async function loadCurrent(userId: string, flags: { pendingTierId?: string | null; approvedTierId?: string | null; } = {},): Promise<CurrentCtx> {
    const [info, user, local,] = await Promise.all([
        userSubscription(userId,),
        query<{ role: string; role_label: string | null; extra: Array<{ key: string; label: string; }> | null; }>(
            `SELECT u.role, r.label AS role_label,
                    (SELECT json_agg(json_build_object('key', x.k, 'label', COALESCE(rx.label, x.k)) ORDER BY x.ord)
                       FROM unnest(u.extra_roles) WITH ORDINALITY AS x(k, ord) LEFT JOIN roles rx ON rx.key = x.k) AS extra
               FROM users u LEFT JOIN roles r ON r.key = u.role WHERE u.id = $1`,
            [userId,],
        ),
        activeLocalSub(userId,),
    ],);
    const [tiers, sub,] = await Promise.all([
        tierOptions(info.tier?.id ?? null, flags.pendingTierId ?? null, flags.approvedTierId ?? null,),
        retrieveSub(local?.stripe_subscription_id ?? null,),
    ],);
    const details = subDetails(sub,);
    const base = tiers.find((t,) => t.isCurrent,);
    // Describe the price they actually pay (e.g. the yearly one), not just the default.
    const opt = base && details.priceId && base.prices?.some((p,) => p.priceId === details.priceId,) ? withPrice(base, details.priceId,) : base;
    const cur: MembershipCurrent = {
        tier: info.tier ? { id: info.tier.id, slug: info.tier.slug, name: info.tier.name, description: opt?.description ?? null, isFree: info.tier.isFree, } : null,
        role: user.rows[0]?.role ?? 'member',
        roleLabel: user.rows[0]?.role_label ?? undefined,
        extraRoles: user.rows[0]?.extra ?? [],
        status: info.status,
        source: info.source,
        priceCents: opt?.priceCents ?? 0,
        currency: opt?.currency ?? 'usd',
        interval: opt && !opt.isFree ? opt.interval : null,
        intervalCount: opt && !opt.isFree ? opt.intervalCount : undefined,
        display: opt && !opt.isFree ? opt.display ?? null : null,
        currentPeriodEnd: info.currentPeriodEnd,
        cancelAtPeriodEnd: info.cancelAtPeriodEnd,
        ...details,
    };
    return { cur, tiers, local, sub, };
}

export async function current(userId: string,): Promise<MembershipCurrent> {
    return (await loadCurrent(userId,)).cur;
}

export async function overview(userId: string,): Promise<MembershipResponse> {
    const [policy, pending, approved, seesDev,] = await Promise.all([
        getSubscriptionPolicy(), pendingApplicationFor(userId,), approvedOfferFor(userId,), seesDevOnly(userId,),
    ],);
    const { cur, tiers: all, } = await loadCurrent(userId, { pendingTierId: pending?.tierId, approvedTierId: approved?.tierId, },);
    const tiers = all.map((t,) => t.isCurrent ? { ...t, currentPriceId: cur.priceId ?? t.selectedPriceId ?? null, } : t);
    return {
        current: cur, tiers: offered(tiers, policy, seesDev,),
        subscriptionRequired: policy.required, pendingApplication: pending, approvedOffer: approved,
        lastFailedAttempt: cur.tier && !cur.tier.isFree ? null : await lastFailedAttempt(userId,),
    };
}

