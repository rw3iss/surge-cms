/**
 * The sign-in form — email/password, Patreon, the Register prompt and the
 * forgot-password link — shared by the `/login` PAGE and `LoginModal`.
 *
 * It signs in and reports success; WHERE to go next is the caller's decision.
 * The page navigates; the modal just closes, leaving the visitor where they
 * were with the signed-in state already applied, because `auth.login` updates
 * the app-wide user signal that everything else reads.
 */
import type { User, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createSignal, Show, } from 'solid-js';
import { useAuth, } from '../../stores/auth';
import { isFeatureEnabled, isPatreonEnabled, } from '../../stores/siteSettings';
import Toggle from '../admin/common/Toggle';
import '../../pages/Login.scss';

export interface LoginFormProps {
    /** Called after a successful email/password sign-in. */
    onSuccess?: (user: User | null,) => void;
    /** Where Patreon should return after its OAuth round-trip. Defaults to the
     *  current page, so signing in from a modal lands back where it started. */
    returnTo?: string;
    /** A message to show above the form (e.g. an OAuth error from the URL). */
    initialError?: string | null;
    /** Prefix for input ids, so a page and a modal can coexist. */
    idPrefix?: string;
}

const LoginForm: Component<LoginFormProps> = (props,) => {
    const [email, setEmail,] = createSignal('',);
    const [password, setPassword,] = createSignal('',);
    const [rememberMe, setRememberMe,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [isLoading, setIsLoading,] = createSignal(false,);
    const [showAdminForm, setShowAdminForm,] = createSignal(false,);
    const auth = useAuth();
    const id = (s: string,) => `${props.idPrefix ?? 'login'}-${s}`;

    /*
     * Whether the email/password form renders expanded by default:
     *   - Users ON → expanded (login is the primary action).
     *   - Users OFF, Patreon OFF → expanded (admin-only mode).
     *   - Users OFF, Patreon ON → collapsed behind "Login as administrator".
     */
    const usersEnabled = () => isFeatureEnabled('users',);
    const showFormByDefault = () => usersEnabled() || !isPatreonEnabled();
    const adminFormVisible = () => showFormByDefault() || showAdminForm();
    const showDisclosure = () => !showFormByDefault();

    const handleEmailLogin = async (e: Event,) => {
        e.preventDefault();
        setError('',);
        setIsLoading(true,);
        try {
            await auth.login(email(), password(), rememberMe(),);
            // Offer to save the credential where the browser supports it.
            if ((window as any).PasswordCredential) {
                try {
                    const cred = new (window as any).PasswordCredential({
                        id: email(),
                        password: password(),
                        name: email(),
                    },);
                    await navigator.credentials.store(cred,);
                } catch {
                    // Optional convenience; never block sign-in on it.
                }
            }
            props.onSuccess?.(auth.user ?? null,);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Login failed',);
        } finally {
            setIsLoading(false,);
        }
    };

    const handlePatreonLogin = () => {
        const target = props.returnTo ??
            (typeof window !== 'undefined' ? window.location.pathname + window.location.search : '');
        if (target && target.startsWith('/',) && !target.startsWith('//',)) {
            document.cookie = `returnUrl=${target};path=/;max-age=600`;
        }
        auth.loginWithPatreon();
    };

    return (
        <>
            <Show when={props.initialError}>
                <div class="login__error">{props.initialError}</div>
            </Show>
            {
                /* Patreon login button — only when the Patreon
            feature is enabled AND a Patreon account is
            connected (see /settings/public). Independent of
            the Users feature; sites can run Patreon without
            public registration, or vice versa. */
            }
            <Show when={isPatreonEnabled()}>
                <button
                    type="button"
                    class="login__btn login__btn--patreon"
                    onClick={handlePatreonLogin}
                >
                    <svg class="login__btn-icon" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M15.385.5c-4.764 0-8.615 3.851-8.615 8.615 0 4.764 3.851 8.616 8.615 8.616 4.764 0 8.615-3.852 8.615-8.616S20.149.5 15.385.5zM.5 23.5h4.615V.5H.5v23z" />
                    </svg>
                    Continue with Patreon
                </button>
            </Show>

            {
                /* "Don't have an account? Join" — gated on Users:
            registration is only meaningful when public sign-up
            is enabled. */
            }
            <Show when={usersEnabled()}>
                <div class="login__join-prompt">
                    <span>Don't have an account?</span>
                    <A href="/join" class="login__join-link">Register</A>
                </div>
            </Show>

            {
                /* Admin-form disclosure — only renders when the form
            is hidden by default (Patreon visible AND Users
            disabled). In every other mode the form is already
            expanded, so the toggle would be redundant. */
            }
            <Show when={showDisclosure()}>
                <div class="login__admin-toggle">
                    <button
                        type="button"
                        class="login__admin-link"
                        onClick={() => setShowAdminForm(!showAdminForm(),)}
                    >
                        {showAdminForm() ? 'Hide admin login' : 'Login as administrator'}
                    </button>
                </div>
            </Show>

            <div class={`login__admin-form ${adminFormVisible() ? 'login__admin-form--visible' : ''}`}>
                {
                    /* Divider shown only when there's another auth
                option above (Patreon button) — its label
                depends on whether the email form is the
                admin-only fallback or a peer login method. */
                }
                <Show when={isPatreonEnabled()}>
                    <div class="login__divider">
                        <span>{usersEnabled() ? 'Or sign in with email' : 'Admin'}</span>
                    </div>
                </Show>

                <Show when={error()}>
                    <div class="login__error">
                        {error()}
                    </div>
                </Show>

                <form class="login__form" onSubmit={handleEmailLogin} action="/login" method="post">
                    <div class="login__field">
                        <label for={id('email',)} class="login__label">Email</label>
                        <input
                            type="email"
                            id={id('email',)}
                            name="email"
                            autocomplete="email"
                            class="login__input"
                            value={email()}
                            onInput={(e,) => setEmail(e.currentTarget.value,)}
                            onChange={(e,) => setEmail(e.currentTarget.value,)}
                            placeholder="you@example.com"
                            required
                            disabled={isLoading()}
                        />
                    </div>

                    <div class="login__field">
                        <label for={id('password',)} class="login__label">Password</label>
                        <input
                            type="password"
                            id={id('password',)}
                            name="password"
                            autocomplete="current-password"
                            class="login__input"
                            value={password()}
                            onInput={(e,) => setPassword(e.currentTarget.value,)}
                            onChange={(e,) => setPassword(e.currentTarget.value,)}
                            placeholder="Enter your password"
                            required
                            disabled={isLoading()}
                        />
                    </div>

                    <div class="login__remember">
                        <Toggle
                            checked={rememberMe()}
                            onChange={setRememberMe}
                            label="Remember me for 30 days"
                            class="login__remember-label"
                        />
                    </div>

                    <button
                        type="submit"
                        class="login__btn login__btn--primary"
                        disabled={isLoading()}
                    >
                        {isLoading() ? 'Signing in...' : 'Sign In'}
                    </button>

                    {
                        /* Below the submit, centred: the recovery route is
                    what you want AFTER trying to sign in, not a
                    distraction while filling the form in. */
                    }
                    <div class="login__forgot">
                        <A href="/forgot-password" class="login__forgot-link">Forgot your password?</A>
                    </div>
                </form>
            </div>
        </>
    );
};

export default LoginForm;
