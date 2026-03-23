import { Title, } from '@solidjs/meta';
import { A, useNavigate, useSearchParams, } from '@solidjs/router';
import { Component, createSignal, Show, } from 'solid-js';
import { useAuth, } from '../stores/auth';
import './Login.scss';

const Login: Component = () => {
    const [email, setEmail,] = createSignal('',);
    const [password, setPassword,] = createSignal('',);
    const [rememberMe, setRememberMe,] = createSignal(false,);
    const [error, setError,] = createSignal('',);
    const [isLoading, setIsLoading,] = createSignal(false,);
    const [showAdminForm, setShowAdminForm,] = createSignal(false,);
    const [searchParams,] = useSearchParams();
    const navigate = useNavigate();
    const auth = useAuth();

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

            const returnUrl = searchParams.return || '/';
            navigate(returnUrl,);
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
            <Title>Sign In - Surge Media</Title>

            <div class="login__container">
                <h1 class="login__title">Sign In</h1>
                <p class="login__subtitle">Sign in to access exclusive content</p>

                <Show when={authError() || error()}>
                    <div class="login__error">
                        {authError() || error()}
                    </div>
                </Show>

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

                <div class="login__join-prompt">
                    <span>Don't have an account?</span>
                    <A href="/join" class="login__join-link">Join Surge Media</A>
                </div>

                <div class="login__admin-toggle">
                    <button
                        type="button"
                        class="login__admin-link"
                        onClick={() => setShowAdminForm(!showAdminForm(),)}
                    >
                        {showAdminForm() ? 'Hide admin login' : 'Login as administrator'}
                    </button>
                </div>

                <div class={`login__admin-form ${showAdminForm() ? 'login__admin-form--visible' : ''}`}>
                    <div class="login__divider">
                        <span>Admin</span>
                    </div>

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
