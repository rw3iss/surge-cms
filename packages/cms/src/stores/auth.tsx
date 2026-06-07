import type { User, } from '@rw/cms-shared';
import { createContext, createEffect, createSignal, ParentComponent, useContext, } from 'solid-js';
import { api, setUnauthorizedHandler, } from '../services/api';

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
}

const AuthContext = createContext<AuthContextValue>();

export const AuthProvider: ParentComponent = (props,) => {
    const [user, setUser,] = createSignal<User | null>(null,);
    const [isLoading, setIsLoading,] = createSignal(true,);
    const [sessionExpired, setSessionExpired,] = createSignal(false,);

    const isAuthenticated = () => !!user();

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
            const response = await api.get<{ user: User; }>('/auth/autologin',);
            if (response.success && response.data?.user) {
                setUser(response.data.user,);
                return true;
            }
        } catch {
            // Autologin not available
        }
        return false;
    };

    const refreshUser = async () => {
        try {
            const response = await api.get<{ user: User; }>('/auth/me',);
            if (response.success && response.data?.user) {
                setUser(response.data.user,);
            } else {
                // Try autologin from localhost
                if (!await tryAutologin()) {
                    setUser(null,);
                }
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
            const response = await api.post<{ user: User; }>('/auth/login', { email, password, rememberMe, },);
            if (response.success && response.data?.user) {
                // Explicit login clears any prior manual logout from this session.
                setManuallyLoggedOut(false,);
                // Defensive: clear any lingering session-expired flag so
                // the modal can't briefly reappear after the new session
                // is established (a 401 from a request that raced with
                // the login response would otherwise re-trigger it).
                setSessionExpired(false,);
                setUser(response.data.user,);
            } else {
                throw new Error(response.error?.message || 'Login failed',);
            }
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
            await api.post('/auth/logout',);
        } finally {
            // Mark this session as manually-logged-out BEFORE clearing the
            // user — otherwise the createEffect that watches user() could
            // race with refreshUser() and trip an autologin.
            setManuallyLoggedOut(true,);
            setUser(null,);
            // An explicit logout is not a "session expired" event — close
            // the modal if it happened to be up.
            setSessionExpired(false,);
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
            const response = await api.get<{ user: User; }>('/auth/me',);
            if (response.success && response.data?.user) {
                setUser(response.data.user,);
                setSessionExpired(false,);
                return true;
            }
        } catch {
            /* fall through */
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
    const { user, isAuthenticated, } = useAuth();
    return { user, isAuthenticated, };
}

export function useIsAdmin() {
    const { user, } = useAuth();
    return () => user?.role === 'admin' || user?.role === 'sysadmin';
}
