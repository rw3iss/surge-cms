import { loadStripe, Stripe, StripeCardElement, } from '@stripe/stripe-js';
import { Component, createSignal, onMount, Show, } from 'solid-js';
import { api, } from '../services/api';
import { useAuth, } from '../stores/auth';
import './DonationForm.scss';

interface DonationFormProps {
    campaignId?: string;
}

const PRESET_AMOUNTS = [500, 1000, 2500, 5000, 10000,];

const DonationForm: Component<DonationFormProps> = (props,) => {
    const auth = useAuth();
    let cardElementRef: HTMLDivElement | undefined;
    let cardElement: StripeCardElement | null = null;
    let stripeInstance: Stripe | null = null;

    const [selectedAmount, setSelectedAmount,] = createSignal(2500,);
    const [customAmount, setCustomAmount,] = createSignal('',);
    const [isCustom, setIsCustom,] = createSignal(false,);
    const [donorName, setDonorName,] = createSignal(auth.user?.displayName || '',);
    const [donorEmail, setDonorEmail,] = createSignal(auth.user?.email || '',);
    const [message, setMessage,] = createSignal('',);
    const [visibility, setVisibility,] = createSignal<'public' | 'anonymous' | 'hidden'>('public',);
    const [loading, setLoading,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [success, setSuccess,] = createSignal(false,);
    const [cardReady, setCardReady,] = createSignal(false,);

    onMount(async () => {
        const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
        if (!key) {
            setError('Stripe is not configured',);
            return;
        }

        stripeInstance = await loadStripe(key,);
        if (!stripeInstance) {
            setError('Failed to load payment system',);
            return;
        }

        const elements = stripeInstance.elements();
        cardElement = elements.create('card', {
            style: {
                base: {
                    fontSize: '16px',
                    color: '#333',
                    '::placeholder': { color: '#aab7c4', },
                },
            },
        },);

        if (cardElementRef) {
            cardElement.mount(cardElementRef,);
            cardElement.on('ready', () => setCardReady(true,),);
        }
    },);

    const getAmountCents = (): number => {
        if (isCustom()) {
            const val = parseFloat(customAmount(),);
            return isNaN(val,) ? 0 : Math.round(val * 100,);
        }
        return selectedAmount();
    };

    const handlePresetClick = (amount: number,) => {
        setIsCustom(false,);
        setSelectedAmount(amount,);
    };

    const handleCustomFocus = () => {
        setIsCustom(true,);
    };

    const handleSubmit = async (e: Event,) => {
        e.preventDefault();
        setError('',);

        const amountCents = getAmountCents();
        if (amountCents < 100) {
            setError('Minimum donation is $1.00',);
            return;
        }

        if (!donorEmail()) {
            setError('Email is required',);
            return;
        }

        if (!stripeInstance || !cardElement) {
            setError('Payment system not ready',);
            return;
        }

        setLoading(true,);

        try {
            const response = await api.post<{ clientSecret: string; paymentIntentId: string; }>(
                '/payments/donate',
                {
                    amountCents,
                    campaignId: props.campaignId,
                    donorName: donorName() || undefined,
                    donorEmail: donorEmail(),
                    message: message() || undefined,
                    visibility: visibility(),
                },
            );

            if (!response.success) {
                setError((response as any).error?.message || 'Failed to create donation',);
                setLoading(false,);
                return;
            }

            const { clientSecret, } = (response as any).data;

            const result = await stripeInstance.confirmCardPayment(clientSecret, {
                payment_method: {
                    card: cardElement,
                    billing_details: {
                        name: donorName() || undefined,
                        email: donorEmail(),
                    },
                },
            },);

            if (result.error) {
                setError(result.error.message || 'Payment failed',);
            } else if (result.paymentIntent?.status === 'succeeded') {
                setSuccess(true,);
            }
        } catch (err) {
            setError('An unexpected error occurred',);
        } finally {
            setLoading(false,);
        }
    };

    return (
        <div class="donation-form">
            <Show
                when={success()}
                fallback={
                    <form onSubmit={handleSubmit}>
                        <h3>Make a Donation</h3>

                        <div class="donation-form__amounts">
                            {PRESET_AMOUNTS.map((amount,) => (
                                <button
                                    type="button"
                                    class={`donation-form__amount-btn ${
                                        !isCustom() && selectedAmount() === amount ? 'active' : ''
                                    }`}
                                    onClick={() => handlePresetClick(amount,)}
                                >
                                    ${(amount / 100).toLocaleString()}
                                </button>
                            ))}
                            <div class={`donation-form__custom-amount ${isCustom() ? 'active' : ''}`}>
                                <span class="donation-form__currency">$</span>
                                <input
                                    type="number"
                                    min="1"
                                    step="0.01"
                                    placeholder="Other"
                                    value={customAmount()}
                                    onInput={(e,) => setCustomAmount(e.currentTarget.value,)}
                                    onFocus={handleCustomFocus}
                                />
                            </div>
                        </div>

                        <div class="donation-form__fields">
                            <div class="donation-form__row">
                                <div class="donation-form__field">
                                    <label>Name (optional)</label>
                                    <input
                                        type="text"
                                        value={donorName()}
                                        onInput={(e,) => setDonorName(e.currentTarget.value,)}
                                        placeholder="Your name"
                                    />
                                </div>
                                <div class="donation-form__field">
                                    <label>Email</label>
                                    <input
                                        type="email"
                                        value={donorEmail()}
                                        onInput={(e,) => setDonorEmail(e.currentTarget.value,)}
                                        placeholder="your@email.com"
                                        required
                                    />
                                </div>
                            </div>

                            <div class="donation-form__field">
                                <label>Message (optional)</label>
                                <textarea
                                    value={message()}
                                    onInput={(e,) => setMessage(e.currentTarget.value,)}
                                    placeholder="Leave a message..."
                                    maxLength={500}
                                    rows={2}
                                />
                            </div>

                            <div class="donation-form__field">
                                <label>Visibility</label>
                                <select
                                    value={visibility()}
                                    onChange={(e,) => setVisibility(e.currentTarget.value as any,)}
                                >
                                    <option value="public">Public (show name and message)</option>
                                    <option value="anonymous">Anonymous (hide name)</option>
                                    <option value="hidden">Hidden (don't show donation)</option>
                                </select>
                            </div>

                            <div class="donation-form__field">
                                <label>Card Details</label>
                                <div class="donation-form__card-element" ref={cardElementRef} />
                            </div>
                        </div>

                        <Show when={error()}>
                            <div class="donation-form__error">{error()}</div>
                        </Show>

                        <button
                            type="submit"
                            class="btn btn--primary donation-form__submit"
                            disabled={loading() || !cardReady()}
                        >
                            {loading() ? 'Processing...' : `Donate $${(getAmountCents() / 100).toFixed(2,)}`}
                        </button>
                    </form>
                }
            >
                <div class="donation-form__success">
                    <h3>Thank you!</h3>
                    <p>Your donation of ${(getAmountCents() / 100).toFixed(2,)} has been processed successfully.</p>
                </div>
            </Show>
        </div>
    );
};

export default DonationForm;
