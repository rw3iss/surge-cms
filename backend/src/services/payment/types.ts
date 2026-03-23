export interface PaymentProvider {
    // One-time payments
    createPaymentIntent(params: CreatePaymentIntentParams,): Promise<PaymentIntentResult>;

    // Subscriptions
    createCustomer(params: CreateCustomerParams,): Promise<CustomerResult>;
    createSubscription(params: CreateSubscriptionParams,): Promise<SubscriptionResult>;
    cancelSubscription(subscriptionId: string,): Promise<void>;
    getSubscription(subscriptionId: string,): Promise<SubscriptionResult>;

    // Webhook
    verifyWebhookSignature(payload: string | Buffer, signature: string,): any;
}

export interface CreatePaymentIntentParams {
    amountCents: number;
    currency?: string;
    customerEmail?: string;
    metadata?: Record<string, string>;
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
