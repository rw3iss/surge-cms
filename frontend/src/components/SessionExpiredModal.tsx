import { useNavigate, } from '@solidjs/router';
import { Component, Show, } from 'solid-js';
import { useAuth, } from '../stores/auth';
import './SessionExpiredModal.scss';

/**
 * Shown when the auth layer flips `sessionExpired` to true. The user's
 * unsaved page state is preserved underneath the modal — they can
 * choose to sign in again or dismiss the modal and continue navigating
 * (read-only) until the next protected action triggers another 401.
 *
 * Mounted unconditionally at the top of admin (and other protected)
 * layouts; controls its own visibility from the auth store. Lives at
 * the components/ root rather than admin/ because the same surface
 * could later be used for member-only pages too.
 */
export const SessionExpiredModal: Component = () => {
    const auth = useAuth();
    const navigate = useNavigate();

    const goToLogin = async () => {
        // Capture the return path before logout clears state.
        const ret = encodeURIComponent(window.location.pathname + window.location.search,);
        // Hit /auth/logout so the backend clears any stale cookies and
        // session row, then drop the local user signal. Without this
        // the second leg of the "log in twice" sequence inherits stale
        // state from the expired session — empirically users had to
        // submit credentials once to wash out the old state and again
        // to actually sign in. A clean logout-then-login removes that
        // ambiguity. logout() also flips sessionExpired off internally.
        try { await auth.logout(); } catch { /* best-effort */ }
        navigate(`/login?return=${ret}`, { replace: false, },);
    };

    const stay = () => {
        auth.dismissSessionExpired();
    };

    return (
        <Show when={auth.sessionExpired}>
            <div class="session-expired-overlay" role="dialog" aria-modal="true" aria-labelledby="session-expired-title">
                <div class="session-expired-modal">
                    <h2 id="session-expired-title" class="session-expired-modal__title">
                        Your session has expired
                    </h2>
                    <p class="session-expired-modal__body">
                        For security, we signed you out. Sign in again to continue. You can dismiss this and keep
                        viewing the page, but you won't be able to save changes until you sign in.
                    </p>
                    <div class="session-expired-modal__actions">
                        <button
                            type="button"
                            class="session-expired-modal__btn session-expired-modal__btn--ghost"
                            onClick={stay}
                        >
                            Stay here
                        </button>
                        <button
                            type="button"
                            class="session-expired-modal__btn session-expired-modal__btn--primary"
                            onClick={goToLogin}
                            autofocus
                        >
                            Sign in again
                        </button>
                    </div>
                </div>
            </div>
        </Show>
    );
};

export default SessionExpiredModal;
