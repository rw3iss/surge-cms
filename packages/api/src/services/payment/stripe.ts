import Stripe from 'stripe';
import { ServiceNotConfiguredError, } from '../../core/errors';
import { allWebhookSecrets, stripeCredentials, } from './credentials';
import {
    CreateCustomerParams,
    CreatePaymentIntentParams,
    CreateSubscriptionParams,
    CustomerResult,
    PaymentContext,
    PaymentIntentResult,
    PaymentProvider,
    SubscriptionResult,
} from './types';
import { invoiceClientSecret, subscriptionPeriod, } from './stripeCompat';

// Stripe clients are lazy + memoized per resolved secret key, so different
// payment contexts (default / shop / donations) that use different Stripe
// accounts each get their own client. `resetStripeClient()` drops them all
// after an admin key change so the next use rebuilds with the current keys.
const _clients = new Map<string, Stripe>();
function clientForSecret(secret: string,): Stripe {
    if (!secret) throw new ServiceNotConfiguredError('Stripe',);
    let c = _clients.get(secret,);
    if (!c) {
        c = new Stripe(secret,);
        _clients.set(secret, c,);
    }
    return c;
}
function stripeClient(context: PaymentContext = 'default',): Stripe {
    return clientForSecret(stripeCredentials(context,).secretKey,);
}
// Default-context proxy for the many call sites that don't specify a context
// (customers, subscriptions, account status).
const stripe = new Proxy({} as Stripe, {
    get(_t, p,) {
        const client = stripeClient('default',);
        const value = (client as unknown as Record<string | symbol, unknown>)[p as string];
        return typeof value === 'function' ? (value as Function).bind(client,) : value;
    },
},);

/** Drop every memoized client so the next use rebuilds with current secrets. */
export function resetStripeClient(): void {
    _clients.clear();
}

/** The memoized client for a context, or null when no secret key resolves.
 *  For read-only checks (e.g. connection status) that must not throw. */
export function getStripeClient(context: PaymentContext = 'default',): Stripe | null {
    if (!stripeCredentials(context,).secretKey) return null;
    return stripeClient(context,);
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
            // Charge against the resolved keys for this context (shop / donations
            // may use their own Stripe account, else inherit the default).
            const client = stripeClient(params.context ?? 'default',);
            const paymentIntent = await client.paymentIntents.create({
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
        // An event may originate from any configured Stripe account (default,
        // shop, or donations), so try each distinct signing secret and return
        // the first that verifies. The last error propagates if none match.
        const secrets = allWebhookSecrets();
        let lastErr: unknown = new Error('No Stripe webhook secret configured',);
        for (const secret of secrets) {
            try {
                return stripe.webhooks.constructEvent(payload, signature, secret,);
            } catch (err) {
                lastErr = err;
            }
        }
        throw lastErr;
    }
}
