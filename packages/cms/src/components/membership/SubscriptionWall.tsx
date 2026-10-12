/**
 * Shown INSTEAD of the page when subscription-required mode is on and the
 * signed-in member is restricted (no active subscription at the minimum
 * tier, or — after paying — an unverified email). Rendered by the public
 * Layout; staff are never restricted. Allowed routes are decided by
 * `isOpenPath` (subscribe, profile, account pages, "open" CMS pages).
 */
import type { MemberAccessState, } from '@sitesurge/types';
import { A, useNavigate, } from '@solidjs/router';
import { Component, createSignal, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import './SubscriptionWall.scss';

/** Routes a restricted member may always use. */
const ALWAYS_OPEN = ['/subscribe', '/profile', '/login', '/join', '/verify', '/forgot-password', '/reset-password', '/u/', '/lists/',];

export function isOpenPath(path: string, openPaths: string[],): boolean {
    const p = path.replace(/\/+$/, '',) || '/';
    if (openPaths.includes(p,)) return true;
    return ALWAYS_OPEN.some((o,) => (o.endsWith('/',) ? p.startsWith(o,) : p === o || p.startsWith(`${o}/`,)));
}

const SubscriptionWall: Component<{ access: MemberAccessState; }> = (props,) => {
    const auth = useAuth();
    const navigate = useNavigate();
    const [sent, setSent,] = createSignal<'idle' | 'sending' | 'sent' | 'error'>('idle',);
    const [checking, setChecking,] = createSignal(false,);

    const resend = async () => {
        setSent('sending',);
        try {
            await cms.auth.resendVerification();
            setSent('sent',);
        } catch {
            setSent('error',);
        }
    };
    const recheck = async () => {
        setChecking(true,);
        await auth.refreshUser();
        setChecking(false,);
    };
    const logout = async () => {
        await auth.logout();
        navigate('/',);
    };

    return (
        <section class="subscription-wall page-wrapper" aria-labelledby="subscription-wall-title">
            <div class="subscription-wall__card">
                <Show
                    when={props.access.reason === 'verify_email'}
                    fallback={
                        <>
                            <h1 id="subscription-wall-title">{props.access.lapsed ? 'Your membership has ended' : 'A subscription is required'}</h1>
                            <p>
                                {props.access.lapsed
                                    ? 'Renew your subscription — or update your payment method if a payment failed — to get back to everything.'
                                    : 'Choose a membership plan to get access. It only takes a minute.'}
                            </p>
                            <div class="subscription-wall__actions">
                                <A href="/subscribe" class="btn btn--primary">{props.access.lapsed ? 'Renew my subscription' : 'Choose a plan'}</A>
                                <A href="/profile?tab=membership" class="btn btn--outline">Manage membership &amp; payment</A>
                            </div>
                        </>
                    }
                >
                    <h1 id="subscription-wall-title">Verify your email</h1>
                    <p>
                        Your subscription is active. We sent a verification link to <strong>{auth.user?.email}</strong> — open it to finish
                        setting up your account.
                    </p>
                    <div class="subscription-wall__actions">
                        <button type="button" class="btn btn--primary" disabled={checking()} onClick={recheck}>
                            {checking() ? 'Checking…' : 'I have verified it'}
                        </button>
                        <button type="button" class="btn btn--outline" disabled={sent() === 'sending'} onClick={resend}>
                            {sent() === 'sending' ? 'Sending…' : 'Send the link again'}
                        </button>
                    </div>
                    <Show when={sent() === 'sent'}><p class="subscription-wall__note">A new link is on its way.</p></Show>
                    <Show when={sent() === 'error'}><p class="subscription-wall__note">Could not send it — try again in a minute.</p></Show>
                </Show>
                <p class="subscription-wall__foot">
                    Signed in as {auth.user?.email}. <button type="button" class="subscription-wall__link" onClick={logout}>Log out</button>
                </p>
            </div>
        </section>
    );
};

export default SubscriptionWall;
