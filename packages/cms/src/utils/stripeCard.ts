/** Mount a Stripe card field (the default account's publishable key). Shared by the membership forms. */
import { loadStripe, type Stripe, type StripeCardElement, } from '@stripe/stripe-js';
import { cms, } from '../services/cmsClient';

export interface MountedCard { stripe: Stripe; card: StripeCardElement; }

/** Throws a readable Error when payments are not configured. */
export async function mountStripeCard(el: HTMLElement,): Promise<MountedCard> {
    let key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
    const res = await cms.payments.publishableKey('default',).catch(() => null);
    if (res?.publishableKey) key = res.publishableKey;
    if (!key) throw new Error('Payments are not configured yet. Please try again later.',);
    const stripe = await loadStripe(key,);
    if (!stripe) throw new Error('Could not load the payment form.',);
    const card = stripe.elements().create('card', { style: { base: { fontSize: '16px', }, }, },);
    card.mount(el,);
    return { stripe, card, };
}

/** Save a card for later (SetupIntent) → the payment method id. Nothing is charged. */
export async function saveCardForLater(m: MountedCard,): Promise<string> {
    const { clientSecret, } = await cms.payments.membershipCardSetup();
    const r = await m.stripe.confirmCardSetup(clientSecret, { payment_method: { card: m.card, }, },);
    if (r.error) throw new Error(r.error.message || 'Your card could not be saved.',);
    const pm = r.setupIntent?.payment_method;
    const id = typeof pm === 'string' ? pm : pm?.id;
    if (!id) throw new Error('Your card could not be saved.',);
    return id;
}
