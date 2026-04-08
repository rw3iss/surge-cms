import { A, } from '@solidjs/router';
import { Component, createSignal, Show, } from 'solid-js';
import SeoHead from '../components/SeoHead';
import { api, } from '../services/api';
import { siteName, } from '../stores/siteSettings';
import './Join.scss';

const Join: Component = () => {
    const [name, setName,] = createSignal('',);
    const [email, setEmail,] = createSignal('',);
    const [password, setPassword,] = createSignal('',);
    const [confirmPassword, setConfirmPassword,] = createSignal('',);
    const [error, setError,] = createSignal('',);
    const [isLoading, setIsLoading,] = createSignal(false,);
    const [success, setSuccess,] = createSignal(false,);

    const handlePatreonJoin = () => {
        window.location.href = '/api/v1/auth/patreon?intent=register';
    };

    const handleRegister = async (e: Event,) => {
        e.preventDefault();
        setError('',);

        if (password() !== confirmPassword()) {
            setError('Passwords do not match',);
            return;
        }

        if (password().length < 8) {
            setError('Password must be at least 8 characters',);
            return;
        }

        setIsLoading(true,);
        try {
            const response = await api.post('/auth/register', {
                name: name(),
                email: email(),
                password: password(),
            },);
            if (response.success) {
                setSuccess(true,);
            } else {
                setError(response.error?.message || 'Registration failed',);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Registration failed',);
        } finally {
            setIsLoading(false,);
        }
    };

    return (
        <div class="join">
            <SeoHead
                title="Join"
                description={`Become a member of ${siteName()}.`}
                noindex={true}
                nofollow={true}
            />

            <div class="join__container">
                <Show
                    when={!success()}
                    fallback={
                        <div class="join__success">
                            <svg
                                class="join__success-icon"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                            >
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                <polyline points="22 4 12 14.01 9 11.01" />
                            </svg>
                            <h2>Account Created</h2>
                            <p>Your account has been created successfully. You can now sign in.</p>
                            <A href="/login" class="join__btn join__btn--primary">Sign In</A>
                        </div>
                    }
                >
                    <h1 class="join__title">Join Surge Media</h1>
                    <p class="join__subtitle">Get access to exclusive content and community</p>

                    {/* Patreon Section */}
                    <div class="join__section">
                        <div class="join__section-header">
                            <span class="join__badge join__badge--recommended">Recommended</span>
                            <h2 class="join__section-title">Join with Patreon</h2>
                        </div>
                        <p class="join__section-desc">
                            Link your Patreon account to get full access to all media, exclusive posts, and
                            subscriber-only benefits. Supporting through Patreon helps us create more content.
                        </p>
                        <button
                            type="button"
                            class="join__btn join__btn--patreon"
                            onClick={handlePatreonJoin}
                        >
                            <svg class="join__btn-icon" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M15.385.5c-4.764 0-8.615 3.851-8.615 8.615 0 4.764 3.851 8.616 8.615 8.616 4.764 0 8.615-3.852 8.615-8.616S20.149.5 15.385.5zM.5 23.5h4.615V.5H.5v23z" />
                            </svg>
                            Create Account with Patreon
                        </button>
                        <ul class="join__perks">
                            <li>Access to all posts and media</li>
                            <li>Exclusive subscriber content</li>
                            <li>Community benefits and updates</li>
                        </ul>
                    </div>

                    <div class="join__divider">
                        <span>or</span>
                    </div>

                    {/* Normal Account Section */}
                    <div class="join__section">
                        <h2 class="join__section-title">Create a Free Account</h2>
                        <p class="join__section-desc">
                            Create a standard account to browse public content. Note that free accounts have limited
                            access — only public posts and media will be visible.
                        </p>

                        <div class="join__notice">
                            <svg
                                class="join__notice-icon"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                stroke-width="2"
                            >
                                <circle cx="12" cy="12" r="10" />
                                <line x1="12" y1="16" x2="12" y2="12" />
                                <line x1="12" y1="8" x2="12.01" y2="8" />
                            </svg>
                            <span>
                                Free accounts only see limited posts and data. Subscribe through Patreon for full access
                                to all media and extra benefits.
                            </span>
                        </div>

                        <Show when={error()}>
                            <div class="join__error">{error()}</div>
                        </Show>

                        <form class="join__form" onSubmit={handleRegister} action="/join" method="post">
                            <div class="join__field">
                                <label for="register-name" class="join__label">Full Name</label>
                                <input
                                    type="text"
                                    id="register-name"
                                    name="name"
                                    autocomplete="name"
                                    class="join__input"
                                    value={name()}
                                    onInput={(e,) => setName(e.currentTarget.value,)}
                                    onChange={(e,) => setName(e.currentTarget.value,)}
                                    required
                                    disabled={isLoading()}
                                    placeholder="Your name"
                                />
                            </div>

                            <div class="join__field">
                                <label for="register-email" class="join__label">Email Address</label>
                                <input
                                    type="email"
                                    id="register-email"
                                    name="email"
                                    autocomplete="email"
                                    class="join__input"
                                    value={email()}
                                    onInput={(e,) => setEmail(e.currentTarget.value,)}
                                    onChange={(e,) => setEmail(e.currentTarget.value,)}
                                    required
                                    disabled={isLoading()}
                                    placeholder="you@example.com"
                                />
                            </div>

                            <div class="join__field">
                                <label for="register-password" class="join__label">Password</label>
                                <input
                                    type="password"
                                    id="register-password"
                                    name="password"
                                    autocomplete="new-password"
                                    class="join__input"
                                    value={password()}
                                    onInput={(e,) => setPassword(e.currentTarget.value,)}
                                    onChange={(e,) => setPassword(e.currentTarget.value,)}
                                    required
                                    disabled={isLoading()}
                                    placeholder="At least 8 characters"
                                    minLength={8}
                                />
                            </div>

                            <div class="join__field">
                                <label for="register-confirm-password" class="join__label">Confirm Password</label>
                                <input
                                    type="password"
                                    id="register-confirm-password"
                                    name="confirm-password"
                                    autocomplete="new-password"
                                    class="join__input"
                                    value={confirmPassword()}
                                    onInput={(e,) => setConfirmPassword(e.currentTarget.value,)}
                                    onChange={(e,) => setConfirmPassword(e.currentTarget.value,)}
                                    required
                                    disabled={isLoading()}
                                    placeholder="Re-enter your password"
                                    minLength={8}
                                />
                            </div>

                            <button
                                type="submit"
                                class="join__btn join__btn--primary"
                                disabled={isLoading()}
                            >
                                {isLoading() ? 'Creating Account...' : 'Create Account'}
                            </button>
                        </form>
                    </div>

                    <div class="join__login-prompt">
                        <span>Already have an account?</span>
                        <A href="/login" class="join__login-link">Sign In</A>
                    </div>
                </Show>
            </div>
        </div>
    );
};

export default Join;
