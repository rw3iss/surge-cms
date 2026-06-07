import { A, useNavigate, useSearchParams, } from '@solidjs/router';
import { Component, createSignal, Show, } from 'solid-js';
import SeoHead from '../components/common/seo/SeoHead';
import { isFeatureEnabled, isPatreonEnabled, siteName, } from '../stores/siteSettings';
import { useAuth, } from '../stores/auth';
import './Login.scss';

const Login: Component = () => {
    const [email, setEmail,] = createSignal('',);
    const [password, setPassword,] = createSignal('',);
    const [rememberMe, setRememberMe,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [isLoading, setIsLoading,] = createSignal(false,);
    // Manual override for the "Login as administrator" disclosure. Only
    // matters when the form would otherwise be collapsed (admin-only
    // mode without Users feature, but with Patreon enabled).
    const [showAdminForm, setShowAdminForm,] = createSignal(false,);
    const [searchParams,] = useSearchParams();
    const navigate = useNavigate();
    const auth = useAuth();

    /**
     * Whether the email/password form renders expanded by default.
     *
     * Rules:
     *   - Users feature ON  → form expanded (the page is user-facing,
     *     login is the primary action).
     *   - Users OFF, Patreon OFF → form expanded (admin-only mode;
     *     nothing else to show).
     *   - Users OFF, Patreon ON  → form collapsed behind the
     *     "Login as administrator" disclosure (Patreon is the
     *     primary entry).
     *
     * Admins can always sign in: the form is reachable in every mode.
     */
    const usersEnabled = () => isFeatureEnabled('users',);
    const showFormByDefault = () => usersEnabled() || !isPatreonEnabled();
    const adminFormVisible = () => showFormByDefault() || showAdminForm();
    /** The disclosure toggle only makes sense when the form is hidden
     * by default AND there's another login method visible above it. */
    const showDisclosure = () => !showFormByDefault();

    const handleEmailLogin = async (e: Event,) => {
        e.preventDefault();
        setError('',);
        setIsLoading(true,);

        try {
            await auth.login(email(), password(), rememberMe(),);

            // Signal Chrome to save the credential
            if ((window as any).PasswordCredential) {
                try {
                    const cred = new (window as any).PasswordCredential({
                        id: email(),
                        password: password(),
                        name: email(),
                    },);
                    await navigator.credentials.store(cred,);
                } catch {
                    // Credential storage is best-effort
                }
            }

            // After login: an explicit ?return=<path> wins. Otherwise,
            // admins land in the admin area (where they're presumably
            // headed) and regular users go to the homepage.
            const explicitReturn = searchParams.return;
            const role = auth.user?.role;
            const isAdmin = role === 'admin' || role === 'sysadmin';
            const target = (typeof explicitReturn === 'string' && explicitReturn)
                ? explicitReturn
                : isAdmin ? '/admin' : '/';
            navigate(target,);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Login failed',);
        } finally {
            setIsLoading(false,);
        }
    };

    const handlePatreonLogin = () => {
        if (searchParams.return) {
            document.cookie = `returnUrl=${searchParams.return};path=/;max-age=600`;
        }
        auth.loginWithPatreon();
    };

    const authError = () => {
        const errorParam = searchParams.error;
        if (errorParam === 'patreon_denied') return 'Patreon login was cancelled';
        if (errorParam === 'auth_failed') return 'Authentication failed. Please try again.';
        return null;
    };

    return (
        <div class="login">
            <SeoHead
                title="Sign In"
                description={`Sign in to your ${siteName()} account.`}
                noindex={true}
                nofollow={true}
            />

            <div class="login__container">
                <h1 class="login__title">Sign In</h1>

                <Show when={authError()}>
                    <div class="login__error">
                        {authError()}
                    </div>
                </Show>

                {/* Patreon login button — only when the Patreon
                    feature is enabled AND a Patreon account is
                    connected (see /settings/public). Independent of
                    the Users feature; sites can run Patreon without
                    public registration, or vice versa. */}
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

                {/* "Don't have an account? Join" — gated on Users:
                    registration is only meaningful when public sign-up
                    is enabled. */}
                <Show when={usersEnabled()}>
                    <div class="login__join-prompt">
                        <span>Don't have an account?</span>
                        <A href="/join" class="login__join-link">Register</A>
                    </div>
                </Show>

                {/* Admin-form disclosure — only renders when the form
                    is hidden by default (Patreon visible AND Users
                    disabled). In every other mode the form is already
                    expanded, so the toggle would be redundant. */}
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
                    {/* Divider shown only when there's another auth
                        option above (Patreon button) — its label
                        depends on whether the email form is the
                        admin-only fallback or a peer login method. */}
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
                            <label for="login-email" class="login__label">Email</label>
                            <input
                                type="email"
                                id="login-email"
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
                            <label for="login-password" class="login__label">Password</label>
                            <input
                                type="password"
                                id="login-password"
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
                            <label class="login__remember-label">
                                <input
                                    type="checkbox"
                                    checked={rememberMe()}
                                    onChange={(e,) => setRememberMe(e.currentTarget.checked,)}
                                />
                                <span>Remember me for 30 days</span>
                            </label>
                        </div>

                        <button
                            type="submit"
                            class="login__btn login__btn--primary"
                            disabled={isLoading()}
                        >
                            {isLoading() ? 'Signing in...' : 'Sign In'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default Login;
