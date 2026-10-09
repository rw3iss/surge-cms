/**
 * Roles + subscription tiers (`/api/v1/roles`, `/api/v1/subscription-tiers`,
 * `/api/v1/users/:id/subscription`).
 *
 * A ROLE is what a user is (built-ins are locked; custom roles inherit a base
 * role's permissions). A subscription TIER is what a user has paid for: it
 * gives its subscribers a role and may grant extra permissions of its own.
 * Everyone without a paid subscription is on the `free` tier.
 */

export interface RoleDef {
    key: string;
    label: string;
    description: string | null;
    /** Inherits this role's permissions (custom roles only). */
    baseRole: string | null;
    /** Built-in: cannot be edited, renamed or deleted. */
    isSystem: boolean;
    sortOrder: number;
    /** Users with this role. */
    userCount?: number;
}

export interface RoleCreateBody {
    key: string;
    label: string;
    description?: string;
    baseRole?: string | null;
}
export type RoleUpdateBody = Partial<Omit<RoleCreateBody, 'key'>>;

export interface SubscriptionTier {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    /** The role subscribers of this tier are given. */
    role: string | null;
    isFree: boolean;
    isActive: boolean;
    priceCents: number;
    interval: string;
    stripePriceId: string | null;
    stripeProductId: string | null;
    sortOrder: number;
    /** Extra permission keys this tier grants on top of its role. */
    permissions: string[];
    /** Users currently entitled to this tier (free: members without a paid plan). */
    subscriberCount: number;
}

export interface SubscriptionTierBody {
    slug?: string;
    name?: string;
    description?: string | null;
    role?: string | null;
    isActive?: boolean;
    /** A recurring Stripe price; its product/amount/interval are copied. Null clears. */
    stripePriceId?: string | null;
    sortOrder?: number;
    /** Replaces the tier's extra permission grants. */
    permissions?: string[];
}

/** One recurring price in the connected Stripe account. */
export interface StripeSubscriptionPrice {
    priceId: string;
    productId: string;
    productName: string;
    nickname: string | null;
    unitAmount: number | null;
    currency: string;
    interval: string;
    intervalCount: number;
}

export interface StripeSubscriptionPricesResponse {
    /** False when no Stripe secret key is configured (Settings → Payments). */
    connected: boolean;
    prices: StripeSubscriptionPrice[];
    error?: string;
}

/** A user's current subscription, as the admin sees it. */
export interface UserSubscriptionInfo {
    tier: Pick<SubscriptionTier, 'id' | 'slug' | 'name' | 'role' | 'isFree'> | null;
    status: string | null;
    source: 'stripe' | 'manual' | 'free';
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
}

export interface UserSubscriptionAssignBody {
    /** The tier to put the user on; null or the free tier ends a manual one. */
    tierId: string | null;
}

/** GET /subscription-tiers/options (staff) — tier picker for content gating. */
export interface SubscriptionTierOption {
    id: string;
    name: string;
    slug: string | null;
    isFree: boolean;
    isActive: boolean;
    /** Rank: a viewer with this tier or a higher one passes. */
    sortOrder: number;
}
