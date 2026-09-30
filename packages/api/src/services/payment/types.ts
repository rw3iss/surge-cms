/**
 * Which set of Stripe keys a charge uses. `default` = the site-wide keys
 * (Settings → Payments); `shop` / `donations` may override them or inherit the
 * default. Resolved by services/payment/credentials.ts.
 */
export type PaymentContext = 'default' | 'shop' | 'donations';

export interface PaymentProvider {
    // One-time payments
    createPaymentIntent(params: CreatePaymentIntentParams,): Promise<PaymentIntentResult>;

    // Subscriptions
    createCustomer(params: CreateCustomerParams,): Promise<CustomerResult>;
    createSubscription(params: CreateSubscriptionParams,): Promise<SubscriptionResult>;
    cancelSubscription(subscriptionId: string,): Promise<void>;
    getSubscription(subscriptionId: string,): Promise<SubscriptionResult>;

    // Recurring donations (a Stripe Subscription with an inline price)
    createRecurringDonation(params: CreateRecurringDonationParams,): Promise<RecurringDonationResult>;

    // Webhook
    verifyWebhookSignature(payload: string | Buffer, signature: string,): any;
}

export interface CreatePaymentIntentParams {
    amountCents: number;
    currency?: string;
    customerEmail?: string;
    metadata?: Record<string, string>;
    /** Which Stripe key set to charge against. Defaults to 'default'. */
    context?: PaymentContext;
}

export interface CreateRecurringDonationParams {
    amountCents: number;
    currency?: string;
    interval: 'week' | 'month' | 'year';
    intervalCount: number;
    donorEmail: string;
    donorName?: string;
    /** Existing Stripe Product for the campaign; created when absent/stale. */
    productId?: string | null;
    productName: string;
    /** Copied onto the Subscription — every invoice's donation row reads it. */
    metadata: Record<string, string>;
}

export interface RecurringDonationResult {
    subscriptionId: string;
    clientSecret: string;
    /** The product actually used — persist it if it was just created. */
    productId: string;
}

export interface PaymentIntentResult {
    id: string;
    clientSecret: string;
    status: string;
}

export interface CreateCustomerParams {
    email: string;
    name?: string;
    userId: string;
}

export interface CustomerResult {
    id: string;
    email: string;
}

export interface CreateSubscriptionParams {
    customerId: string;
    priceId: string;
    metadata?: Record<string, string>;
}

export interface SubscriptionResult {
    id: string;
    status: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    cancelAtPeriodEnd: boolean;
    clientSecret?: string;
}
