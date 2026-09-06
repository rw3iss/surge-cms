/**
 * "Forgot your password?" — request a reset link.
 *
 * The success state is deliberately identical whether or not the address has an
 * account. The server answers the same way for both (otherwise the form is an
 * account-enumeration oracle), so the UI must not invent a distinction it was
 * never given — no "we couldn't find that address", ever.
 *
 * Because of that, the form is REPLACED by the confirmation on success rather
 * than showing an inline message beside a still-editable field: leaving the
 * field there invites re-submitting to "check" a different address.
 */
import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createSignal, Show, } from 'solid-js';
import { cms, } from '../services/cmsClient';
import './Login.scss';

const ForgotPasswordPage: Component = () => {
    const [email, setEmail,] = createSignal('',);
    const [sent, setSent,] = createSignal(false,);
    const [loading, setLoading,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const submit = async (e: Event,) => {
        e.preventDefault();
        if (loading()) return;
        setError('',);
        setLoading(true,);
        try {
            await cms.auth.forgotPassword({ email: email().trim(), },);
            setSent(true,);
        } catch {
            // Only a transport/validation failure reaches here — an unknown
            // address is a success by design.
            setError('Something went wrong sending that. Please try again.',);
        } finally {
            setLoading(false,);
        }
    };

    return (
        <div class="login">
            <Title>Forgot password</Title>
            <div class="login__container">
                <div class="login__card">
                    <h1 class="login__title">Forgot your password?</h1>

                    <Show
                        when={!sent()}
                        fallback={
                            <>
                                <p class="login__subtitle">
                                    If an account exists for <strong>{email()}</strong>, a password
                                    reset link is on its way. The link is valid for one hour.
                                </p>
                                <p class="login__subtitle">
                                    Not seeing it? Check your spam folder before trying again.
                                </p>
                                <A href="/login" class="login__btn login__btn--primary">Back to sign in</A>
                            </>
                        }
                    >
                        <p class="login__subtitle">
                            Enter the email address on your account and we'll send you a link to
                            choose a new password.
                        </p>

                        <Show when={error()}>
                            <div class="login__error">{error()}</div>
                        </Show>

                        <form class="login__form" onSubmit={submit}>
                            <div class="login__field">
                                <label for="forgot-email" class="login__label">Email</label>
                                <input
                                    type="email"
                                    id="forgot-email"
                                    name="email"
                                    autocomplete="email"
                                    class="login__input"
                                    value={email()}
                                    onInput={(e,) => setEmail(e.currentTarget.value,)}
                                    placeholder="you@example.com"
                                    required
                                    disabled={loading()}
                                />
                            </div>
                            <button type="submit" class="login__btn login__btn--primary" disabled={loading()}>
                                {loading() ? 'Sending…' : 'Send reset link'}
                            </button>
                        </form>

                        <p class="login__footer-text">
                            Remembered it? <A href="/login" class="login__join-link">Sign in</A>
                        </p>
                    </Show>
                </div>
            </div>
        </div>
    );
};

export default ForgotPasswordPage;
