/**
 * The tier CATALOGUE: Stripe prices (cached), each level's price options, the
 * levels a viewer may choose (`offered`: hidden levels, subscription-required
 * minimum) and the public /subscribe list.
 */
import type { MembershipPriceOption, MembershipPublicTiersResponse, MembershipTierOption, } from '@sitesurge/types';
import { perMonthCents, } from '@sitesurge/types';
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { cache, CACHE_KEYS, } from '../cache';
import { listRecurringPrices, } from '../payment/recurringPrices';
import { listTiers, userSubscription, } from '../subscriptionTiers';
import { getPolicy as getSubscriptionPolicy, type SubscriptionPolicy, } from '../subscriptionAccess';
import { approvedOfferFor, pendingApplicationFor, } from './state';

// ─── Tier catalogue (with Stripe amounts) ────────────────────────────────

type PriceDetail = { amount: number; currency: string; interval: string; intervalCount: number; productDescription: string | null; productId: string | null; };

/**
 * Stripe price amounts/intervals + product descriptions, by price id. Cached
 * in Redis for an hour (shared by every server process) and cleared whenever a
 * subscription tier is saved or deleted (`cache.invalidateMembershipCache`),
 * so a changed Stripe price or description shows up after a tier save, or
 * within the hour otherwise.
 */
export async function priceDetails(): Promise<Map<string, PriceDetail>> {
    const cached = await cache.get<Record<string, PriceDetail>>(CACHE_KEYS.membershipStripePrices,);
    if (cached) return new Map(Object.entries(cached,),);
    const byId = new Map<string, PriceDetail>();
    let ok = true;
    try {
        for (const p of await listRecurringPrices()) {
            byId.set(p.priceId, {
                amount: p.unitAmount ?? 0, currency: p.currency, interval: p.interval, intervalCount: p.intervalCount,
                productDescription: p.productDescription, productId: p.productId,
            },);
        }
    } catch (e) {
        ok = false;
        logger.warn('membership: stripe prices failed', { error: (e as Error).message, },);
    }
    // Do not pin a failed fetch for an hour.
    if (ok) await cache.set(CACHE_KEYS.membershipStripePrices, Object.fromEntries(byId,), 3600,);
    return byId;
}

/** A price's monthly-equivalent cost, for ordering alternatives. */
export const perMonth = perMonthCents;

/**
 * The level option re-priced to one of its `prices` (the default when
 * `priceId` is omitted). Unknown price → ValidationError: a client cannot buy a
 * level at a price that is not on its product.
 */
export function withPrice(t: MembershipTierOption, priceId?: string | null,): MembershipTierOption {
    if (t.isFree || !t.prices?.length) return t;
    const price = priceId ? t.prices.find((x,) => x.priceId === priceId,) : t.prices.find((x,) => x.isDefault,) ?? t.prices[0];
    if (!price) throw new ValidationError('That price is not available for this membership.',);
    return {
        ...t, priceCents: price.amount, currency: price.currency, interval: price.interval, intervalCount: price.intervalCount,
        selectedPriceId: price.priceId,
        // A custom display price describes the DEFAULT price only.
        display: price.isDefault ? t.display : null,
    };
}

/** Refuse a price that is not one of the level's (null/undefined = default, always fine). */
export async function assertTierPrice(tierId: string, priceId?: string | null,): Promise<void> {
    if (!priceId) return;
    const t = (await tierOptions(null,)).find((x,) => x.id === tierId,);
    if (!t || !t.prices?.some((p,) => p.priceId === priceId,)) throw new ValidationError('That price is not available for this membership.',);
}

/** Free first, then purchasable tiers by price. */
/** Published application forms' slugs, by form id (tiers that require approval). */
async function applicationFormSlugs(ids: string[],): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const r = await query<{ id: string; slug: string; }>(`SELECT id, slug FROM forms WHERE id = ANY($1) AND status = 'published'`, [ids,],);
    return new Map(r.rows.map((f,) => [f.id, f.slug,]),);
}

export async function tierOptions(currentTierId: string | null, pendingTierId: string | null = null, approvedTierId: string | null = null,): Promise<MembershipTierOption[]> {
    const prices = await priceDetails();
    const out: MembershipTierOption[] = [];
    const all = await listTiers();
    const formSlugs = await applicationFormSlugs(all.flatMap((t,) => (t.requiresApproval && t.applicationFormId ? [t.applicationFormId,] : [])),);
    for (const t of all) {
        if (!t.isActive && t.id !== currentTierId) continue;
        if (!t.isFree && !t.stripePriceId && t.id !== currentTierId) continue; // not purchasable
        const p = t.stripePriceId ? prices.get(t.stripePriceId,) : undefined;
        // Every active recurring price on the level's Stripe product: its own
        // (default) price first, then the others by monthly cost.
        const productId = t.stripeProductId ?? p?.productId ?? null;
        const priceList: MembershipPriceOption[] = [];
        if (!t.isFree && t.stripePriceId) {
            priceList.push({
                priceId: t.stripePriceId, amount: p?.amount ?? t.priceCents, currency: p?.currency ?? 'usd',
                interval: p?.interval ?? t.interval, intervalCount: p?.intervalCount ?? t.intervalCount ?? 1, isDefault: true,
            },);
            if (productId) {
                const others = [...prices.entries(),]
                    .filter(([id, d,],) => id !== t.stripePriceId && d.productId === productId)
                    .map(([id, d,],): MembershipPriceOption => ({ priceId: id, amount: d.amount, currency: d.currency, interval: d.interval, intervalCount: d.intervalCount, isDefault: false, }));
                priceList.push(...others.sort((a, b,) => perMonth(a,) - perMonth(b,)),);
            }
        }
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
            prices: priceList,
            selectedPriceId: t.isFree ? null : t.stripePriceId ?? null,
            isApproved: !!approvedTierId && t.id === approvedTierId,
            requiresApproval: !t.isFree && t.requiresApproval,
            hiddenFromTiers: t.hiddenFromTiers === true,
            devOnly: t.hiddenFromTiers === true,
            applicationFormSlug: t.requiresApproval && t.applicationFormId ? formSlugs.get(t.applicationFormId,) ?? null : null,
            isPending: !!pendingTierId && t.id === pendingTierId,
            isCurrent: t.id === currentTierId,
            rank: t.sortOrder,
        },);
    }
    // "Hide price" approval levels: no price anywhere until the viewer is
    // approved for it (or already on it). Sorted by the real price first so
    // the order does not change when the price appears.
    const sorted = out.sort((a, b,) => Number(b.isFree,) - Number(a.isFree,) || a.priceCents - b.priceCents);
    const hidden = new Set(all.filter((t,) => t.requiresApproval && t.hidePrice,).map((t,) => t.id,),);
    return sorted.map((o,) => hidden.has(o.id,) && !o.isCurrent && !o.isApproved
        ? { ...o, priceHidden: true, priceCents: 0, prices: [], display: null, selectedPriceId: null, interval: '', intervalCount: 1, }
        : o);
}

/**
 * The public tier catalogue for `/subscribe`: every active tier (free first,
 * then paid by price) with its price and description — the tier's own
 * description, else the Stripe product's. `isCurrent` marks the signed-in
 * viewer's tier; `paidAvailable` is false when the site only has free tiers.
 */
export async function publicTiers(userId: string | null, levels?: string[],): Promise<MembershipPublicTiersResponse> {
    let currentId: string | null = null;
    if (userId) {
        try {
            currentId = (await userSubscription(userId,)).tier?.id ?? null;
        } catch { /* signed-in but no tier row → free */ }
    }
    const policy = await getSubscriptionPolicy();
    const [pending, approved,] = await Promise.all([pendingApplicationFor(userId,), approvedOfferFor(userId,),],);
    const all = await tierOptions(currentId, pending?.tierId ?? null, approved?.tierId ?? null,);
    // `levels`: exactly the named levels, in that order — hidden ones included
    // (a page that features specific levels, e.g. partner programs). Hidden
    // levels stay unbuyable without approval (`targetTier`); applying is open.
    const tiers = levels?.length
        ? levels.map((slug,) => all.find((t,) => t.slug === slug,),).filter((t,): t is MembershipTierOption => !!t,)
        : offered(all, policy,);
    return {
        tiers, paidAvailable: tiers.some((t,) => !t.isFree), signedIn: !!userId, subscriptionRequired: policy.required,
        pendingApplication: pending, approvedOffer: approved,
    };
}

/**
 * The tiers a member may CHOOSE. Subscription-required mode hides Free (kept,
 * still usable to cancel) and paid tiers below the minimum — except the
 * member's current tier, so they can still see what they have.
 */
export function offered(tiers: MembershipTierOption[], policy: SubscriptionPolicy,): MembershipTierOption[] {
    // "Hide from subscription tiers": not offered to anyone — except a member
    // already on it, or approved for it (their application's offer).
    tiers = tiers.filter((t,) => !t.hiddenFromTiers || t.isCurrent || t.isApproved,);
    if (!policy.required) return tiers;
    // A hidden level (e.g. a test level at a token price) is exempt from the minimum.
    return tiers.filter((t,) => t.isCurrent ? !t.isFree : !t.isFree && (t.hiddenFromTiers || (t.rank ?? 0) >= policy.minimumRank));
}

