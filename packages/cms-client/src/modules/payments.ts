import type {
    PaymentsCreateCustomerResponse, PaymentsDonateBody, PaymentsDonateResponse,
    PaymentsSubscribeBody, PaymentsSubscribeResponse, PaymentsUnsubscribeResponse,
    PaymentsSubscriptionsResponse, PaymentsTransactionsQuery, PaymentsTransactionsResponse,
    PaymentsDonationsQuery, PaymentsDonationsResponse,
    PaymentsPublicPlansResponse, PaymentsAdminPlansResponse, PaymentsPlanCreateBody,
    PaymentsPlanCreateResponse, PaymentsPlanUpdateBody, PaymentsPlanUpdateResponse,
    PaymentsAdminSubscriptionsQuery, PaymentsAdminSubscriptionsResponse,
    PaymentsAdminTransactionsQuery, PaymentsAdminTransactionsResponse,
    PaymentsAdminUserTransactionsResponse,
    PaymentContext, PaymentPublishableKeyResponse, RecurringDonation, RecurringDonationUpdateBody, } from '@sitesurge/types';
import type { Paginated, } from '@sitesurge/types';
import { ModuleBase, } from './base';
import type { MembershipChangeResponse, MembershipPreviewResponse, MembershipResponse, } from '@sitesurge/types';

/**
 * payments namespace — Stripe donations, subscriptions, and admin plan
 * CRUD. `donate` and `plans` are PUBLIC/optional-auth (the client still
 * attaches a token if present — harmless). The Stripe `webhook` route is
 * deliberately NOT exposed (raw body, signature-verified server-side).
 */
export class PaymentsModule extends ModuleBase {
    protected readonly module = 'payments';

    /** POST /payments/donate — anonymous donations allowed (optional auth). */
    donate(body: PaymentsDonateBody,): Promise<PaymentsDonateResponse> {
        return this.mutate<PaymentsDonateResponse>('POST', '/payments/donate', { body, },);
    }

    /** GET /payments/publishable-key?context= — the resolved Stripe publishable
     *  key for a context (public), so the checkout / donation forms load the
     *  right Stripe account. */
    publishableKey(context: PaymentContext = 'default',): Promise<PaymentPublishableKeyResponse> {
        return this.get<PaymentPublishableKeyResponse>('/payments/publishable-key', { query: { context, }, },);
    }

    /** POST /payments/subscribe — may return a clientSecret for confirmation. */
    subscribe(body: PaymentsSubscribeBody,): Promise<PaymentsSubscribeResponse> {
        return this.mutate<PaymentsSubscribeResponse>('POST', '/payments/subscribe', { body, },);
    }

    /** POST /payments/unsubscribe — cancels at period end. */
    unsubscribe(): Promise<PaymentsUnsubscribeResponse> {
        return this.mutate<PaymentsUnsubscribeResponse>('POST', '/payments/unsubscribe',);
    }

    /** POST /payments/create-customer — create/retrieve the Stripe customer. */
    createCustomer(): Promise<PaymentsCreateCustomerResponse> {
        return this.mutate<PaymentsCreateCustomerResponse>('POST', '/payments/create-customer',);
    }

    /** GET /payments/subscriptions — the current user's subscriptions. */
    subscriptions(): Promise<PaymentsSubscriptionsResponse> {
        return this.get<PaymentsSubscriptionsResponse>('/payments/subscriptions',);
    }

    /** GET /payments/transactions — the current user's transaction history. */
    transactions(query?: PaymentsTransactionsQuery,): Promise<Paginated<PaymentsTransactionsResponse[number]>> {
        return this.getPaged<PaymentsTransactionsResponse[number]>('/payments/transactions', { query: query as Record<string, unknown>, },);
    }

    /** GET /payments/donations — the current user's completed donations (by their
     *  own id OR email; server-enforced). */
    donations(query?: PaymentsDonationsQuery,): Promise<Paginated<PaymentsDonationsResponse[number]>> {
        return this.getPaged<PaymentsDonationsResponse[number]>('/payments/donations', { query: query as Record<string, unknown>, },);
    }

    /** GET /payments/recurring-donations — the signed-in donor's recurring
     *  donations, read live from Stripe. */
    recurringDonations(): Promise<RecurringDonation[]> {
        return this.get<RecurringDonation[]>('/payments/recurring-donations', { options: { cache: false, }, },);
    }

    /** PUT /payments/recurring-donations/:id — change amount and/or frequency
     *  (takes effect from the next charge). */
    updateRecurringDonation(id: string, body: RecurringDonationUpdateBody,): Promise<RecurringDonation> {
        return this.mutate<RecurringDonation>('PUT', '/payments/recurring-donations/:id', { params: { id, }, body, invalidates: ['payments',], },);
    }

    /** POST /payments/recurring-donations/:id/cancel — stop it now. */
    cancelRecurringDonation(id: string,): Promise<RecurringDonation> {
        return this.mutate<RecurringDonation>('POST', '/payments/recurring-donations/:id/cancel', { params: { id, }, invalidates: ['payments',], },);
    }

    /** GET /payments/plans — active plans for the public subscribe page. */
    plans(): Promise<PaymentsPublicPlansResponse> {
        return this.get<PaymentsPublicPlansResponse>('/payments/plans',);
    }

    /** GET /payments/admin/subscriptions — all subscriptions (admin). */
    adminSubscriptions(query?: PaymentsAdminSubscriptionsQuery,): Promise<Paginated<PaymentsAdminSubscriptionsResponse[number]>> {
        return this.getPaged<PaymentsAdminSubscriptionsResponse[number]>('/payments/admin/subscriptions', { query: query as Record<string, unknown>, },);
    }

    /** GET /payments/admin/transactions — all transactions (admin; type/status filters). */
    adminTransactions(query?: PaymentsAdminTransactionsQuery,): Promise<Paginated<PaymentsAdminTransactionsResponse[number]>> {
        return this.getPaged<PaymentsAdminTransactionsResponse[number]>('/payments/admin/transactions', { query: query as Record<string, unknown>, },);
    }

    /** GET /payments/admin/user/:userId/transactions — one user's transactions (admin). */
    adminUserTransactions(userId: string,): Promise<Paginated<PaymentsAdminUserTransactionsResponse[number]>> {
        return this.getPaged<PaymentsAdminUserTransactionsResponse[number]>('/payments/admin/user/:userId/transactions', { params: { userId, }, },);
    }

    /** GET /payments/admin/plans — all plans (admin). */
    adminPlans(): Promise<PaymentsAdminPlansResponse> {
        return this.get<PaymentsAdminPlansResponse>('/payments/admin/plans',);
    }

    /** POST /payments/admin/plans — create a Stripe product + price (admin). */
    createPlan(body: PaymentsPlanCreateBody,): Promise<PaymentsPlanCreateResponse> {
        return this.mutate<PaymentsPlanCreateResponse>('POST', '/payments/admin/plans', { body, invalidates: ['payments',], },);
    }

    /** PUT /payments/admin/plans/:id — update a plan (admin). Response is a
     *  union: `{ message: 'No changes' }` or the updated `AdminPlan`. */
    updatePlan(id: string, body: PaymentsPlanUpdateBody,): Promise<PaymentsPlanUpdateResponse> {
        return this.mutate<PaymentsPlanUpdateResponse>('PUT', '/payments/admin/plans/:id', { params: { id, }, body, invalidates: ['payments',], },);
    }

    // ─── Membership (own tier) ───

    /** GET /payments/membership — current tier (incl. free) + the tiers to switch to. */
    membership(): Promise<MembershipResponse> {
        return this.get<MembershipResponse>('/payments/membership', { options: { cache: false, }, },);
    }

    /** POST /payments/membership/preview — cost now + when a change takes effect. */
    previewMembership(tierId: string,): Promise<MembershipPreviewResponse> {
        return this.mutate<MembershipPreviewResponse>('POST', '/payments/membership/preview', { body: { tierId, }, },);
    }

    /** POST /payments/membership/change — `payment_required` → confirm the card with `clientSecret`, then `confirmMembership`. */
    changeMembership(tierId: string,): Promise<MembershipChangeResponse> {
        return this.mutate<MembershipChangeResponse>('POST', '/payments/membership/change', { body: { tierId, }, invalidates: ['payments', 'auth',], },);
    }

    /** POST /payments/membership/confirm — activate after the first payment. */
    confirmMembership(subscriptionId: string,): Promise<MembershipChangeResponse> {
        return this.mutate<MembershipChangeResponse>('POST', '/payments/membership/confirm', { body: { subscriptionId, }, invalidates: ['payments', 'auth',], },);
    }

    /** POST /payments/membership/resume — undo a scheduled cancellation. */
    resumeMembership(): Promise<MembershipChangeResponse> {
        return this.mutate<MembershipChangeResponse>('POST', '/payments/membership/resume', { invalidates: ['payments',], },);
    }
}
