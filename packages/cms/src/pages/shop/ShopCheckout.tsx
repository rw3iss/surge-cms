import { loadStripe, Stripe, StripeCardElement, } from '@stripe/stripe-js';
import { useNavigate, } from '@solidjs/router';
import type { ShopAddress, ShopCheckoutTotals, } from '@sitesurge/types';
import { Component, createSignal, onMount, Show, } from 'solid-js';
import SeoHead from '../../components/common/seo/SeoHead';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { cartItems, cartSubtotal, clearCart, removeFromCart, } from '../../stores/shopCart';
import ShopStoreGuard from './ShopStoreGuard';
import { money, shipBreakdown, } from './shopFormat';
import { For, } from 'solid-js';
import { isShopifyActive, shopifySource, } from '../../services/shopifySource';
import './shop.scss';

const ShopCheckoutInner: Component = () => {
    const auth = useAuth();
    const navigate = useNavigate();

    let cardElementRef: HTMLDivElement | undefined;
    let cardElement: StripeCardElement | null = null;
    let stripeInstance: Stripe | null = null;

    const [email, setEmail,] = createSignal(auth.user?.email || '',);
    // Split the display name into first/last for a familiar checkout form and
    // browser autofill (given-name / family-name).
    const initialName = (auth.user?.displayName || '').trim();
    const initialSpace = initialName.indexOf(' ',);
    const [firstName, setFirstName,] = createSignal(
        initialSpace > 0 ? initialName.slice(0, initialSpace,) : initialName,
    );
    const [lastName, setLastName,] = createSignal(
        initialSpace > 0 ? initialName.slice(initialSpace + 1,) : '',
    );
    const fullName = () => [firstName().trim(), lastName().trim(),].filter(Boolean,).join(' ',);
    const [line1, setLine1,] = createSignal('',);
    const [line2, setLine2,] = createSignal('',);
    const [city, setCity,] = createSignal('',);
    const [stateRegion, setStateRegion,] = createSignal('',);
    const [postalCode, setPostalCode,] = createSignal('',);
    const [country, setCountry,] = createSignal('US',);
    const [phone, setPhone,] = createSignal('',);

    const [totals, setTotals,] = createSignal<ShopCheckoutTotals | null>(null,);
    const [shipping, setShipping,] = createSignal<{ useAdditionalItemRate?: boolean; additionalItemCents?: number; } | undefined>(undefined,);
    const [shippingMethod, setShippingMethod,] = createSignal<string | undefined>(undefined,);
    const [previewing, setPreviewing,] = createSignal(false,);
    const [cardReady, setCardReady,] = createSignal(false,);
    const [cardComplete, setCardComplete,] = createSignal(false,);
    const [placing, setPlacing,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [notice, setNotice,] = createSignal('',);

    // Two-step flow: 'form' (enter details) → 'confirm' (review + pay).
    const [step, setStep,] = createSignal<'form' | 'confirm'>('form',);
    const [continuing, setContinuing,] = createSignal(false,);
    // Captured on Continue (validates the card + gives brand/last4 for review).
    const [paymentMethodId, setPaymentMethodId,] = createSignal<string | null>(null,);
    const [cardBrand, setCardBrand,] = createSignal('',);
    const [cardLast4, setCardLast4,] = createSignal('',);

    // Total shippable units in the cart (used to break shipping into first /
    // additional lines for display).
    const shippableUnits = () => cartItems().reduce((sum, l,) => sum + l.qty, 0,);
    const shipBd = () => {
        const t = totals();
        return t ? shipBreakdown(t.shippingCents, shippableUnits(), shipping(),) : null;
    };

    const lines = () => cartItems().map((l,) => ({ variantId: l.variantId, qty: l.qty, }));

    const shippingAddress = (): ShopAddress => ({
        name: fullName() || undefined,
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
                shippingMethod: shippingMethod(),
            },);
            setTotals(t,);
            // Prune cart lines the server reports as unavailable (e.g. a variant
            // whose id changed on a resync) so they don't wedge checkout.
            const gone = t.unavailableVariantIds ?? [];
            if (gone.length > 0) {
                gone.forEach((id,) => removeFromCart(id,),);
                setNotice('Some items were no longer available and have been removed from your cart.',);
            }
            // Adopt the server-chosen method when we have none, or ours is no
            // longer offered for this cart/address (e.g. address changed the set).
            const opts = t.shippingOptions ?? [];
            if (t.shippingMethod && (!shippingMethod() || !opts.some((o,) => o.id === shippingMethod()))) {
                setShippingMethod(t.shippingMethod,);
            }
        } catch {
            /* keep last totals; final total is authoritative on create */
        } finally {
            setPreviewing(false,);
        }
    };

    /** Pick a shipping method + re-price immediately. */
    const selectShippingMethod = (id: string,) => {
        setShippingMethod(id,);
        void runPreview();
    };

    onMount(async () => {
        void runPreview();

        // Publishable key comes from the API (server-configured, public by
        // design); fall back to the build-time VITE var for local dev.
        let key: string | undefined = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
        try {
            const cfg = await cms.shop.settings.getPublic();
            if (cfg?.settings?.stripePublishableKey) key = cfg.settings.stripePublishableKey;
            setShipping(cfg?.settings?.shipping,);
        } catch {
            /* fall back to the VITE var */
        }
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
            cardElement.on('change', (ev,) => {
                setCardComplete(Boolean(ev.complete,),);
                if (ev.brand && ev.brand !== 'unknown') setCardBrand(ev.brand,);
                if (ev.error) setError('',); // clear stale errors as the user types
            },);
        }
    },);

    /** Validate the checkout form before advancing to the confirm step. */
    const validateForm = (): string | null => {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email().trim(),)) return 'Please enter a valid email address.';
        if (!firstName().trim() || !lastName().trim()) return 'Please enter your first and last name.';
        if (!line1().trim()) return 'Please enter your street address.';
        if (!city().trim()) return 'Please enter your city.';
        if (!stateRegion().trim()) return 'Please enter your state / region.';
        if (!postalCode().trim()) return 'Please enter your postal code.';
        if (!country().trim()) return 'Please enter your country.';
        if (!cardComplete()) return 'Please enter complete card details.';
        return null;
    };

    /** Step 1 → 2: validate, tokenize the card (→ brand/last4 for review), lock
     *  in shipping, and show the confirmation screen. No order is placed yet. */
    const continueToConfirm = async () => {
        setError(''); setNotice('',);
        if (cartItems().length === 0) { setError('Your cart is empty.',); return; }
        const invalid = validateForm();
        if (invalid) { setError(invalid,); return; }
        if (!stripeInstance || !cardElement) { setError('Payment system not ready.',); return; }
        setContinuing(true,);
        try {
            const pm = await stripeInstance.createPaymentMethod({
                type: 'card',
                card: cardElement,
                billing_details: { name: fullName() || undefined, email: email(), },
            },);
            if (pm.error || !pm.paymentMethod) {
                setError(pm.error?.message || 'Your card could not be verified.',);
                return;
            }
            setPaymentMethodId(pm.paymentMethod.id,);
            if (pm.paymentMethod.card?.brand) setCardBrand(pm.paymentMethod.card.brand,);
            setCardLast4(pm.paymentMethod.card?.last4 ?? '',);
            await runPreview(); // lock in the final shipping quote for this address
            setStep('confirm',);
            window.scrollTo({ top: 0, behavior: 'smooth', },);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not continue. Please try again.',);
        } finally {
            setContinuing(false,);
        }
    };

    /** Form submit router: Continue on step 1, Place Order on step 2. */
    const handleSubmit = (e: Event,) => {
        e.preventDefault();
        if (step() === 'form') void continueToConfirm();
        else void placeOrder(e,);
    };

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
                customerName: fullName() || undefined,
                shippingAddress: shippingAddress(),
                billingAddress: shippingAddress(),
                shippingMethod: shippingMethod(),
            },);

            if (!clientSecret) {
                setError('Could not start payment. Please try again.',);
                setPlacing(false,);
                return;
            }

            // Prefer the PaymentMethod captured on the Continue step; fall back to
            // the live card element if somehow absent.
            const pmId = paymentMethodId();
            const result = await stripeInstance.confirmCardPayment(clientSecret, {
                payment_method: pmId ?? {
                    card: cardElement,
                    billing_details: { name: fullName() || undefined, email: email(), },
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
                <form class="shop-checkout__layout" onSubmit={handleSubmit}>
                    {/* The form stays mounted (Stripe card iframe must persist);
                        it's HIDDEN on the confirm step and the review shows instead. */}
                    <div class="shop-checkout__form" classList={{ 'shop-checkout__form--hidden': step() !== 'form', }}>
                        <h2>Contact</h2>
                        <label for="checkout-email">Email</label>
                        <input
                            id="checkout-email"
                            name="email"
                            type="email"
                            autocomplete="email"
                            required
                            value={email()}
                            onInput={(e,) => setEmail(e.currentTarget.value,)}
                        />

                        <h2>Shipping address</h2>
                        <div class="shop-checkout__row">
                            <div>
                                <label for="checkout-first-name">First name</label>
                                <input
                                    id="checkout-first-name"
                                    name="given-name"
                                    type="text"
                                    autocomplete="given-name"
                                    value={firstName()}
                                    onInput={(e,) => { setFirstName(e.currentTarget.value,); schedulePreview(); }}
                                />
                            </div>
                            <div>
                                <label for="checkout-last-name">Last name</label>
                                <input
                                    id="checkout-last-name"
                                    name="family-name"
                                    type="text"
                                    autocomplete="family-name"
                                    value={lastName()}
                                    onInput={(e,) => { setLastName(e.currentTarget.value,); schedulePreview(); }}
                                />
                            </div>
                        </div>
                        <label for="checkout-address1">Address line 1</label>
                        <input
                            id="checkout-address1"
                            name="address-line1"
                            type="text"
                            autocomplete="address-line1"
                            value={line1()}
                            onInput={(e,) => { setLine1(e.currentTarget.value,); schedulePreview(); }}
                        />
                        <label for="checkout-address2">Address line 2</label>
                        <input
                            id="checkout-address2"
                            name="address-line2"
                            type="text"
                            autocomplete="address-line2"
                            value={line2()}
                            onInput={(e,) => { setLine2(e.currentTarget.value,); schedulePreview(); }}
                        />
                        <div class="shop-checkout__row">
                            <div>
                                <label for="checkout-city">City</label>
                                <input
                                    id="checkout-city"
                                    name="address-level2"
                                    type="text"
                                    autocomplete="address-level2"
                                    value={city()}
                                    onInput={(e,) => { setCity(e.currentTarget.value,); schedulePreview(); }}
                                />
                            </div>
                            <div>
                                <label for="checkout-state">State / Region</label>
                                <input
                                    id="checkout-state"
                                    name="address-level1"
                                    type="text"
                                    autocomplete="address-level1"
                                    value={stateRegion()}
                                    onInput={(e,) => { setStateRegion(e.currentTarget.value,); schedulePreview(); }}
                                />
                            </div>
                        </div>
                        <div class="shop-checkout__row">
                            <div>
                                <label for="checkout-postal">Postal code</label>
                                <input
                                    id="checkout-postal"
                                    name="postal-code"
                                    type="text"
                                    autocomplete="postal-code"
                                    value={postalCode()}
                                    onInput={(e,) => { setPostalCode(e.currentTarget.value,); schedulePreview(); }}
                                />
                            </div>
                            <div>
                                <label for="checkout-country">Country</label>
                                <input
                                    id="checkout-country"
                                    name="country"
                                    type="text"
                                    autocomplete="country"
                                    value={country()}
                                    onInput={(e,) => { setCountry(e.currentTarget.value,); schedulePreview(); }}
                                />
                            </div>
                        </div>
                        <label for="checkout-phone">Phone (optional)</label>
                        <input
                            id="checkout-phone"
                            name="tel"
                            type="tel"
                            autocomplete="tel"
                            value={phone()}
                            onInput={(e,) => setPhone(e.currentTarget.value,)}
                        />

                        <h2>Payment</h2>
                        <label>Card details</label>
                        <div class="shop-checkout__card" ref={cardElementRef} />
                    </div>

                    {/* Confirm step: a read-only review of everything entered. */}
                    <Show when={step() === 'confirm'}>
                        <div class="shop-checkout__review">
                            <h2>Review &amp; confirm</h2>
                            <p class="shop-checkout__review-lede">
                                Please review your details below, then place your order.
                            </p>
                            <div class="shop-checkout__review-block">
                                <h3>Contact</h3>
                                <p>{email()}</p>
                            </div>
                            <div class="shop-checkout__review-block">
                                <h3>Shipping &amp; billing address</h3>
                                <p>
                                    {fullName()}<br />
                                    {line1()}
                                    <Show when={line2()}>, {line2()}</Show>
                                    <br />
                                    {city()}, {stateRegion()} {postalCode()}<br />
                                    {country()}
                                    <Show when={phone()}>
                                        <br />
                                        {phone()}
                                    </Show>
                                </p>
                            </div>
                            <div class="shop-checkout__review-block">
                                <h3>Payment</h3>
                                <p>
                                    {cardBrand() ? cardBrand().charAt(0,).toUpperCase() + cardBrand().slice(1,) : 'Card'}
                                    {' '}ending in {cardLast4() || '••••'}
                                </p>
                            </div>
                            <button
                                type="button"
                                class="btn btn--ghost shop-checkout__edit"
                                onClick={() => setStep('form',)}
                            >
                                ← Edit details
                            </button>
                        </div>
                    </Show>

                    <aside class="shop-checkout__summary">
                        <h2>Order summary</h2>
                        <div class="shop-checkout__items">
                            <For each={cartItems()}>
                                {(l,) => (
                                    <div class="shop-checkout__item">
                                        <Show when={l.image}>
                                            <img class="shop-checkout__item-img" src={l.image!} alt="" />
                                        </Show>
                                        <div class="shop-checkout__item-info">
                                            <span class="shop-checkout__item-name">
                                                {l.title}{l.variantTitle ? ` — ${l.variantTitle}` : ''}
                                            </span>
                                            <span class="shop-checkout__item-qty">Qty {l.qty}</span>
                                        </div>
                                        <span class="shop-checkout__item-price">
                                            {money(l.priceCents * l.qty, totals()?.currency,)}
                                        </span>
                                    </div>
                                )}
                            </For>
                        </div>
                        <Show when={notice()}>
                            <p class="shop-checkout__notice">{notice()}</p>
                        </Show>
                        <div class="shop-checkout__totals">
                            <div class="shop-checkout__total-row">
                                <span>Subtotal</span>
                                <span>{money(totals()?.subtotalCents ?? cartSubtotal(), totals()?.currency,)}</span>
                            </div>
                            <Show when={totals()}>
                                {(t,) => (
                                    <>
                                        <Show
                                            when={(t().shippingOptions?.length ?? 0) > 1}
                                            fallback={
                                                <>
                                                    <div class="shop-checkout__total-row">
                                                        <span>
                                                            Shipping{t().shippingEstimated
                                                                ? ' (estimate)'
                                                                : t().shippingMethodLabel
                                                                ? ` (${t().shippingMethodLabel})`
                                                                : ''}
                                                        </span>
                                                        <span>{money(t().shippingCents, t().currency,)}</span>
                                                    </div>
                                                    <Show when={t().shippingEstimated}>
                                                        <div class="shop-checkout__shipping-estimate-note">
                                                            Enter your shipping address to calculate shipping
                                                        </div>
                                                    </Show>
                                                    <Show when={shipBd()}>
                                                        {(bd,) => (
                                                            <>
                                                                <div class="shop-checkout__total-row shop-checkout__total-sub">
                                                                    <span>First item shipping</span>
                                                                    <span>1 × {money(bd().firstItemCents, t().currency,)} = {money(bd().firstItemCents, t().currency,)}</span>
                                                                </div>
                                                                <div class="shop-checkout__total-row shop-checkout__total-sub">
                                                                    <span>Additional items shipping</span>
                                                                    <span>{bd().additionalUnits} × {money(bd().additionalItemCents, t().currency,)} = {money(bd().additionalItemCents * bd().additionalUnits, t().currency,)}</span>
                                                                </div>
                                                            </>
                                                        )}
                                                    </Show>
                                                </>
                                            }
                                        >
                                            <div class="shop-checkout__shipping-methods">
                                                <div class="shop-checkout__shipping-methods-label">Shipping method</div>
                                                <For each={t().shippingOptions}>
                                                    {(opt,) => (
                                                        <label class="shop-checkout__shipping-method">
                                                            <input
                                                                type="radio"
                                                                name="shipping-method"
                                                                checked={shippingMethod() === opt.id}
                                                                onChange={() => selectShippingMethod(opt.id,)}
                                                            />
                                                            <span class="shop-checkout__shipping-method-name">{opt.label}</span>
                                                            <span class="shop-checkout__shipping-method-price">{money(opt.cents, t().currency,)}</span>
                                                        </label>
                                                    )}
                                                </For>
                                            </div>
                                        </Show>
                                        <Show when={t().shippingQuoteFailed}>
                                            <p class="shop-checkout__shipping-note">
                                                Live shipping rates are unavailable right now — a standard flat rate has been applied.
                                            </p>
                                        </Show>
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

                        <Show
                            when={step() === 'confirm'}
                            fallback={
                                <>
                                    <p class="shop-checkout__continue-note">
                                        You'll review your order on the next step — you won't be charged yet.
                                    </p>
                                    <button
                                        type="submit"
                                        class="btn btn--primary shop-checkout__place"
                                        disabled={continuing() || !cardReady()}
                                    >
                                        {continuing() ? 'Preparing…' : 'Continue'}
                                    </button>
                                </>
                            }
                        >
                            <button
                                type="submit"
                                class="btn btn--primary shop-checkout__place"
                                disabled={placing()}
                            >
                                {placing() ? 'Processing…' : 'Place Order'}
                            </button>
                        </Show>
                    </aside>
                </form>
            </Show>
        </div>
    );
};

/**
 * Shopify checkout override: no Stripe. Builds a Shopify cart from the local cart
 * lines and full-page-redirects to Shopify's hosted checkout (`cart.checkoutUrl`)
 * — the only supported headless checkout. The subtotal shown is informational;
 * Shopify computes the authoritative price/tax/shipping at checkout.
 */
const ShopifyCheckoutInner: Component = () => {
    const [placing, setPlacing,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const startCheckout = async () => {
        if (cartItems().length === 0) { setError('Your cart is empty.',); return; }
        setError('',);
        setPlacing(true,);
        try {
            const res = await shopifySource.cartCreate(
                cartItems().map((l,) => ({ merchandiseId: l.variantId, quantity: l.qty, }),),
            );
            if (!res?.ok || !res.cart?.checkoutUrl) {
                setError(res?.error || 'Could not start checkout. Please try again.',);
                setPlacing(false,);
                return;
            }
            // Hand off to Shopify's hosted checkout (full-page redirect).
            clearCart();
            window.location.href = res.cart.checkoutUrl;
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Checkout failed. Please try again.',);
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
                <div class="shop-checkout__layout">
                    <aside class="shop-checkout__summary">
                        <h2>Order summary</h2>
                        <ul class="shop-checkout__lines">
                            <For each={cartItems()}>
                                {(l,) => (
                                    <li class="shop-checkout__line">
                                        <span>{l.title}{l.variantTitle ? ` — ${l.variantTitle}` : ''} × {l.qty}</span>
                                        <span>{money(l.priceCents * l.qty,)}</span>
                                    </li>
                                )}
                            </For>
                        </ul>
                        <div class="shop-checkout__total-row shop-checkout__total-row--grand">
                            <span>Subtotal</span>
                            <strong>{money(cartSubtotal(),)}</strong>
                        </div>
                        <p class="shop-checkout__updating">
                            Taxes &amp; shipping are calculated at Shopify's secure checkout.
                        </p>
                        <Show when={error()}>
                            <div class="shop-store__error">{error()}</div>
                        </Show>
                        <button
                            type="button"
                            class="btn btn--primary shop-checkout__place"
                            disabled={placing()}
                            onClick={startCheckout}
                        >
                            {placing() ? 'Redirecting…' : 'Continue to secure checkout'}
                        </button>
                    </aside>
                </div>
            </Show>
        </div>
    );
};

const ShopCheckout: Component = () => (
    <ShopStoreGuard>
        <Show when={isShopifyActive()} fallback={<ShopCheckoutInner />}>
            <ShopifyCheckoutInner />
        </Show>
    </ShopStoreGuard>
);

export default ShopCheckout;
