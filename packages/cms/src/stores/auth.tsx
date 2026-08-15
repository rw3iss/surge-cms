import { UnauthorizedError, } from '@sitesurge/client';
import { type Contact, isAdminRole, type User, } from '@sitesurge/types';
import { createContext, createEffect, createSignal, ParentComponent, useContext, } from 'solid-js';
import { cms, setUnauthorizedHandler, suppressUnauthorized, } from '../services/cmsClient';
import { isFeatureEnabled, } from './siteSettings';

interface AuthState {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    /**
     * True when we know the previously-authenticated session is no
     * longer valid (a 401 came back from a non-auth route, or the
     * focus check found the user was logged out). UI uses this to show
     * a "session expired" modal instead of a hard redirect.
     */
    sessionExpired: boolean;
}

interface AuthContextValue extends AuthState {
    login: (email: string, password: string, rememberMe?: boolean,) => Promise<void>;
    loginWithPatreon: () => void;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
    /** Verifies the current session against the backend. Sets
     * `sessionExpired` if `/auth/me` reports unauthenticated. */
    verifySession: () => Promise<boolean>;
    /** Used by the session-expired modal's "Stay here" button to
     * dismiss the overlay (it'll come back on the next 401). */
    dismissSessionExpired: () => void;
    /** Imperative trigger for the API interceptor — call when a 401
     * comes back from a non-auth endpoint. */
    markSessionExpired: () => void;
    /** An unlinked CRM contact matching the signed-in member's email, when the
     * Contacts feature is on — drives the one-time "we have your info" modal.
     * Null when nothing to offer / already handled. */
    contactPrompt: Contact | null;
    /** Close the contact-match modal (the modal links the contact itself). */
    dismissContactPrompt: () => void;
}

const AuthContext = createContext<AuthContextValue>();

export const AuthProvider: ParentComponent = (props,) => {
    const [user, setUser,] = createSignal<User | null>(null,);
    const [isLoading, setIsLoading,] = createSignal(true,);
    const [sessionExpired, setSessionExpired,] = createSignal(false,);
    const [contactPrompt, setContactPrompt,] = createSignal<Contact | null>(null,);
    // Guards the one-shot contact-match check per signed-in session.
    let contactChecked = false;

    const isAuthenticated = () => !!user();

    const dismissContactPrompt = () => setContactPrompt(null,);

    const isLocalhost = () => {
        const host = window.location.hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    };

    /**
     * Session-scoped flag set by an explicit logout. The dev-only
     * AUTOLOGIN_ADMIN_LOCALHOST flow would otherwise immediately put the
     * admin back in after they log out, defeating the action. We use
     * sessionStorage so:
     *   - the flag survives page reloads in the current tab (logout sticks)
     *   - a fresh tab/browser session resets it (dev autologin still works)
     * The flag is cleared by any explicit login.
     */
    const LOGOUT_FLAG_KEY = 'rw.auth.manuallyLoggedOut';
    const wasManuallyLoggedOut = () => {
        try { return sessionStorage.getItem(LOGOUT_FLAG_KEY,) === '1'; } catch { return false; }
    };
    const setManuallyLoggedOut = (value: boolean,) => {
        try {
            if (value) sessionStorage.setItem(LOGOUT_FLAG_KEY, '1',);
            else sessionStorage.removeItem(LOGOUT_FLAG_KEY,);
        } catch { /* ignore quota / privacy mode */ }
    };

    const tryAutologin = async (): Promise<boolean> => {
        if (!isLocalhost()) return false;
        if (wasManuallyLoggedOut()) return false;
        try {
            // suppressUnauthorized: a 404/403/401 from the dev-only autologin
            // probe must not pop the session-expired modal.
            const res = await suppressUnauthorized(() => cms.auth.autologin(),);
            if (res?.user) {
                setUser(res.user,);
                return true;
            }
        } catch {
            // Autologin not available
        }
        return false;
    };

    const refreshUser = async () => {
        try {
            // suppressUnauthorized: a 401 from the session probe is handled
            // here (autologin fallback / setUser(null)), not by the modal.
            const res = await suppressUnauthorized(() => cms.auth.me(),);
            if (res?.user) {
                setUser(res.user,);
            } else if (!await tryAutologin()) {
                setUser(null,);
            }
        } catch {
            // Try autologin from localhost
            if (!await tryAutologin()) {
                setUser(null,);
            }
        }
    };

    const login = async (email: string, password: string, rememberMe?: boolean,) => {
        setIsLoading(true,);
        try {
            // suppressUnauthorized: a login failure (401/wrong password) must
            // NOT fire the global session-expired modal — it's surfaced here.
            const res = await suppressUnauthorized(
                () => cms.auth.login({ email, password, rememberMe, },),
            );
            // Explicit login clears any prior manual logout from this session.
            setManuallyLoggedOut(false,);
            // Defensive: clear any lingering session-expired flag so the modal
            // can't briefly reappear after the new session is established (a
            // 401 from a request that raced with the login response would
            // otherwise re-trigger it).
            setSessionExpired(false,);
            // A different user may be signing in — allow a fresh contact check.
            contactChecked = false;
            setContactPrompt(null,);
            setUser(res.user,);
        } finally {
            setIsLoading(false,);
        }
    };

    const loginWithPatreon = () => {
        // Clear the manual-logout flag before bouncing to Patreon so the
        // returning OAuth callback isn't suppressed by the autologin guard.
        setManuallyLoggedOut(false,);
        window.location.href = '/api/v1/auth/patreon';
    };

    const logout = async () => {
        try {
            // suppressUnauthorized: logout's own 401 (already-expired session)
            // shouldn't trigger the modal — we're clearing the user anyway.
            await suppressUnauthorized(() => cms.auth.logout(),);
        } finally {
            // Mark this session as manually-logged-out BEFORE clearing the
            // user — otherwise the createEffect that watches user() could
            // race with refreshUser() and trip an autologin.
            setManuallyLoggedOut(true,);
            setUser(null,);
            // An explicit logout is not a "session expired" event — close
            // the modal if it happened to be up.
            setSessionExpired(false,);
            contactChecked = false;
            setContactPrompt(null,);
        }
    };

    /**
     * Re-check the session against the backend. Returns `true` if the
     * session is valid. Used by the visibility-change listener (after
     * the tab regains focus) and by the session-expired modal's
     * "Stay here" button to retry.
     */
    const verifySession = async (): Promise<boolean> => {
        // No point checking if we never had a user — the modal only
        // matters when the user previously had a session.
        if (!user()) return false;
        try {
            // suppressUnauthorized: this probe owns its own session-expired
            // handling below; its 401 must not also fire the global modal.
            const res = await suppressUnauthorized(() => cms.auth.me(),);
            if (res?.user) {
                setUser(res.user,);
                setSessionExpired(false,);
                return true;
            }
        } catch (err) {
            // A non-401 transient error (network, 5xx) shouldn't be treated
            // as a definitive session-expiry — keep the user as-is and bail.
            if (!(err instanceof UnauthorizedError)) return false;
            /* UnauthorizedError → fall through to session-expired */
        }
        // Reaching here means the previously-authenticated session is
        // gone. Surface the modal but DON'T clear the user signal yet —
        // the UI uses `user()` to know what to show beneath the
        // overlay (e.g. the admin page they were on, frozen).
        setSessionExpired(true,);
        return false;
    };

    /**
     * Called by the API client when a 401 comes back from a non-auth
     * route. We don't immediately clear the user — that would unmount
     * the page they were on. Instead the modal lets them choose to
     * sign in again or stay where they are.
     */
    const markSessionExpired = () => {
        if (user()) setSessionExpired(true,);
    };

    const dismissSessionExpired = () => {
        setSessionExpired(false,);
    };

    // Check authentication on mount
    createEffect(async () => {
        setIsLoading(true,);
        try {
            await refreshUser();
        } finally {
            setIsLoading(false,);
        }
    },);

    // Check for auth success in URL
    createEffect(() => {
        const params = new URLSearchParams(window.location.search,);
        if (params.get('auth',) === 'success') {
            refreshUser();
            // Clean up URL
            window.history.replaceState({}, '', window.location.pathname,);
        }
    },);

    // One-time "we have your info" check: when a signed-in MEMBER lands with the
    // Contacts feature on, ask the backend for an unlinked contact matching their
    // email. Reactive to both `user()` and the (async-loaded) feature flag, so it
    // fires as soon as both are known. Staff never see the prompt.
    createEffect(() => {
        const u = user();
        if (!u || u.role !== 'member') return;
        if (!isFeatureEnabled('contacts',)) return;
        if (contactChecked) return;
        contactChecked = true;
        void (async () => {
            try {
                const { contact, } = await suppressUnauthorized(() => cms.contacts.match(),);
                if (contact) setContactPrompt(contact,);
            } catch { /* feature off / no match — ignore */ }
        })();
    },);

    // Wire the API client's 401 handler. We do this once at provider
    // setup so no other site code has to know about the seam.
    setUnauthorizedHandler(() => {
        if (user()) setSessionExpired(true,);
    },);

    // Re-verify on tab focus / visibility change. The access-token cookie
    // expires after 15 minutes; if the user idles a tab for longer than
    // that and comes back, the next request would 401. Catching it here
    // means the modal appears the moment they return rather than the
    // moment they click something.
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && user() && !sessionExpired()) {
                void verifySession();
            }
        },);
        // `focus` covers the case where the tab is already visible but
        // the window was unfocused (alt-tab on a single-tab browser).
        window.addEventListener('focus', () => {
            if (user() && !sessionExpired()) {
                void verifySession();
            }
        },);
    }

    const contextValue: AuthContextValue = {
        get user() {
            return user();
        },
        get isLoading() {
            return isLoading();
        },
        get isAuthenticated() {
            return isAuthenticated();
        },
        get sessionExpired() {
            return sessionExpired();
        },
        login,
        loginWithPatreon,
        logout,
        refreshUser,
        verifySession,
        dismissSessionExpired,
        markSessionExpired,
        get contactPrompt() {
            return contactPrompt();
        },
        dismissContactPrompt,
    };

    return (
        <AuthContext.Provider value={contextValue}>
            {props.children}
        </AuthContext.Provider>
    );
};

export function useAuth(): AuthContextValue {
    const context = useContext(AuthContext,);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider',);
    }
    return context;
}

export function useUser() {
    // Don't destructure — `user`/`isAuthenticated` are reactive getters on the
    // context, and destructuring would snapshot their value once (stale). Return
    // getters so consumers stay reactive.
    const auth = useAuth();
    return {
        get user() { return auth.user; },
        get isAuthenticated() { return auth.isAuthenticated; },
    };
}

export function useIsAdmin() {
    // Read `auth.user` fresh on every call (it's a reactive getter). The old
    // `const { user } = useAuth()` destructure captured `user` ONCE — on a cold
    // load that's `null`, so the returned accessor was permanently non-admin
    // even after the session restored. Reading through `auth` keeps it reactive.
    const auth = useAuth();
    return () => isAdminRole(auth.user?.role,);
}
