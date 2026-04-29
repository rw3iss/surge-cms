import Stripe from 'stripe';
import { config, } from '../../config';
import { ServiceNotConfiguredError, } from '../../core/errors';
import {
    CreateCustomerParams,
    CreatePaymentIntentParams,
    CreateSubscriptionParams,
    CustomerResult,
    PaymentIntentResult,
    PaymentProvider,
    SubscriptionResult,
} from './types';

// Stripe client is lazy so the backend can boot in setup mode without
// a Stripe secret. Any first use after install will pick up the value
// once .env has been populated.
let _stripe: Stripe | null = null;
function stripeClient(): Stripe {
    if (_stripe) return _stripe;
    if (!config.stripe.secretKey) throw new ServiceNotConfiguredError('Stripe',);
    _stripe = new Stripe(config.stripe.secretKey,);
    return _stripe;
}
const stripe = new Proxy({} as Stripe, {
    get(_t, p,) {
        const client = stripeClient();
        const value = (client as unknown as Record<string | symbol, unknown>)[p as string];
        return typeof value === 'function' ? (value as Function).bind(client,) : value;
    },
},);

export class StripePaymentProvider implements PaymentProvider {
    async createPaymentIntent(params: CreatePaymentIntentParams,): Promise<PaymentIntentResult> {
        const paymentIntent = await stripe.paymentIntents.create({
            amount: params.amountCents,
            currency: params.currency || 'usd',
            receipt_email: params.customerEmail,
            metadata: params.metadata || {},
        },);

        return {
            id: paymentIntent.id,
            clientSecret: paymentIntent.client_secret!,
            status: paymentIntent.status,
        };
    }

    async createCustomer(params: CreateCustomerParams,): Promise<CustomerResult> {
        const customer = await stripe.customers.create({
            email: params.email,
            name: params.name,
            metadata: { userId: params.userId, },
        },);

        return {
            id: customer.id,
            email: customer.email!,
        };
    }

    async createSubscription(params: CreateSubscriptionParams,): Promise<SubscriptionResult> {
        const subscription = await stripe.subscriptions.create({
            customer: params.customerId,
            items: [{ price: params.priceId, },],
            payment_behavior: 'default_incomplete',
            payment_settings: { save_default_payment_method: 'on_subscription', },
            expand: ['latest_invoice.payment_intent',],
            metadata: params.metadata || {},
        },);

        const invoice = subscription.latest_invoice as Stripe.Invoice;
        const paymentIntent = invoice?.payment_intent as Stripe.PaymentIntent | null;

        return {
            id: subscription.id,
            status: subscription.status,
            currentPeriodStart: new Date(subscription.current_period_start * 1000,),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000,),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            clientSecret: paymentIntent?.client_secret || undefined,
        };
    }

    async cancelSubscription(subscriptionId: string,): Promise<void> {
        await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
        },);
    }

    async getSubscription(subscriptionId: string,): Promise<SubscriptionResult> {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId,);

        return {
            id: subscription.id,
            status: subscription.status,
            currentPeriodStart: new Date(subscription.current_period_start * 1000,),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000,),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
        };
    }

    verifyWebhookSignature(payload: string | Buffer, signature: string,): Stripe.Event {
        return stripe.webhooks.constructEvent(
            payload,
            signature,
            config.stripe.webhookSecret!,
        );
    }
}
