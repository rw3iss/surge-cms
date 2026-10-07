/**
 * `/subscribe` → the member's subscription manager (profile → Membership),
 * where tiers are chosen, paid for (card form) and changed. Signed-out visitors
 * go through the login page and come back to the same tab.
 *
 * This used to be its own page whose "Subscribe" button started a Stripe
 * subscription without ever collecting a card — it reported success while
 * nothing was paid. One place to manage a subscription is simpler and correct.
 */
import { useNavigate, } from '@solidjs/router';
import { createEffect, type Component, } from 'solid-js';
import { useAuth, } from '../stores/auth';

const MEMBERSHIP = '/profile?tab=membership';

const SubscribeRedirect: Component = () => {
    const auth = useAuth();
    const navigate = useNavigate();
    createEffect(() => {
        if (auth.isLoading) return;
        navigate(auth.user ? MEMBERSHIP : `/login?redirect=${encodeURIComponent(MEMBERSHIP,)}`, { replace: true, },);
    },);
    return <p style={{ padding: '3rem 1rem', 'text-align': 'center', }}>Loading…</p>;
};

export default SubscribeRedirect;
