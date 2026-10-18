/**
 * The signed-in user as a small card: avatar (their picture, else their
 * initials) beside their name and email. The avatar is exactly as tall as the
 * two text lines. Renders nothing when nobody is signed in.
 *
 * Public — colours, radius and fonts read the site tokens. Use it wherever the
 * site shows "you are signed in as…" (event sign-up, checkout, forms).
 *
 *   <CurrentUserCard label="Signing up as" />
 *   <CurrentUserCard showLogout profileLink />
 */
import type { User, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createSignal, Show, } from 'solid-js';
import { useAuth, } from '../../stores/auth';
import { userInitials, } from '../../utils/userInitials';
import './CurrentUserCard.scss';

export interface CurrentUserCardProps {
    /** Show this user instead of the signed-in one. */
    user?: Pick<User, 'displayName' | 'email' | 'avatarUrl' | 'firstName' | 'lastName'> | null;
    /** Small caption above the card, e.g. "Signing up as". */
    label?: string;
    /** Link the name to the profile page (`true` = /profile, or a path). */
    profileLink?: boolean | string;
    /** A "Not you? Sign out" line under the card. */
    showLogout?: boolean;
    /** Text of the sign-out link (default "Not you? Sign out"). */
    logoutLabel?: string;
    /** Called after signing out. */
    onLogout?: () => void;
    /** `sm` for tight spaces (sidebars), `md` default. */
    size?: 'sm' | 'md';
    /** Plain = no border/background (inside another card). */
    variant?: 'card' | 'plain';
    class?: string;
}

/** Full name from the profile, else the display name, else the email. */
export const userDisplayName = (u: CurrentUserCardProps['user'],): string => {
    if (!u) return '';
    const full = [u.firstName, u.lastName,].filter(Boolean,).join(' ',).trim();
    return full || u.displayName || u.email || '';
};

const CurrentUserCard: Component<CurrentUserCardProps> = (props,) => {
    const auth = useAuth();
    const user = () => (props.user !== undefined ? props.user : auth.user);
    const name = () => userDisplayName(user(),);
    const [imgFailed, setImgFailed,] = createSignal(false,);
    const [signingOut, setSigningOut,] = createSignal(false,);
    const profileHref = () => (typeof props.profileLink === 'string' ? props.profileLink : '/profile');

    const logout = async () => {
        setSigningOut(true,);
        try {
            await auth.logout();
            props.onLogout?.();
        } finally {
            setSigningOut(false,);
        }
    };

    return (
        <Show when={user()}>
            {(u,) => (
                <div
                    class={`current-user current-user--${props.size ?? 'md'} current-user--${props.variant ?? 'card'}${
                        props.class ? ` ${props.class}` : ''
                    }`}
                >
                    <Show when={props.label}>
                        <p class="current-user__label">{props.label}</p>
                    </Show>
                    <div class="current-user__card">
                        <Show
                            when={u().avatarUrl && !imgFailed()}
                            fallback={<span class="current-user__avatar current-user__avatar--initials" aria-hidden="true">{userInitials(name(),)}</span>}
                        >
                            <img class="current-user__avatar" src={u().avatarUrl!} alt="" onError={() => setImgFailed(true,)} />
                        </Show>
                        <div class="current-user__text">
                            <Show when={props.profileLink} fallback={<span class="current-user__name">{name()}</span>}>
                                <A class="current-user__name current-user__name--link" href={profileHref()}>{name()}</A>
                            </Show>
                            <Show when={u().email && u().email !== name()}>
                                <span class="current-user__email">{u().email}</span>
                            </Show>
                        </div>
                    </div>
                    <Show when={props.showLogout && props.user === undefined}>
                        <button type="button" class="current-user__logout" disabled={signingOut()} onClick={logout}>
                            {props.logoutLabel ?? 'Not you? Sign out'}
                        </button>
                    </Show>
                </div>
            )}
        </Show>
    );
};

export default CurrentUserCard;
