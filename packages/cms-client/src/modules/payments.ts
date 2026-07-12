import type {
    PaymentsCreateCustomerResponse, PaymentsDonateBody, PaymentsDonateResponse,
    PaymentsSubscribeBody, PaymentsSubscribeResponse, PaymentsUnsubscribeResponse,
    PaymentsSubscriptionsResponse, PaymentsTransactionsQuery, PaymentsTransactionsResponse,
    PaymentsPublicPlansResponse, PaymentsAdminPlansResponse, PaymentsPlanCreateBody,
    PaymentsPlanCreateResponse, PaymentsPlanUpdateBody, PaymentsPlanUpdateResponse,
    PaymentsAdminSubscriptionsQuery, PaymentsAdminSubscriptionsResponse,
    PaymentsAdminTransactionsQuery, PaymentsAdminTransactionsResponse,
    PaymentsAdminUserTransactionsResponse,
} from '@sitesurge/types';
import type { Paginated, } from '@sitesurge/types';
import { ModuleBase, } from './base';

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
}
