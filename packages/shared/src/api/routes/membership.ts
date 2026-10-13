import type { MembershipPendingApplication, } from './membershipApplications';
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
    /** Joining needs an admin's approval: the button reads "Apply". */
    requiresApproval?: boolean;
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
}

export interface MembershipResponse {
    current: MembershipCurrent;
    tiers: MembershipTierOption[];
    /** Subscription-required mode: Free is not offered; cancelling ends access. */
    subscriptionRequired?: boolean;
    /** The member's open application, if any. */
    pendingApplication?: MembershipPendingApplication | null;
}

/** POST /payments/membership/card/setup — a SetupIntent to confirm with the new card. */
export interface MembershipCardSetupResponse { clientSecret: string; }
export interface MembershipCardBody { paymentMethodId: string; }
/** POST /payments/membership/card — card saved; `paid` when an open invoice was retried and paid. */
export interface MembershipCardResponse { current: MembershipCurrent; paid: boolean; }

export interface MembershipChangeBody {
    tierId: string;
}

export interface MembershipPreviewResponse {
    direction: 'upgrade' | 'downgrade' | 'same' | 'cancel' | 'new';
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
}
