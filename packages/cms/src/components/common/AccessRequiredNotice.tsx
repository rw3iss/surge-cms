/**
 * Inline "you can't do this yet" message for a sign-in / subscription gate
 * (event registration, a ticket type, checkout). Signed out → "Sign in"
 * (in-page LoginModal, then `onLoggedIn`); a subscription gate → "Upgrade your
 * subscription" (profile Membership tab with the tier, or /subscribe when
 * signed out). For a full-page gate use UpgradeTout instead.
 */
import { A, } from '@solidjs/router';
import { Component, createSignal, Show, } from 'solid-js';
import { useAuth, } from '../../stores/auth';
import { upgradeHref, } from '../../utils/accessRequired';
import LoginModal from '../auth/LoginModal';
import './AccessRequiredNotice.scss';

export interface AccessRequiredNoticeProps {
    reason: 'signin' | 'subscribe';
    requiredTier: { id: string; name: string; } | null;
    /** The sentence to show (the server's message, or the caller's own). */
    message: string;
    onLoggedIn?: () => void;
    /** Label of the sign-in button (default "Sign in"). */
    signInLabel?: string;
    /** Signed out: add "(or create an account)" linking to /join. */
    offerJoin?: boolean;
    /** Smaller, for a ticket row. */
    compact?: boolean;
    class?: string;
}

const AccessRequiredNotice: Component<AccessRequiredNoticeProps> = (props,) => {
    const auth = useAuth();
    const [loginOpen, setLoginOpen,] = createSignal(false,);
    const signedIn = () => Boolean(auth.user,);

    return (
        <div
            class={`access-required${props.compact ? ' access-required--compact' : ''}${props.class ? ` ${props.class}` : ''}`}
            role="status"
        >
            <span class="access-required__message">{props.message}</span>{' '}
            <Show
                when={props.reason === 'subscribe' && signedIn()}
                fallback={
                    <Show
                        when={!signedIn()}
                        fallback={<A class="access-required__link" href={upgradeHref(props.requiredTier, true,)}>Upgrade your membership</A>}
                    >
                        <button type="button" class="access-required__link" onClick={() => setLoginOpen(true,)}>{props.signInLabel || 'Sign in'}</button>
                        <Show when={props.offerJoin && props.reason === 'signin'}>
                            {' '}(or <A class="access-required__link" href="/join">create an account</A>)
                        </Show>
                        <Show when={props.reason === 'subscribe'}>
                            {' '}or <A class="access-required__link" href={upgradeHref(props.requiredTier, false,)}>see membership plans</A>
                        </Show>
                    </Show>
                }
            >
                <A class="access-required__link" href={upgradeHref(props.requiredTier, true,)}>Upgrade your membership</A>
            </Show>
            <Show when={loginOpen()}>
                <LoginModal
                    onClose={() => setLoginOpen(false,)}
                    onSuccess={() => {
                        setLoginOpen(false,);
                        props.onLoggedIn?.();
                    }}
                />
            </Show>
        </div>
    );
};

export default AccessRequiredNotice;
