import Stripe from 'stripe';
import { ServiceNotConfiguredError, } from '../../core/errors';
import { stripeCredentials, } from './credentials';
import {
    CreateCustomerParams,
    CreatePaymentIntentParams,
    CreateSubscriptionParams,
    CustomerResult,
    PaymentIntentResult,
    PaymentProvider,
    SubscriptionResult,
} from './types';
import { invoiceClientSecret, subscriptionPeriod, } from './stripeCompat';

// Stripe client is lazy so the backend can boot in setup mode without
// a Stripe secret. The secret is resolved from `stripeCredentials()` (DB
// override → env fallback), so an admin key change takes effect after
// `resetStripeClient()` drops the memoized instance.
let _stripe: Stripe | null = null;
let _stripeKey: string | null = null;
function stripeClient(): Stripe {
    const key = stripeCredentials().secretKey;
    if (!key) throw new ServiceNotConfiguredError('Stripe',);
    // Rebuild if the resolved secret changed (admin updated the key at runtime).
    if (_stripe && _stripeKey === key) return _stripe;
    _stripe = new Stripe(key,);
    _stripeKey = key;
    return _stripe;
}
const stripe = new Proxy({} as Stripe, {
    get(_t, p,) {
        const client = stripeClient();
        const value = (client as unknown as Record<string | symbol, unknown>)[p as string];
        return typeof value === 'function' ? (value as Function).bind(client,) : value;
    },
},);

/** Drop the memoized client so the next use rebuilds with the current secret.
 *  Called by the credentials service after an admin key change. */
export function resetStripeClient(): void {
    _stripe = null;
    _stripeKey = null;
}

/** The memoized Stripe client, or null when no secret key is configured.
 *  For read-only checks (e.g. connection status) that must not throw. */
export function getStripeClient(): Stripe | null {
    if (!stripeCredentials().secretKey) return null;
    return stripeClient();
}

/**
 * Map a Stripe authentication error (missing/placeholder/invalid API key) to a
 * clean 503 so misconfiguration surfaces as "Stripe is not configured" instead
 * of an opaque 500. Any other Stripe/error rethrows unchanged.
 */
function rethrowStripeError(err: unknown,): never {
    if (err instanceof Stripe.errors.StripeAuthenticationError) {
        throw new ServiceNotConfiguredError('Stripe',);
    }
    throw err;
}

export class StripePaymentProvider implements PaymentProvider {
    async createPaymentIntent(params: CreatePaymentIntentParams,): Promise<PaymentIntentResult> {
        try {
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
        } catch (err) {
            rethrowStripeError(err,);
        }
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
        const period = subscriptionPeriod(subscription,);

        return {
            id: subscription.id,
            status: subscription.status,
            currentPeriodStart: new Date(period.start * 1000,),
            currentPeriodEnd: new Date(period.end * 1000,),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            clientSecret: invoice ? invoiceClientSecret(invoice,) : undefined,
        };
    }

    async cancelSubscription(subscriptionId: string,): Promise<void> {
        await stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
        },);
    }

    async getSubscription(subscriptionId: string,): Promise<SubscriptionResult> {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId,);
        const period = subscriptionPeriod(subscription,);

        return {
            id: subscription.id,
            status: subscription.status,
            currentPeriodStart: new Date(period.start * 1000,),
            currentPeriodEnd: new Date(period.end * 1000,),
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
        };
    }

    verifyWebhookSignature(payload: string | Buffer, signature: string,): Stripe.Event {
        return stripe.webhooks.constructEvent(
            payload,
            signature,
            stripeCredentials().webhookSecret,
        );
    }
}
