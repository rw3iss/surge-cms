import type {
    AuthResponse, LoginCredentials, AuthPatreonResponse,
    AuthLogoutAllResponse, AuthMeResponse, AuthPatreonSyncResponse, AuthAutologinResponse,
    AuthRegisterBody, AuthRegisterResponse,
} from '@sitesurge/types';
import type { CmsClientCore, } from '../core/client';
import type { AuthRuntime, } from '../core/auth/authManager';
import type { AuthTokens, } from '../core/types';
import { ModuleBase, } from './base';

/**
 * /auth namespace, surfaced as `cms.auth`. The core's request funnel reads
 * `core.auth` for ready/headers/refresh, and the assembled object replaces
 * `core.auth` with THIS module — so the module both adds the HTTP endpoints
 * AND forwards the AuthManager surface the funnel relies on (ready,
 * authHeaders, getTokens, refresh, isAuthenticated, setApiKey,
 * onChange/onExpired). Token lifecycle stays owned by the captured manager;
 * login/logout/refresh delegate to it so persistence is never duplicated.
 * The Patreon/autologin OAuth CALLBACK routes are not exposed.
 */
export class AuthModule extends ModuleBase implements AuthRuntime {
    protected readonly module = 'auth';
    private readonly manager: AuthRuntime;

    constructor(core: CmsClientCore,) {
        super(core,);
        this.manager = core.auth;
    }

    // ── AuthManager surface the core's dispatch funnel depends on ──
    get ready(): Promise<void> { return this.manager.ready; }
    authHeaders(method: string,): Promise<Record<string, string>> { return this.manager.authHeaders(method,); }
    getTokens(): AuthTokens | null { return this.manager.getTokens(); }
    isAuthenticated(): boolean { return this.manager.isAuthenticated(); }
    setApiKey(key: string,): void { this.manager.setApiKey(key,); }
    onChange(cb: (t: AuthTokens | null,) => void,): () => void { return this.manager.onChange(cb,); }
    onExpired(cb: () => void,): () => void { return this.manager.onExpired(cb,); }

    /** POST /auth/login — delegates to the AuthManager (persists tokens). */
    login(credentials: LoginCredentials & { rememberMe?: boolean; },): Promise<AuthResponse> {
        return this.manager.login(credentials,);
    }

    /** POST /auth/logout — delegates to the AuthManager (clears tokens). */
    logout(): Promise<void> {
        return this.manager.logout();
    }

    /** POST /auth/register — public member self-registration. Does NOT
     *  auto-login (no tokens minted); the caller signs in via login()
     *  afterwards. 403 when the `users` feature is disabled; 409 on a
     *  duplicate email. */
    register(body: AuthRegisterBody,): Promise<AuthRegisterResponse> {
        return this.mutate<AuthRegisterResponse>('POST', '/auth/register', { body, },);
    }

    /** POST /auth/refresh — delegates to the manager's single-flight refresh. */
    refresh(): Promise<AuthResponse> {
        return this.manager.refresh();
    }

    /** GET /auth/me — session probe; never cached (always fresh). */
    me(): Promise<AuthMeResponse> {
        return this.get<AuthMeResponse>('/auth/me', { options: { cache: false, }, },);
    }

    /** GET /auth/patreon — Patreon OAuth authorization URL + CSRF state. */
    patreonStart(): Promise<AuthPatreonResponse> {
        return this.get<AuthPatreonResponse>('/auth/patreon',);
    }

    /** POST /auth/patreon/sync — re-sync the caller's Patreon membership. */
    patreonSync(): Promise<AuthPatreonSyncResponse> {
        return this.mutate<AuthPatreonSyncResponse>('POST', '/auth/patreon/sync',);
    }

    /** POST /auth/logout-all — invalidate every session for the user. */
    logoutAll(): Promise<AuthLogoutAllResponse> {
        return this.mutate<AuthLogoutAllResponse>('POST', '/auth/logout-all',);
    }

    /** GET /auth/autologin — DEV ONLY; mints a localhost admin session. */
    autologin(): Promise<AuthAutologinResponse> {
        return this.get<AuthAutologinResponse>('/auth/autologin', { options: { cache: false, }, },);
    }
}
