import { StripePaymentProvider, } from './stripe';
import { PaymentProvider, } from './types';

let provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
    if (!provider) {
        provider = new StripePaymentProvider();
    }
    return provider;
}

export type { PaymentProvider, } from './types';
export type {
    CreateCustomerParams,
    CreatePaymentIntentParams,
    CreateSubscriptionParams,
    CustomerResult,
    PaymentIntentResult,
    SubscriptionResult,
} from './types';
