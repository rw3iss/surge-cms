/**
 * Membership STATE reads with no dependencies on the rest of the membership
 * service: a pending application, an approved offer, the latest failed
 * attempt. `subscriptionAccess.accessState` (every /auth/me) imports these
 * statically — before the split it needed a dynamic import to dodge a cycle.
 */
import type { MembershipApprovedOffer, MembershipFailedAttempt, MembershipPendingApplication, } from '@sitesurge/types';
import { query, } from '../../db';

/** Approved for a level that is not started yet (an OFFER: choose billing + pay). */
export async function approvedOfferFor(userId: string | null,): Promise<MembershipApprovedOffer | null> {
    if (!userId) return null;
    const r = await query<{ id: string; plan_id: string; name: string; decided_at: Date | null; }>(
        `SELECT a.id, a.plan_id, p.name, a.decided_at FROM membership_applications a
           JOIN subscription_plans p ON p.id = a.plan_id
          WHERE a.user_id = $1 AND a.status = 'approved' AND a.activated_at IS NULL AND NOT p.role_only
            AND (a.offer_expires_at IS NULL OR a.offer_expires_at > NOW())
            AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = a.user_id AND s.plan_id = a.plan_id AND s.status IN ('active', 'trialing', 'past_due'))
          ORDER BY a.decided_at DESC NULLS LAST LIMIT 1`,
        [userId,],
    ).catch(() => ({ rows: [], }),);
    const a = r.rows[0];
    return a ? { applicationId: a.id, tierId: a.plan_id, tierName: a.name, approvedAt: a.decided_at ? new Date(a.decided_at,).toISOString() : null, } : null;
}

/** The approved application for this level is now STARTED (paid). */
export async function markApplicationStarted(userId: string, planId: string,): Promise<void> {
    await query(
        `UPDATE membership_applications SET activated_at = NOW() WHERE user_id = $1 AND plan_id = $2 AND status = 'approved' AND activated_at IS NULL`,
        [userId, planId,],
    ).catch(() => {},);
}

/** A member's open (pending) membership application, if any. */
export async function pendingApplicationFor(userId: string | null,): Promise<MembershipPendingApplication | null> {
    if (!userId) return null;
    const r = await query<{ id: string; plan_id: string; name: string; created_at: Date; has_card: boolean; hide_price: boolean; }>(
        `SELECT a.id, a.plan_id, p.name, a.created_at, (a.payment_method_id IS NOT NULL) AS has_card, p.hide_price FROM membership_applications a
           JOIN subscription_plans p ON p.id = a.plan_id
          WHERE a.user_id = $1 AND a.status = 'pending' AND NOT p.role_only LIMIT 1`,
        [userId,],
    ).catch(() => ({ rows: [], }),);
    const a = r.rows[0];
    return a ? { id: a.id, tierId: a.plan_id, tierName: a.name, createdAt: new Date(a.created_at,).toISOString(), hasCard: a.has_card, noCard: !!a.hide_price && !a.has_card, } : null;
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

