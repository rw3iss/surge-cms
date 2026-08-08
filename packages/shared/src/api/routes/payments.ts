/**
 * Wire DTOs for the /payments module (Stripe). Validation schemas live in
 * `packages/api/src/routes/payments.ts`; the donation / subscription /
 * transaction / plan logic lives in `packages/api/src/services/payments.ts`.
 *
 * The subscription / transaction / plan rows are mapped inline in the
 * service (no shared entity exists), so their wire shapes are DEFINED
 * here as the single source of truth — the service return types are
 * tightened to reference these (see the service-side note in the task
 * report). Money is always integer cents. Timestamps serialize to ISO
 * strings.
 *
 * POST /payments/webhook is RAW (Stripe-owned contract: 200 fast, 400 on
 * bad signature) and is EXCLUDED from the SDK surface — no DTO is
 * published for it.
 */

// ─── POST /payments/create-customer ───────────────────────────────────

/** POST /payments/create-customer — the user's Stripe customer id
 *  (created or retrieved). */
export interface PaymentsCreateCustomerResponse {
    customerId: string;
}

// ─── POST /payments/donate ────────────────────────────────────────────

/** Body for POST /payments/donate. Anonymous donations are allowed. */
export interface PaymentsDonateBody {
    /** integer cents, ≥ 100 ($1.00 minimum). */
    amountCents: number;
    campaignId?: string;
    donorName?: string;
    donorEmail: string;
    message?: string;
    visibility?: 'public' | 'anonymous' | 'hidden';
}

/** POST /payments/donate — the PaymentIntent client secret + id for
 *  Stripe Elements to confirm. */
export interface PaymentsDonateResponse {
    clientSecret: string;
    paymentIntentId: string;
}

// ─── POST /payments/subscribe ─────────────────────────────────────────

/** Body for POST /payments/subscribe. */
export interface PaymentsSubscribeBody {
    planId: string;
}

/** POST /payments/subscribe — the new subscription's Stripe id, status,
 *  and (for incomplete subs requiring confirmation) a client secret. */
export interface PaymentsSubscribeResponse {
    subscriptionId: string;
    status: string;
    clientSecret: string | null;
}

// ─── POST /payments/unsubscribe ───────────────────────────────────────

/** POST /payments/unsubscribe — confirmation message. The subscription
 *  cancels at the end of the current billing period. */
export interface PaymentsUnsubscribeResponse {
    message: string;
}

// ─── GET /payments/subscriptions ──────────────────────────────────────

/** One of the logged-in user's subscriptions (plan fields denormalized
 *  from the joined `subscription_plans` row). */
export interface UserSubscription {
    id: string;
    planName: string;
    planDescription: string | null;
    planPriceCents: number;
    planInterval: string;
    planFeatures: string[];
    status: string;
    /** ISO date-time */
    currentPeriodStart: string | null;
    /** ISO date-time */
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    /** ISO date-time */
    cancelledAt: string | null;
    /** ISO date-time */
    createdAt: string;
}

/** GET /payments/subscriptions — the user's subscriptions (no pagination). */
export type PaymentsSubscriptionsResponse = UserSubscription[];

// ─── GET /payments/transactions ───────────────────────────────────────

/** Query accepted by the paginated transaction-list routes. */
export interface PaymentsTransactionsQuery {
    page?: number;
    limit?: number;
}

/** A transaction row as exposed to its owner (and the admin per-user
 *  list). `campaignTitle` is joined; null for non-campaign transactions. */
export interface UserTransaction {
    id: string;
    type: string;
    amountCents: number;
    currency: string;
    status: string;
    description: string | null;
    campaignTitle: string | null;
    /** ISO date-time */
    createdAt: string;
}

/** GET /payments/transactions — the user's transactions. Page meta on
 *  the envelope. */
export type PaymentsTransactionsResponse = UserTransaction[];

// ─── GET /payments/donations ──────────────────────────────────────────

/** Query accepted by GET /payments/donations. */
export interface PaymentsDonationsQuery {
    page?: number;
    limit?: number;
}

/** A completed donation as exposed to its owner (the /profile Donations tab).
 *  Matched by the authenticated user's id OR email. */
export interface UserDonation {
    id: string;
    amountCents: number;
    message: string | null;
    visibility: string;
    status: string;
    campaignId: string | null;
    campaignTitle: string | null;
    campaignSlug: string | null;
    /** ISO date-time */
    createdAt: string;
}

/** GET /payments/donations — the current user's donations. Page meta on the
 *  envelope. */
export type PaymentsDonationsResponse = UserDonation[];

// ─── GET /payments/admin/subscriptions ────────────────────────────────

/** Query accepted by GET /payments/admin/subscriptions. */
export interface PaymentsAdminSubscriptionsQuery {
    status?: string;
    page?: number;
    limit?: number;
}

/** A subscription row on the admin list (user + plan fields joined in). */
export interface AdminSubscription {
    id: string;
    userId: string;
    userEmail: string;
    userName: string;
    planName: string;
    planPriceCents: number;
    status: string;
    /** ISO date-time */
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    /** ISO date-time */
    createdAt: string;
}

/** GET /payments/admin/subscriptions — all subscriptions. Page meta on
 *  the envelope. */
export type PaymentsAdminSubscriptionsResponse = AdminSubscription[];

// ─── GET /payments/admin/transactions ─────────────────────────────────

/** Query accepted by GET /payments/admin/transactions. */
export interface PaymentsAdminTransactionsQuery {
    type?: string;
    status?: string;
    page?: number;
    limit?: number;
}

/** A transaction row on the admin list (user fields joined in). */
export interface AdminTransaction {
    id: string;
    userId: string | null;
    userEmail: string | null;
    userName: string | null;
    type: string;
    amountCents: number;
    currency: string;
    status: string;
    description: string | null;
    campaignTitle: string | null;
    /** ISO date-time */
    createdAt: string;
}

/** GET /payments/admin/transactions — all transactions. Page meta on the
 *  envelope. */
export type PaymentsAdminTransactionsResponse = AdminTransaction[];

// ─── GET /payments/admin/user/:userId/transactions ────────────────────

/** Params for GET /payments/admin/user/:userId/transactions. */
export interface PaymentsAdminUserTransactionsParams {
    userId: string;
}

/** GET /payments/admin/user/:userId/transactions — one user's
 *  transactions. Same row shape as the owner-facing list. Page meta on
 *  the envelope. */
export type PaymentsAdminUserTransactionsResponse = UserTransaction[];

// ─── Subscription plans ───────────────────────────────────────────────

/** A subscription plan as exposed to admins (full row). */
export interface AdminPlan {
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    interval: string;
    stripePriceId: string | null;
    isActive: boolean;
    features: string[];
    sortOrder: number;
    /** ISO date-time */
    createdAt: string;
}

/** A subscription plan as exposed on the PUBLIC subscribe page — a
 *  curated subset (no Stripe id, no audit/sort fields). */
export interface PublicPlan {
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    interval: string;
    features: string[];
}

// ─── GET /payments/admin/plans ────────────────────────────────────────

/** GET /payments/admin/plans — all plans (admin). */
export type PaymentsAdminPlansResponse = AdminPlan[];

// ─── POST /payments/admin/plans ───────────────────────────────────────

/** Body for POST /payments/admin/plans (create). Creating a plan also
 *  provisions a Stripe product + price. */
export interface PaymentsPlanCreateBody {
    name: string;
    description?: string;
    /** integer cents, > 0. */
    priceCents: number;
    interval?: 'month' | 'year';
    features?: string[];
    sortOrder?: number;
    isActive?: boolean;
}

/** POST /payments/admin/plans (201) — the created plan. */
export type PaymentsPlanCreateResponse = AdminPlan;

// ─── PUT /payments/admin/plans/:id ────────────────────────────────────

/** Params for PUT /payments/admin/plans/:id. */
export interface PaymentsPlanUpdateParams {
    id: string;
}

/** Body for PUT /payments/admin/plans/:id — partial create body. */
export type PaymentsPlanUpdateBody = Partial<PaymentsPlanCreateBody>;

/**
 * PUT /payments/admin/plans/:id — a UNION:
 *   - when the patch contains at least one changed field, the updated
 *     plan (`AdminPlan`);
 *   - when the patch is effectively empty, a no-op marker
 *     `{ message: 'No changes' }` (the DB is not touched).
 * Consumers must narrow on the presence of `id` vs `message`.
 */
export type PaymentsPlanUpdateResponse = AdminPlan | { message: string; };

// ─── GET /payments/plans (public) ─────────────────────────────────────

/** GET /payments/plans — active plans for the public subscribe page. */
export type PaymentsPublicPlansResponse = PublicPlan[];
