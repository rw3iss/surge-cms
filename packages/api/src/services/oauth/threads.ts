/**
 * Threads (Meta) OAuth — its own app type and endpoints, NOT the Facebook
 * Graph flow Instagram uses:
 *
 *   authorize  https://threads.com/oauth/authorize (threads_basic + threads_manage_insights)
 *   code       POST graph.threads.com/oauth/access_token → short-lived (1 h) token + user_id
 *   long-lived GET  graph.threads.com/access_token?grant_type=th_exchange_token → 60 days
 *   refresh    GET  graph.threads.com/refresh_access_token?grant_type=th_refresh_token
 *              (token ≥ 24 h old and unexpired; a new 60 days from the refresh)
 *
 * The App ID / Secret are the THREADS app id/secret (Meta app → Use cases →
 * Threads API → Settings), not the Meta app's own id.
 */
import { logger, } from '../../utils/logger';
import type { OAuthProvider, OAuthTokenResult, OAuthUserInfo, } from './types';

export const THREADS_GRAPH = 'https://graph.threads.com';
export const THREADS_API = `${THREADS_GRAPH}/v1.0`;
export const THREADS_SCOPES = ['threads_basic', 'threads_manage_insights',];

interface ThreadsConfig {
    appId: string;
    appSecret: string;
    redirectUri: string;
}

interface ThreadsTokenResponse {
    access_token: string;
    token_type?: string;
    expires_in?: number;
    user_id?: string | number;
}

/** Threads errors come as `{ error: { message } }` or `{ error_message }`. */
function errorMessage(body: unknown, fallback: string,): string {
    const b = body as { error?: { message?: string; }; error_message?: string; } | null;
    return b?.error?.message || b?.error_message || fallback;
}

async function readJson(res: Response,): Promise<any> {
    return res.json().catch(() => ({}));
}

/** Every Threads OAuth call gives up after 30 s (a hung socket must not stall the refresh cron). */
const TIMEOUT_MS = 30_000;
const timeout = () => AbortSignal.timeout(TIMEOUT_MS,);

/** An error body for the logs, without any token it might carry. */
function loggable(data: unknown,): unknown {
    if (!data || typeof data !== 'object') return data;
    const { access_token: _a, ...rest } = data as Record<string, unknown>;
    return rest;
}

/** Short- → long-lived (60 days). */
export async function exchangeForLongLived(shortToken: string, appSecret: string,): Promise<ThreadsTokenResponse> {
    const res = await fetch(`${THREADS_GRAPH}/access_token?` + new URLSearchParams({
        grant_type: 'th_exchange_token',
        client_secret: appSecret,
        access_token: shortToken,
    },), { signal: timeout(), },);
    const data = await readJson(res,);
    if (!res.ok || !data?.access_token) {
        logger.error('Threads long-lived token exchange failed', { error: loggable(data,), },);
        throw new Error(errorMessage(data, 'Failed to exchange for a long-lived Threads token',),);
    }
    return data as ThreadsTokenResponse;
}

/** Refresh a long-lived token (another 60 days). */
export async function refreshLongLived(token: string,): Promise<ThreadsTokenResponse> {
    const res = await fetch(`${THREADS_GRAPH}/refresh_access_token?` + new URLSearchParams({
        grant_type: 'th_refresh_token',
        access_token: token,
    },), { signal: timeout(), },);
    const data = await readJson(res,);
    if (!res.ok || !data?.access_token) {
        throw new Error(errorMessage(data, 'Threads token refresh failed',),);
    }
    return data as ThreadsTokenResponse;
}

export class ThreadsOAuthProvider implements OAuthProvider {
    constructor(private config: ThreadsConfig,) {}

    getAuthorizationUrl(state: string,): string {
        const params = new URLSearchParams({
            client_id: this.config.appId,
            redirect_uri: this.config.redirectUri,
            scope: THREADS_SCOPES.join(',',),
            response_type: 'code',
            state,
        },);
        return `https://threads.com/oauth/authorize?${params.toString()}`;
    }

    async exchangeCode(code: string,): Promise<OAuthTokenResult> {
        const res = await fetch(`${THREADS_GRAPH}/oauth/access_token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', },
            body: new URLSearchParams({
                client_id: this.config.appId,
                client_secret: this.config.appSecret,
                grant_type: 'authorization_code',
                redirect_uri: this.config.redirectUri,
                code,
            },),
            signal: timeout(),
        },);
        const short = await readJson(res,);
        if (!res.ok || !short?.access_token) {
            logger.error('Threads code exchange failed', { error: loggable(short,), },);
            throw new Error(errorMessage(short, 'Failed to exchange the Threads authorization code',),);
        }
        const long = await exchangeForLongLived(short.access_token, this.config.appSecret,);
        return {
            accessToken: long.access_token,
            expiresIn: long.expires_in,
            tokenType: long.token_type || 'bearer',
            rawData: { userId: short.user_id != null ? String(short.user_id,) : undefined, },
        };
    }

    async getUserInfo(accessToken: string,): Promise<OAuthUserInfo> {
        const res = await fetch(`${THREADS_API}/me?` + new URLSearchParams({
            fields: 'id,username,name,threads_profile_picture_url',
            access_token: accessToken,
        },), { signal: timeout(), },);
        const me = await readJson(res,);
        if (!res.ok || !me?.id) {
            throw new Error(errorMessage(me, 'Failed to read the Threads profile',),);
        }
        return {
            accountId: String(me.id,),
            displayName: me.username || me.name || String(me.id,),
            avatarUrl: me.threads_profile_picture_url,
            // Merged into credentials by completeOAuth; the collector reads threadsUserId.
            rawData: { threadsUserId: String(me.id,), username: me.username ?? null, grantedScopes: THREADS_SCOPES.join(' ',), oauthError: null, },
        };
    }

    async refreshToken(currentToken: string,): Promise<OAuthTokenResult | null> {
        const data = await refreshLongLived(currentToken,);
        return {
            accessToken: data.access_token,
            expiresIn: data.expires_in,
            tokenType: data.token_type || 'bearer',
            rawData: data as unknown as Record<string, unknown>,
        };
    }
}
