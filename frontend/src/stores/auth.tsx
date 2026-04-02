import type { User, } from '@surge/shared';
import { createContext, createEffect, createSignal, ParentComponent, useContext, } from 'solid-js';
import { api, } from '../services/api';

interface AuthState {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
    login: (email: string, password: string, rememberMe?: boolean,) => Promise<void>;
    loginWithPatreon: () => void;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>();

export const AuthProvider: ParentComponent = (props,) => {
    const [user, setUser,] = createSignal<User | null>(null,);
    const [isLoading, setIsLoading,] = createSignal(true,);

    const isAuthenticated = () => !!user();

    const isLocalhost = () => {
        const host = window.location.hostname;
        return host === 'localhost' || host === '127.0.0.1' || host === '::1';
    };

    const tryAutologin = async (): Promise<boolean> => {
        if (!isLocalhost()) return false;
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
                setUser(response.data.user,);
            } else {
                throw new Error(response.error?.message || 'Login failed',);
            }
        } finally {
            setIsLoading(false,);
        }
    };

    const loginWithPatreon = () => {
        // Redirect to backend Patreon OAuth endpoint
        window.location.href = '/api/v1/auth/patreon';
    };

    const logout = async () => {
        try {
            await api.post('/auth/logout',);
        } finally {
            setUser(null,);
            // Re-autologin if on localhost with autologin enabled
            await tryAutologin();
        }
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
        login,
        loginWithPatreon,
        logout,
        refreshUser,
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
