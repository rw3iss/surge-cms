/**
 * Reading a sign-in / subscription gate from the API (403 `SIGN_IN_REQUIRED`
 * / `SUBSCRIPTION_REQUIRED`, `details` = AccessRequiredDetails) and building
 * the "upgrade" link. Used by event registration, ticket tiers and checkout.
 */
import type { AccessRequiredDetails, } from '@sitesurge/types';

export interface AccessRequired extends AccessRequiredDetails {
    /** The server's sentence ("Registering for "Gala" requires the Gold subscription or higher."). */
    message: string;
}

const CODES = new Set(['SIGN_IN_REQUIRED', 'SUBSCRIPTION_REQUIRED',],);

/** The gate carried by an SDK error, or null for any other failure. */
export function accessErrorOf(err: unknown,): AccessRequired | null {
    const e = err as { code?: unknown; details?: Record<string, unknown>; message?: unknown; } | null;
    if (!e || typeof e !== 'object' || !CODES.has(String(e.code,),)) return null;
    const d = e.details ?? {};
    const tier = d.requiredTier as { id?: unknown; name?: unknown; } | null | undefined;
    return {
        reason: d.reason === 'signin' || e.code === 'SIGN_IN_REQUIRED' ? 'signin' : 'subscribe',
        requiredTier: tier && typeof tier.id === 'string' ? { id: tier.id, name: String(tier.name ?? '',), } : null,
        message: typeof e.message === 'string' && e.message ? e.message : '',
    };
}

/** Where "Upgrade your subscription" goes: the profile Membership tab (pre-selecting the tier) when signed in, else the plans page. */
export function upgradeHref(requiredTier: { id: string; } | null | undefined, signedIn: boolean,): string {
    if (!signedIn) return '/subscribe';
    return `/profile?tab=membership${requiredTier?.id ? `&tier=${encodeURIComponent(requiredTier.id,)}` : ''}`;
}

/** "the Gold subscription or higher" / "a subscription" — reads right for any tier name (even "Subscriber"). */
export function tierRequirement(requiredTier: { name: string; } | null | undefined,): string {
    return requiredTier?.name ? `the ${requiredTier.name} subscription or higher` : 'a subscription';
}
