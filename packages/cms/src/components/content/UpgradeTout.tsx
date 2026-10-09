/**
 * "Upgrade account" prompt for content a viewer's subscription does not cover.
 *
 * Reusable anywhere gated content is cut short (a post with no sample, the end
 * of a sample, later: videos, pages). It names the tier the content needs and
 * offers the next step:
 *   signed out → "Log in" (the in-page modal; on success the caller refetches
 *                so the content unlocks in place) + "Join"
 *   signed in  → "Upgrade account" → profile → Membership tab
 */
import { A, } from '@solidjs/router';
import type { PostGateTier, } from '@sitesurge/types';
import { Component, createSignal, type JSX, Show, } from 'solid-js';
import { useAuth, } from '../../stores/auth';
import LoginModal from '../auth/LoginModal';
import './UpgradeTout.scss';

export const MEMBERSHIP_TAB_URL = '/profile?tab=membership';

export interface UpgradeToutProps {
    requiredTier?: Pick<PostGateTier, 'name'> | null;
    /** Headline; default "Subscribe to keep reading". */
    title?: string;
    /** Body text; default names the tier. */
    message?: JSX.Element | string;
    /** Called after an in-page login succeeds (refetch the content). */
    onLoggedIn?: () => void;
    /** `continue`: shown under a sample (softer headline). */
    variant?: 'locked' | 'continue';
    class?: string;
}

const UpgradeTout: Component<UpgradeToutProps> = (props,) => {
    const auth = useAuth();
    const [loginOpen, setLoginOpen,] = createSignal(false,);
    const tier = () => props.requiredTier?.name;
    const title = () => props.title ?? (props.variant === 'continue' ? 'Subscribe to keep reading' : 'Subscriber content');
    const message = () => props.message ?? (
        tier()
            ? <>This content requires the <strong>{tier()}</strong> subscription.</>
            : 'This content requires a subscription.'
    );
    const here = () => `${window.location.pathname}${window.location.search}`;

    return (
        <aside class={`upgrade-tout upgrade-tout--${props.variant ?? 'locked'}${props.class ? ` ${props.class}` : ''}`}>
            <div class="upgrade-tout__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            </div>
            <div class="upgrade-tout__body">
                <h3 class="upgrade-tout__title">{title()}</h3>
                <p class="upgrade-tout__message">{message()}</p>
                <div class="upgrade-tout__actions">
                    <Show
                        when={auth.isAuthenticated}
                        fallback={
                            <>
                                <button type="button" class="btn upgrade-tout__btn" onClick={() => setLoginOpen(true,)}>
                                    Log in
                                </button>
                                <A class="upgrade-tout__link" href={`/join?redirect=${encodeURIComponent(here(),)}`}>
                                    Create an account
                                </A>
                            </>
                        }
                    >
                        <A class="btn upgrade-tout__btn" href={MEMBERSHIP_TAB_URL}>Upgrade account</A>
                    </Show>
                </div>
            </div>
            <Show when={loginOpen()}>
                <LoginModal
                    title="Log in to continue"
                    onClose={() => setLoginOpen(false,)}
                    onSuccess={() => {
                        setLoginOpen(false,);
                        props.onLoggedIn?.();
                    }}
                />
            </Show>
        </aside>
    );
};

export default UpgradeTout;
