import { loadStripe, Stripe, } from '@stripe/stripe-js';
import { Component, createResource, createSignal, For, onMount, Show, } from 'solid-js';
import SeoHead from '../components/common/seo/SeoHead';
import { siteName, } from '../stores/siteSettings';
import { api, } from '../services/api';
import { useAuth, } from '../stores/auth';

interface Plan {
    id: string;
    name: string;
    description: string;
    priceCents: number;
    interval: string;
    features: string[];
}

interface UserSubscription {
    id: string;
    planName: string;
    status: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
}

const SubscribePage: Component = () => {
    const auth = useAuth();
    let stripeInstance: Stripe | null = null;

    const [subscribing, setSubscribing,] = createSignal<string | null>(null,);
    const [cancelling, setCancelling,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [successMessage, setSuccessMessage,] = createSignal('',);

    const [plans,] = createResource(async () => {
        const response = await api.get<Plan[]>('/payments/plans',);
        return response.success ? (response as any).data as Plan[] : [];
    },);

    const [subscriptions, { refetch: refetchSubs, },] = createResource(async () => {
        if (!auth.user) return [];
        const response = await api.get<UserSubscription[]>('/payments/subscriptions',);
        return response.success ? (response as any).data as UserSubscription[] : [];
    },);

    onMount(async () => {
        const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
        if (key) {
            stripeInstance = await loadStripe(key,);
        }
    },);

    const activeSub = () => {
        const subs = subscriptions();
        if (!subs) return null;
        return subs.find((s,) => s.status === 'active' && !s.cancelAtPeriodEnd) || null;
    };

    const cancelledSub = () => {
        const subs = subscriptions();
        if (!subs) return null;
        return subs.find((s,) => s.cancelAtPeriodEnd) || null;
    };

    const handleSubscribe = async (planId: string,) => {
        if (!auth.user) {
            setError('Please log in to subscribe',);
            return;
        }

        setError('',);
        setSuccessMessage('',);
        setSubscribing(planId,);

        try {
            const response = await api.post<{ subscriptionId: string; status: string; clientSecret?: string; }>(
                '/payments/subscribe',
                { planId, },
            );

            if (!response.success) {
                setError((response as any).error?.message || 'Failed to create subscription',);
                setSubscribing(null,);
                return;
            }

            const data = (response as any).data;

            if (data.clientSecret && stripeInstance) {
                const result = await stripeInstance.confirmCardPayment(data.clientSecret,);
                if (result.error) {
                    setError(result.error.message || 'Payment failed',);
                    setSubscribing(null,);
                    return;
                }
            }

            setSuccessMessage('Subscription created successfully!',);
            refetchSubs();
        } catch (err) {
            setError('An unexpected error occurred',);
        } finally {
            setSubscribing(null,);
        }
    };

    const handleCancel = async () => {
        setError('',);
        setSuccessMessage('',);
        setCancelling(true,);

        try {
            const response = await api.post('/payments/unsubscribe',);

            if (!response.success) {
                setError((response as any).error?.message || 'Failed to cancel subscription',);
            } else {
                setSuccessMessage('Subscription will cancel at end of billing period',);
                refetchSubs();
            }
        } catch (err) {
            setError('An unexpected error occurred',);
        } finally {
            setCancelling(false,);
        }
    };

    return (
        <div class="subscribe-page container">
            <SeoHead
                title="Subscribe"
                description={`Subscribe to ${siteName()} to support independent journalism.`}
                noindex={true}
                nofollow={true}
            />
            <h1>Subscription Plans</h1>

            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            <Show when={successMessage()}>
                <div class="alert alert--success">{successMessage()}</div>
            </Show>

            <Show when={activeSub()}>
                {(sub,) => (
                    <div class="subscribe-page__current">
                        <h3>Current Plan: {sub().planName}</h3>
                        <p>
                            Status: <span class="badge badge--success">{sub().status}</span>
                        </p>
                        <p>
                            Next billing: {new Date(sub().currentPeriodEnd,).toLocaleDateString()}
                        </p>
                        <button
                            class="btn btn--secondary"
                            onClick={handleCancel}
                            disabled={cancelling()}
                        >
                            {cancelling() ? 'Cancelling...' : 'Cancel Subscription'}
                        </button>
                    </div>
                )}
            </Show>

            <Show when={cancelledSub()}>
                {(sub,) => (
                    <div class="subscribe-page__current subscribe-page__current--cancelled">
                        <h3>Plan: {sub().planName} (Cancelling)</h3>
                        <p>Access continues until: {new Date(sub().currentPeriodEnd,).toLocaleDateString()}</p>
                    </div>
                )}
            </Show>

            <div class="subscribe-page__plans">
                <For each={plans()} fallback={<p>Loading plans...</p>}>
                    {(plan,) => (
                        <div class="subscribe-page__plan">
                            <h3>{plan.name}</h3>
                            <div class="subscribe-page__price">
                                <span class="subscribe-page__amount">${(plan.priceCents / 100).toFixed(2,)}</span>
                                <span class="subscribe-page__interval">/{plan.interval}</span>
                            </div>
                            <Show when={plan.description}>
                                <p class="subscribe-page__description">{plan.description}</p>
                            </Show>
                            <Show when={plan.features?.length}>
                                <ul class="subscribe-page__features">
                                    <For each={plan.features}>
                                        {(feature,) => <li>{feature}</li>}
                                    </For>
                                </ul>
                            </Show>
                            <button
                                class="btn btn--primary"
                                onClick={() => handleSubscribe(plan.id,)}
                                disabled={!!subscribing() || !!activeSub()}
                            >
                                {subscribing() === plan.id ?
                                    'Processing...' :
                                    activeSub() ?
                                    'Already Subscribed' :
                                    'Subscribe'}
                            </button>
                        </div>
                    )}
                </For>
            </div>
        </div>
    );
};

export default SubscribePage;
