/**
 * "Get notified about new merchandise" — the storefront tout beside the Shop
 * heading, plus the modal an anonymous visitor fills in.
 *
 * Two paths, because the friction should match what we already know:
 *  - **Signed in** → one click. We have their address; asking for it again
 *    would be theatre, and the server ignores a posted address for a
 *    signed-in caller anyway.
 *  - **Anonymous** → a small modal asking for an email (required) plus an
 *    optional name and phone, with a route to sign in for anyone who has an
 *    account and would rather it landed on their profile.
 *
 * The success message is identical whether the subscription was new or the
 * address was already on the list. That is deliberate and matches the server:
 * "you're already subscribed" would let a stranger test list membership.
 */
import { Component, createSignal, Show, } from 'solid-js';
import { A, } from '@solidjs/router';
import { Portal, } from 'solid-js/web';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import './MerchandiseSignup.scss';

const SUCCESS = "You're on the list — we'll email you when new merchandise arrives.";

const MerchandiseSignup: Component = () => {
    const auth = useAuth();

    const [modalOpen, setModalOpen,] = createSignal(false,);
    const [done, setDone,] = createSignal(false,);
    const [busy, setBusy,] = createSignal(false,);
    const [error, setError,] = createSignal('',);

    const [email, setEmail,] = createSignal('',);
    const [name, setName,] = createSignal('',);
    const [phone, setPhone,] = createSignal('',);

    const subscribe = async (body: { email?: string; name?: string; phone?: string; },) => {
        setBusy(true,);
        setError('',);
        try {
            await cms.shop.merchandiseSignup(body,);
            setDone(true,);
            setModalOpen(false,);
        } catch {
            setError("We couldn't sign you up just then. Please try again.",);
        } finally {
            setBusy(false,);
        }
    };

    const onClick = () => {
        if (done()) return;
        // Signed in: no form needed — the server uses the account address and
        // ignores anything posted. `user` is a plain property on the auth
        // context (see AuthContextValue extends AuthState), NOT an accessor.
        if (auth.user) { void subscribe({},); return; }
        setModalOpen(true,);
    };

    const submitModal = (e: Event,) => {
        e.preventDefault();
        if (busy()) return;
        void subscribe({
            email: email().trim(),
            name: name().trim() || undefined,
            phone: phone().trim() || undefined,
        },);
    };

    return (
        <>
            <div class="merch-signup">
                <Show
                    when={!done()}
                    fallback={<p class="merch-signup__done" role="status">{SUCCESS}</p>}
                >
                    <p class="merch-signup__pretext">
                        Want to hear about new drops? Join our new-merchandise list and we'll
                        email you when something lands.
                    </p>
                    <button
                        type="button"
                        class="btn merch-signup__btn"
                        onClick={onClick}
                        disabled={busy()}
                    >
                        {busy() ? 'Signing you up…' : 'Get Notifications for New Merchandise'}
                    </button>
                    <Show when={error() && !modalOpen()}>
                        <p class="merch-signup__error">{error()}</p>
                    </Show>
                </Show>
            </div>

            <Show when={modalOpen()}>
                <Portal>
                    <div
                        class="merch-modal-overlay"
                        onClick={(e,) => { if (e.target === e.currentTarget) setModalOpen(false,); }}
                    >
                        <div class="merch-modal" role="dialog" aria-modal="true" aria-labelledby="merch-modal-title">
                            <button
                                type="button"
                                class="merch-modal__close"
                                aria-label="Close"
                                onClick={() => setModalOpen(false,)}
                            >
                                ×
                            </button>
                            <h2 id="merch-modal-title" class="merch-modal__title">
                                New merchandise alerts
                            </h2>
                            <p class="merch-modal__lede">
                                We'll email you when new items hit the shop. Nothing else.
                            </p>

                            <Show when={error()}>
                                <p class="merch-modal__error">{error()}</p>
                            </Show>

                            <form class="merch-modal__form" onSubmit={submitModal}>
                                <label class="merch-modal__field">
                                    <span>Email <em>(required)</em></span>
                                    <input
                                        type="email"
                                        autocomplete="email"
                                        value={email()}
                                        onInput={(e,) => setEmail(e.currentTarget.value,)}
                                        placeholder="you@example.com"
                                        required
                                        disabled={busy()}
                                    />
                                </label>
                                <label class="merch-modal__field">
                                    <span>Name <em>(optional)</em></span>
                                    <input
                                        type="text"
                                        autocomplete="name"
                                        value={name()}
                                        onInput={(e,) => setName(e.currentTarget.value,)}
                                        disabled={busy()}
                                    />
                                </label>
                                <label class="merch-modal__field">
                                    <span>Phone number <em>(optional)</em></span>
                                    <input
                                        type="tel"
                                        autocomplete="tel"
                                        value={phone()}
                                        onInput={(e,) => setPhone(e.currentTarget.value,)}
                                        disabled={busy()}
                                    />
                                </label>

                                <button type="submit" class="btn merch-modal__submit" disabled={busy()}>
                                    {busy() ? 'Signing you up…' : 'Notify me'}
                                </button>
                            </form>

                            <p class="merch-modal__login">
                                <A href="/login">Login if you have an account</A>
                            </p>
                        </div>
                    </div>
                </Portal>
            </Show>
        </>
    );
};

export default MerchandiseSignup;
