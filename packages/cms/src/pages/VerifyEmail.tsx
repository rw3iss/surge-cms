/**
 * Public email-verification landing page (`/verify?token=…`).
 *
 * Consumes the token from the verification email link. On success the backend
 * logs the user in (sets the httpOnly cookie pair), so we do a full-page
 * navigation to `/` afterwards to let the AuthProvider pick up the live
 * session. A stale/used/invalid token shows an error with a link to sign in.
 */
import { A, useSearchParams, } from '@solidjs/router';
import { Component, createSignal, onMount, Show, } from 'solid-js';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import { siteName, } from '../stores/siteSettings';
import './Join.scss';

const VerifyEmail: Component = () => {
    const [params,] = useSearchParams();
    const [status, setStatus,] = createSignal<'verifying' | 'success' | 'error'>('verifying',);
    const [message, setMessage,] = createSignal('',);

    onMount(async () => {
        const token = typeof params.token === 'string' ? params.token : '';
        if (!token) {
            setStatus('error',);
            setMessage('This verification link is missing its token.',);
            return;
        }
        try {
            await cms.auth.verifyEmail({ token, },);
            setStatus('success',);
        } catch (err) {
            setStatus('error',);
            setMessage(err instanceof Error ? err.message : 'Verification failed.',);
        }
    },);

    return (
        <div class="join">
            <SeoHead title="Verify Email" noindex={true} nofollow={true} />
            <div class="join__container">
                <Show when={status() === 'verifying'}>
                    <h1 class="join__title">Verifying…</h1>
                    <p class="join__subtitle">Confirming your email address.</p>
                </Show>

                <Show when={status() === 'success'}>
                    <div class="join__success">
                        <svg class="join__success-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                            <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                        <h2>Email Verified</h2>
                        <p>Your email address has been confirmed and you're now signed in to {siteName()}.</p>
                        <button class="join__btn join__btn--primary" onClick={() => window.location.assign('/',)}>
                            Continue
                        </button>
                    </div>
                </Show>

                <Show when={status() === 'error'}>
                    <div class="join__success">
                        <h2>Verification Failed</h2>
                        <p>{message()}</p>
                        <A href="/login" class="join__btn join__btn--primary">Go to Sign In</A>
                    </div>
                </Show>
            </div>
        </div>
    );
};

export default VerifyEmail;
