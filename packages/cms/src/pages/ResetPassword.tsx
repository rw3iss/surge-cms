/**
 * "Choose a new password" — completes a reset from an emailed token.
 *
 * On success the server logs the user straight in (same as email verification),
 * so this navigates home rather than bouncing back to the login form and asking
 * for the password that was just set.
 *
 * The confirm-password check is client-side only. That is fine: it exists to
 * catch a typo, not to enforce anything — the server never sees it, and the
 * only thing it protects is the user from locking themselves out of an account
 * whose password they mistyped twice the same way.
 */
import { Title, } from '@solidjs/meta';
import { A, useNavigate, useSearchParams, } from '@solidjs/router';
import { Component, createSignal, Show, } from 'solid-js';
import { cms, } from '../services/cmsClient';
import { useAuth, } from '../stores/auth';
import './Login.scss';

const MIN_LENGTH = 8;

const ResetPasswordPage: Component = () => {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const auth = useAuth();

    const [password, setPassword,] = createSignal('',);
    const [confirm, setConfirm,] = createSignal('',);
    const [loading, setLoading,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const token = () => (searchParams.token as string | undefined) ?? '';

    const submit = async (e: Event,) => {
        e.preventDefault();
        if (loading()) return;
        setError('',);

        if (password().length < MIN_LENGTH) {
            setError(`Your password must be at least ${MIN_LENGTH} characters.`,);
            return;
        }
        if (password() !== confirm()) {
            setError("Those passwords don't match.",);
            return;
        }

        setLoading(true,);
        try {
            await cms.auth.resetPassword({ token: token(), password: password(), },);
            // The reset set auth cookies server-side; pull the user into the
            // store so the app shows a signed-in state without a full reload.
            await auth.refreshUser().catch(() => {},);
            navigate('/', { replace: true, },);
        } catch (err) {
            setError(
                err instanceof Error && err.message
                    ? err.message
                    : 'That reset link is invalid or has expired.',
            );
        } finally {
            setLoading(false,);
        }
    };

    return (
        <div class="login">
            <Title>Reset password</Title>
            <div class="login__container">
                <div class="login__card">
                    <h1 class="login__title">Choose a new password</h1>

                    <Show
                        when={token()}
                        fallback={
                            <>
                                <p class="login__subtitle">
                                    This reset link is missing its token. Request a new one and use
                                    the most recent email.
                                </p>
                                <A href="/forgot-password" class="login__btn login__btn--primary">
                                    Request a new link
                                </A>
                            </>
                        }
                    >
                        <p class="login__subtitle">
                            Pick something you don't use anywhere else. You'll be signed in once
                            it's saved.
                        </p>

                        <Show when={error()}>
                            <div class="login__error">{error()}</div>
                        </Show>

                        <form class="login__form" onSubmit={submit}>
                            <div class="login__field">
                                <label for="reset-password" class="login__label">New password</label>
                                <input
                                    type="password"
                                    id="reset-password"
                                    name="password"
                                    autocomplete="new-password"
                                    class="login__input"
                                    value={password()}
                                    onInput={(e,) => setPassword(e.currentTarget.value,)}
                                    placeholder={`At least ${MIN_LENGTH} characters`}
                                    required
                                    disabled={loading()}
                                />
                            </div>
                            <div class="login__field">
                                <label for="reset-confirm" class="login__label">Confirm password</label>
                                <input
                                    type="password"
                                    id="reset-confirm"
                                    name="confirmPassword"
                                    autocomplete="new-password"
                                    class="login__input"
                                    value={confirm()}
                                    onInput={(e,) => setConfirm(e.currentTarget.value,)}
                                    placeholder="Type it again"
                                    required
                                    disabled={loading()}
                                />
                            </div>
                            <button type="submit" class="login__btn login__btn--primary" disabled={loading()}>
                                {loading() ? 'Saving…' : 'Save new password'}
                            </button>
                        </form>

                        <p class="login__footer-text">
                            <A href="/login" class="login__join-link">Back to sign in</A>
                        </p>
                    </Show>
                </div>
            </div>
        </div>
    );
};

export default ResetPasswordPage;
