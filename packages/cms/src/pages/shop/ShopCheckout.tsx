import { loadStripe, Stripe, StripeCardElement, } from '@stripe/stripe-js';
import { useNavigate, } from '@solidjs/router';
import type { ShopAddress, ShopCheckoutTotals, } from '@rw/cms-shared';
import { Component, createSignal, onMount, Show, } from 'solid-js';
import SeoHead from '../../components/common/seo/SeoHead';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { cartItems, cartSubtotal, clearCart, } from '../../stores/shopCart';
import ShopStoreGuard from './ShopStoreGuard';
import { money, } from './shopFormat';
import './shop.scss';

const ShopCheckoutInner: Component = () => {
    const auth = useAuth();
    const navigate = useNavigate();

    let cardElementRef: HTMLDivElement | undefined;
    let cardElement: StripeCardElement | null = null;
    let stripeInstance: Stripe | null = null;

    const [email, setEmail,] = createSignal(auth.user?.email || '',);
    const [name, setName,] = createSignal(auth.user?.displayName || '',);
    const [line1, setLine1,] = createSignal('',);
    const [line2, setLine2,] = createSignal('',);
    const [city, setCity,] = createSignal('',);
    const [stateRegion, setStateRegion,] = createSignal('',);
    const [postalCode, setPostalCode,] = createSignal('',);
    const [country, setCountry,] = createSignal('US',);
    const [phone, setPhone,] = createSignal('',);

    const [totals, setTotals,] = createSignal<ShopCheckoutTotals | null>(null,);
    const [previewing, setPreviewing,] = createSignal(false,);
    const [cardReady, setCardReady,] = createSignal(false,);
    const [placing, setPlacing,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const lines = () => cartItems().map((l,) => ({ variantId: l.variantId, qty: l.qty, }));

    const shippingAddress = (): ShopAddress => ({
        name: name() || undefined,
        line1: line1() || undefined,
        line2: line2() || undefined,
        city: city() || undefined,
        state: stateRegion() || undefined,
        postalCode: postalCode() || undefined,
        country: country() || undefined,
        phone: phone() || undefined,
    });

    let previewTimer: ReturnType<typeof setTimeout> | undefined;
    const schedulePreview = () => {
        if (previewTimer) clearTimeout(previewTimer,);
        previewTimer = setTimeout(() => void runPreview(), 500,);
    };

    const runPreview = async () => {
        if (cartItems().length === 0) return;
        setPreviewing(true,);
        try {
            const t = await cms.shop.checkout.preview({
                items: lines(),
                shippingAddress: shippingAddress(),
            },);
            setTotals(t,);
        } catch {
            /* keep last totals; final total is authoritative on create */
        } finally {
            setPreviewing(false,);
        }
    };

    onMount(async () => {
        void runPreview();

        const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
        if (!key) {
            setError('Payments are not configured.',);
            return;
        }
        stripeInstance = await loadStripe(key,);
        if (!stripeInstance) {
            setError('Failed to load payment system.',);
            return;
        }
        const elements = stripeInstance.elements();
        cardElement = elements.create('card', {
            style: { base: { fontSize: '16px', color: '#333', '::placeholder': { color: '#aab7c4', }, }, },
        },);
        if (cardElementRef) {
            cardElement.mount(cardElementRef,);
            cardElement.on('ready', () => setCardReady(true,),);
        }
    },);

    const placeOrder = async (e: Event,) => {
        e.preventDefault();
        setError('',);

        if (cartItems().length === 0) {
            setError('Your cart is empty.',);
            return;
        }
        if (!email()) {
            setError('Email is required.',);
            return;
        }
        if (!stripeInstance || !cardElement) {
            setError('Payment system not ready.',);
            return;
        }

        setPlacing(true,);
        try {
            const { clientSecret, orderNumber, } = await cms.shop.checkout.create({
                items: lines(),
                customerEmail: email(),
                customerName: name() || undefined,
                shippingAddress: shippingAddress(),
                billingAddress: shippingAddress(),
            },);

            if (!clientSecret) {
                setError('Could not start payment. Please try again.',);
                setPlacing(false,);
                return;
            }

            const result = await stripeInstance.confirmCardPayment(clientSecret, {
                payment_method: {
                    card: cardElement,
                    billing_details: { name: name() || undefined, email: email(), },
                },
            },);

            if (result.error) {
                setError(result.error.message || 'Payment failed. Your order is saved as pending.',);
                setPlacing(false,);
                return;
            }
            if (result.paymentIntent?.status === 'succeeded') {
                clearCart();
                navigate(`/shop/orders/${orderNumber}`,);
                return;
            }
            setError('Payment did not complete. Please try again.',);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Checkout failed. Please try again.',);
        } finally {
            setPlacing(false,);
        }
    };

    return (
        <div class="shop-store shop-checkout page-wrapper">
            <SeoHead title="Checkout" canonical={`${window.location.origin}/shop/checkout`} type="website" />
            <header class="page-header shop-store__header">
                <h1>Checkout</h1>
            </header>

            <Show
                when={cartItems().length > 0}
                fallback={<div class="shop-store__empty">Your cart is empty.</div>}
            >
                <form class="shop-checkout__layout" onSubmit={placeOrder}>
                    <div class="shop-checkout__form">
                        <h2>Contact</h2>
                        <label>Email</label>
                        <input type="email" required value={email()} onInput={(e,) => setEmail(e.currentTarget.value,)} />

                        <h2>Shipping address</h2>
                        <label>Full name</label>
                        <input type="text" value={name()} onInput={(e,) => { setName(e.currentTarget.value,); schedulePreview(); }} />
                        <label>Address line 1</label>
                        <input type="text" value={line1()} onInput={(e,) => { setLine1(e.currentTarget.value,); schedulePreview(); }} />
                        <label>Address line 2</label>
                        <input type="text" value={line2()} onInput={(e,) => { setLine2(e.currentTarget.value,); schedulePreview(); }} />
                        <div class="shop-checkout__row">
                            <div>
                                <label>City</label>
                                <input type="text" value={city()} onInput={(e,) => { setCity(e.currentTarget.value,); schedulePreview(); }} />
                            </div>
                            <div>
                                <label>State / Region</label>
                                <input type="text" value={stateRegion()} onInput={(e,) => { setStateRegion(e.currentTarget.value,); schedulePreview(); }} />
                            </div>
                        </div>
                        <div class="shop-checkout__row">
                            <div>
                                <label>Postal code</label>
                                <input type="text" value={postalCode()} onInput={(e,) => { setPostalCode(e.currentTarget.value,); schedulePreview(); }} />
                            </div>
                            <div>
                                <label>Country</label>
                                <input type="text" value={country()} onInput={(e,) => { setCountry(e.currentTarget.value,); schedulePreview(); }} />
                            </div>
                        </div>
                        <label>Phone (optional)</label>
                        <input type="tel" value={phone()} onInput={(e,) => setPhone(e.currentTarget.value,)} />

                        <h2>Payment</h2>
                        <label>Card details</label>
                        <div class="shop-checkout__card" ref={cardElementRef} />
                    </div>

                    <aside class="shop-checkout__summary">
                        <h2>Order summary</h2>
                        <div class="shop-checkout__totals">
                            <div class="shop-checkout__total-row">
                                <span>Subtotal</span>
                                <span>{money(totals()?.subtotalCents ?? cartSubtotal(), totals()?.currency,)}</span>
                            </div>
                            <Show when={totals()}>
                                {(t,) => (
                                    <>
                                        <div class="shop-checkout__total-row">
                                            <span>Shipping</span>
                                            <span>{money(t().shippingCents, t().currency,)}</span>
                                        </div>
                                        <div class="shop-checkout__total-row">
                                            <span>Tax</span>
                                            <span>{money(t().taxCents, t().currency,)}</span>
                                        </div>
                                        <div class="shop-checkout__total-row shop-checkout__total-row--grand">
                                            <span>Total</span>
                                            <strong>{money(t().totalCents, t().currency,)}</strong>
                                        </div>
                                    </>
                                )}
                            </Show>
                            <Show when={previewing()}>
                                <p class="shop-checkout__updating">Updating totals…</p>
                            </Show>
                        </div>

                        <Show when={error()}>
                            <div class="shop-store__error">{error()}</div>
                        </Show>

                        <button
                            type="submit"
                            class="btn btn--primary shop-checkout__place"
                            disabled={placing() || !cardReady()}
                        >
                            {placing() ? 'Processing…' : 'Place Order'}
                        </button>
                    </aside>
                </form>
            </Show>
        </div>
    );
};

const ShopCheckout: Component = () => (
    <ShopStoreGuard>
        <ShopCheckoutInner />
    </ShopStoreGuard>
);

export default ShopCheckout;
