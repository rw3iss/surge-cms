import type { MembershipApprovedOffer, MembershipPendingApplication, } from './membershipApplications';
import type { TierDisplayPrice, } from './subscriptions';
/**
 * membership — a signed-in user managing THEIR OWN subscription tier
 * (`/api/v1/payments/membership/*`, the profile's Membership tab).
 *
 * Change model (kept in sync with Stripe):
 *   - free → paid: a new Stripe subscription; the card is confirmed in the
 *     browser (`clientSecret`), then `confirm` activates it.
 *   - paid → paid: switched IMMEDIATELY with Stripe proration — unused time on
 *     the old price is credited, the difference is charged now (upgrade) or
 *     left as credit on the next invoice (downgrade).
 *   - paid → free: cancels at the end of the period already paid for
 *     (`resume` undoes it until then).
 */

/** One Stripe price a membership level can be bought at (e.g. $25 / month, $250 / year). */
export interface MembershipPriceOption {
    priceId: string;
    /** Cents per period. */
    amount: number;
    currency: string;
    interval: string;
    intervalCount: number;
    /** The level's own price (shown first). */
    isDefault: boolean;
}

export interface MembershipTierOption {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    isFree: boolean;
    /** Price per period in the smallest currency unit (cents). 0 for free. */
    priceCents: number;
    currency: string;
    interval: string;
    intervalCount: number;
    /** Shown to members instead of the billing price/interval above (which
     *  stay the real Stripe charge). Null = show the billing price. */
    display?: TierDisplayPrice | null;
    /**
     * Every price the level can be bought at — its default first, then the
     * other active recurring prices on the same Stripe product. The fields
     * above (`priceCents`/`interval`…) describe the SELECTED one: the default,
     * or the price this option was built for (`selectedPriceId`).
     */
    prices?: MembershipPriceOption[];
    /** The price the fields above describe. */
    selectedPriceId?: string | null;
    /** On the member's current level: the price they pay now. */
    currentPriceId?: string | null;
    /** Prices are hidden until the viewer is approved for this level (Apply only; no card at apply time). */
    priceHidden?: boolean;
    /** The viewer was APPROVED for this level and can now choose billing and start it. */
    isApproved?: boolean;
    /** Joining needs an admin's approval: the button reads "Apply". */
    requiresApproval?: boolean;
    /** Admin-only level (only admins see it). */
    devOnly?: boolean;
    /** Slug of the tier's application form (a published Forms entity); null = the built-in form. */
    applicationFormSlug?: string | null;
    /** The viewer has a pending application for this tier. */
    isPending?: boolean;
    isCurrent: boolean;
    /** Tier rank (price order; Free = 0). */
    rank?: number;
}

export interface MembershipCurrent {
    tier: { id: string; slug: string; name: string; description: string | null; isFree: boolean; } | null;
    /** The user's role right now (a tier gives a role). */
    role: string;
    /** The main role's display name. */
    roleLabel?: string;
    /** Additional roles (e.g. Ambassador) — assigned by an admin or an invite, kept across membership changes. */
    extraRoles?: Array<{ key: string; label: string; }>;
    status: string | null;
    source: 'stripe' | 'manual' | 'free';
    priceCents: number;
    currency: string;
    interval: string | null;
    intervalCount?: number;
    /** The tier's custom price display, if set. */
    display?: TierDisplayPrice | null;
    currentPeriodEnd: string | null;
    /** A scheduled cancellation: the tier ends at `currentPeriodEnd`. */
    cancelAtPeriodEnd: boolean;
    /** Saved card for a Stripe subscription, when known. */
    card: { brand: string; last4: string; } | null;
    /** The Stripe price they pay now (one of the level's `prices`), when known. */
    priceId?: string | null;
}

/** The member's latest membership payment that never completed (no active membership). */
export interface MembershipFailedAttempt {
    tierId: string;
    tierName: string;
    /** Stripe status: incomplete (card never confirmed), incomplete_expired, past_due, unpaid. */
    status: string;
    createdAt: string;
}

export interface MembershipResponse {
    current: MembershipCurrent;
    tiers: MembershipTierOption[];
    /** Subscription-required mode: Free is not offered; cancelling ends access. */
    subscriptionRequired?: boolean;
    /** The member's open application, if any. */
    pendingApplication?: MembershipPendingApplication | null;
    /** Approved for a level, not started yet: choose billing + pay to start it. */
    approvedOffer?: MembershipApprovedOffer | null;
    /** A recent membership payment that did not go through (guide the member to retry). */
    lastFailedAttempt?: MembershipFailedAttempt | null;
}

/** POST /payments/membership/card/setup — a SetupIntent to confirm with the new card. */
export interface MembershipCardSetupResponse { clientSecret: string; }
export interface MembershipCardBody { paymentMethodId: string; }
/** POST /payments/membership/card — card saved; `paid` when an open invoice was retried and paid. */
export interface MembershipCardResponse { current: MembershipCurrent; paid: boolean; }

export interface MembershipChangeBody {
    tierId: string;
    /** One of the level's `prices` (e.g. the yearly one); omitted = its default price. */
    priceId?: string;
}

export interface MembershipPreviewResponse {
    /** `billing` = same level, another price (e.g. monthly → yearly). */
    direction: 'upgrade' | 'downgrade' | 'same' | 'cancel' | 'new' | 'billing';
    from: MembershipTierOption | null;
    to: MembershipTierOption;
    /** Charged now (cents) — the prorated difference, or the first period. */
    amountDueNow: number;
    /** Credit left for future invoices (cents), e.g. after a downgrade. */
    creditAfter: number;
    currency: string;
    /** When the change takes effect: now, or at the end of the paid period. */
    effective: 'now' | 'period_end';
    effectiveDate: string | null;
    /** The new tier's recurring charge and its next date. */
    nextAmount: number;
    nextDate: string | null;
    /** A card must be entered (free → paid). */
    requiresPayment: boolean;
}

export interface MembershipChangeResponse {
    result: 'changed' | 'payment_required' | 'cancel_scheduled' | 'cancelled' | 'unchanged';
    /** For `payment_required`: confirm this with the card, then call `confirm`. */
    clientSecret?: string;
    subscriptionId?: string;
    current: MembershipCurrent;
}

export interface MembershipConfirmBody {
    subscriptionId: string;
}

/** GET /payments/membership/tiers (public) — the /subscribe catalogue. */
export interface MembershipPublicTiersResponse {
    tiers: MembershipTierOption[];
    /** Any tier other than free exists (else the site is completely free). */
    paidAvailable: boolean;
    signedIn: boolean;
    /** Subscription-required mode: only paid tiers at/above the minimum are listed. */
    subscriptionRequired?: boolean;
    /** The signed-in viewer's open application, if any. */
    pendingApplication?: MembershipPendingApplication | null;
    approvedOffer?: MembershipApprovedOffer | null;
}
