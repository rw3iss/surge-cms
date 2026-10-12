/**
 * Subscription-required mode (Users → Settings → "Require a paid subscription").
 *
 * When on:
 *  - registration asks for a plan + payment; the account is created first and
 *    signed in RESTRICTED so it can pay (a failed payment leaves it restricted);
 *  - a signed-in member is RESTRICTED until they hold an active subscription
 *    at the minimum tier (rank = `subscription_plans.sort_order`) or above,
 *    and — when email verification is on — have verified their email;
 *  - the Free tier is hidden and stops counting: post / forum gating treat a
 *    member without a paid tier like a visitor with no tier.
 * Staff are never restricted. The SPA reads `access` from GET /auth/me and
 * walls every route except subscribe / profile / account pages and pages
 * marked "Open without a subscription".
 */
import { isStaffRole, type MemberAccessState, } from '@sitesurge/types';
import { ValidationError, } from '../core/errors';
import { query, } from '../db';
import { getUsersSettings, } from './settings';

export interface SubscriptionPolicy {
    required: boolean;
    /** Lowest rank that counts (the minimum tier's rank, else the cheapest paid tier's). */
    minimumRank: number;
    minimumTierId: string | null;
    requireEmailVerification: boolean;
}

export type AccessState = MemberAccessState;
type AccessReason = NonNullable<MemberAccessState['reason']>;

const ENTITLED = ['active', 'trialing', 'past_due',];

export async function getPolicy(): Promise<SubscriptionPolicy> {
    const s = await getUsersSettings();
    const required = s.requireSubscription === true;
    let minimumRank = 1;
    if (required) {
        const r = await query<{ rank: number; }>(
            s.minimumTierId
                ? `SELECT sort_order AS rank FROM subscription_plans WHERE id = $1`
                : `SELECT MIN(sort_order) AS rank FROM subscription_plans WHERE is_free = false AND is_active IS NOT FALSE AND stripe_price_id IS NOT NULL`,
            s.minimumTierId ? [s.minimumTierId,] : [],
        );
        minimumRank = Math.max(1, Number(r.rows[0]?.rank ?? 1,),);
    }
    return { required, minimumRank, minimumTierId: s.minimumTierId ?? null, requireEmailVerification: s.requireEmailVerification, };
}

/** Does the user hold an active paid subscription at `minimumRank` or above? */
export async function hasQualifyingSubscription(userId: string, minimumRank: number,): Promise<boolean> {
    const r = await query(
        `SELECT 1 FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
          WHERE s.user_id = $1 AND s.status = ANY($2) AND p.is_free = false AND p.sort_order >= $3 LIMIT 1`,
        [userId, ENTITLED, minimumRank,],
    );
    return r.rows.length > 0;
}

export async function accessState(user: { id: string; role?: string | null; emailVerified?: boolean | null; } | null | undefined,): Promise<AccessState> {
    const policy = await getPolicy();
    const base: AccessState = {
        subscriptionRequired: policy.required, subscribed: false, emailVerified: true, restricted: false, reason: null, lapsed: false,
    };
    if (!user?.id || !policy.required || isStaffRole(user.role ?? undefined,)) return base;
    const [subscribed, row,] = await Promise.all([
        hasQualifyingSubscription(user.id, policy.minimumRank,),
        query<{ email_verified: boolean | null; ever: boolean; }>(
            `SELECT u.email_verified, EXISTS (SELECT 1 FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id
                                               WHERE s.user_id = u.id AND p.is_free = false) AS ever
               FROM users u WHERE u.id = $1`, [user.id,],
        ),
    ],);
    const emailVerified = !policy.requireEmailVerification || row.rows[0]?.email_verified !== false;
    const reason: AccessReason | null = !subscribed ? 'subscription' : !emailVerified ? 'verify_email' : null;
    return { ...base, subscribed, emailVerified, restricted: reason !== null, reason, lapsed: !subscribed && Boolean(row.rows[0]?.ever,), };
}

/** The tier a member must reach must exist and be buyable. */
export async function assertPurchasableMinimum(minimumTierId: string | null,): Promise<void> {
    const r = await query<{ n: number; }>(
        minimumTierId
            ? `SELECT COUNT(*)::int AS n FROM subscription_plans WHERE id = $1 AND is_free = false AND stripe_price_id IS NOT NULL`
            : `SELECT COUNT(*)::int AS n FROM subscription_plans WHERE is_free = false AND is_active IS NOT FALSE AND stripe_price_id IS NOT NULL`,
        minimumTierId ? [minimumTierId,] : [],
    );
    if (!Number(r.rows[0]?.n ?? 0,)) {
        throw new ValidationError(minimumTierId
            ? 'The minimum tier must be a paid tier with a Stripe price.'
            : 'Add a paid subscription tier with a Stripe price first (Users → Settings → Subscriptions).',);
    }
}
