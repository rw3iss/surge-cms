/**
 * TikTok sign-ins — TWO separate apps and token families, both stored on the
 * one 'tiktok' social_connections row:
 *
 * 1. Login Kit (TikTok for Developers app, developers.tiktok.com) → Display API.
 *    Provider key 'tiktok'; app = the connection's appId/appSecret (Client key /
 *    Client secret).
 *      authorize  https://www.tiktok.com/v2/auth/authorize/  (client_key, scope comma-separated,
 *                 response_type=code, redirect_uri, state; no PKCE for web apps)
 *      token      POST https://open.tiktokapis.com/v2/oauth/token/ (form-encoded:
 *                 client_key, client_secret, code, grant_type=authorization_code, redirect_uri)
 *      refresh    same URL, grant_type=refresh_token — ROTATES the refresh token
 *      answer     { access_token, expires_in, refresh_token, refresh_expires_in, open_id, scope, token_type }
 *                 (access 24 h — older docs say 2 h; refresh 365 days)
 *    Docs: https://developers.tiktok.com/doc/login-kit-web ,
 *          https://developers.tiktok.com/doc/oauth-user-access-token-management
 *
 * 2. TikTok API for Business "Accounts" (business-api.tiktok.com developer app)
 *    → /business/get/ + /business/video/list/ insights. Provider key
 *    'tiktok_business'; app = businessAppId/businessAppSecret on the same row.
 *      authorize  the app's "TikTok account holder authorization URL" (My Apps → App Detail →
 *                 Basic Information). Pasted as `businessAuthUrl`, we only set state (+ the
 *                 redirect_uri when absent). Without it we build the v2 authorize URL with the
 *                 Business app id as client_key — UNVERIFIED (the docs only say "copy the URL").
 *      token      POST https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/ (JSON:
 *                 client_id, client_secret, grant_type=authorization_code, auth_code, redirect_uri)
 *      refresh    POST …/tt_user/oauth2/refresh_token/ (grant_type=refresh_token, refresh_token)
 *      answer     { code, message, data: { access_token, expires_in, refresh_token,
 *                 refresh_token_expires_in, open_id, scope, token_type } } (access 1 day, refresh 1 year)
 *    Docs: https://business-api.tiktok.com/portal/docs/get-renew-or-revoke-a-creator-access-token/v1.3
 *    The open_id IS the `business_id` every Accounts call takes.
 */
import { logger, } from '../../utils/logger';
import type { OAuthProvider, OAuthProviderOptions, OAuthTokenResult, OAuthUserInfo, } from './types';

export const TIKTOK_AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
export const TIKTOK_DISPLAY_API = 'https://open.tiktokapis.com/v2';
export const TIKTOK_BUSINESS_API = 'https://business-api.tiktok.com/open_api/v1.3';

/** Login Kit scopes the basic tier asks for. */
export const TIKTOK_SCOPES = ['user.info.basic', 'user.info.profile', 'user.info.stats', 'video.list',];
/** Accounts API scopes ("Required permission" column of /business/get/ + /business/video/list/). */
export const TIKTOK_BUSINESS_SCOPES = [
    'user.info.basic', 'user.info.username', 'user.info.profile', 'user.info.stats', 'user.account.type',
    'user.insights', 'video.list', 'video.insights',
];

/** One token answer, either API, in our shape. */
export interface TikTokToken {
    accessToken: string;
    refreshToken: string | null;
    expiresIn: number | null;
    refreshExpiresIn: number | null;
    openId: string | null;
    scope: string | null;
}

const num = (v: unknown,): number | null => {
    const x = Number(v,);
    return v === undefined || v === null || v === '' || !Number.isFinite(x,) ? null : x;
};
const str = (v: unknown,): string | null => (v === undefined || v === null || v === '' ? null : String(v,));

/** Login Kit token answer → TikTokToken; throws with TikTok's message. (pure) */
export function parseTikTokToken(body: unknown,): TikTokToken {
    const b = (body ?? {}) as Record<string, any>;
    if (!b.access_token) {
        throw new Error(String(b.error_description || b.error?.message || b.error || b.message || 'TikTok did not return an access token',),);
    }
    return {
        accessToken: String(b.access_token,),
        refreshToken: str(b.refresh_token,),
        expiresIn: num(b.expires_in,),
        refreshExpiresIn: num(b.refresh_expires_in,),
        openId: str(b.open_id,),
        scope: str(b.scope,),
    };
}

/** Business API token answer ({ code, message, data }) → TikTokToken. (pure) */
export function parseBusinessToken(body: unknown,): TikTokToken {
    const b = (body ?? {}) as { code?: number; message?: string; data?: Record<string, unknown>; };
    const d = b.data ?? {};
    if ((b.code !== undefined && b.code !== 0) || !d.access_token) {
        throw new Error(b.message || 'TikTok Business did not return an access token',);
    }
    return {
        accessToken: String(d.access_token,),
        refreshToken: str(d.refresh_token,),
        expiresIn: num(d.expires_in,),
        refreshExpiresIn: num(d.refresh_token_expires_in ?? d.refresh_expires_in,),
        openId: str(d.open_id,),
        scope: str(d.scope,),
    };
}

const iso = (seconds: number | null, now: number,): string | null => (seconds ? new Date(now + seconds * 1000,).toISOString() : null);

/** Credentials patch for a Login Kit token (basic tier). (pure) */
export function displayTokenCredentials(t: TikTokToken, now = Date.now(),): Record<string, unknown> {
    return {
        accessToken: t.accessToken,
        ...(t.refreshToken ? { refreshToken: t.refreshToken, } : {}),
        tokenExpiresAt: iso(t.expiresIn ?? 86_400, now,),
        ...(t.refreshExpiresIn ? { refreshTokenExpiresAt: iso(t.refreshExpiresIn, now,), } : {}),
        ...(t.scope ? { scope: t.scope, } : {}),
        ...(t.openId ? { openId: t.openId, } : {}),
        oauthError: null,
    };
}

/** Credentials patch for a Business API token (upgraded tier). (pure) */
export function businessTokenCredentials(t: TikTokToken, now = Date.now(),): Record<string, unknown> {
    return {
        businessAccessToken: t.accessToken,
        ...(t.refreshToken ? { businessRefreshToken: t.refreshToken, } : {}),
        businessTokenExpiresAt: iso(t.expiresIn ?? 86_400, now,),
        ...(t.refreshExpiresIn ? { businessRefreshTokenExpiresAt: iso(t.refreshExpiresIn, now,), } : {}),
        ...(t.scope ? { businessScope: t.scope, } : {}),
        ...(t.openId ? { businessId: t.openId, } : {}),
        businessOauthError: null,
    };
}

/** The Login Kit authorize URL. (pure) */
export function tiktokAuthorizeUrl(clientKey: string, redirectUri: string, state: string, scopes = TIKTOK_SCOPES,): string {
    const p = new URLSearchParams({ client_key: clientKey, scope: scopes.join(',',), response_type: 'code', redirect_uri: redirectUri, state, },);
    return `${TIKTOK_AUTHORIZE_URL}?${p}`;
}

/**
 * The Business authorize URL: the operator's pasted "TikTok account holder
 * authorization URL" with our state (its redirect_uri is kept — it must be the
 * one registered on the app, i.e. ours), else a built v2 URL. (pure)
 */
export function businessAuthorizeUrl(appId: string, redirectUri: string, state: string, pasted?: string | null,): string {
    const u = pasted ? tiktokUrl(pasted,) : null;
    if (u) {
        u.searchParams.set('state', state,);
        if (!u.searchParams.get('redirect_uri',)) u.searchParams.set('redirect_uri', redirectUri,);
        return u.toString();
    }
    return tiktokAuthorizeUrl(appId, redirectUri, state, TIKTOK_BUSINESS_SCOPES,);
}

/**
 * A pasted authorize URL, only when it is https on a TikTok host — the CSRF
 * state is appended to it, so it must never be handed to another site. (pure)
 */
export function tiktokUrl(raw: string,): URL | null {
    try {
        const u = new URL(raw.trim(),);
        const host = u.hostname.toLowerCase();
        return u.protocol === 'https:' && (host === 'tiktok.com' || host.endsWith('.tiktok.com',)) ? u : null;
    } catch {
        return null;
    }
}

/** A hung TikTok socket must not hang a sign-in or a collector run. */
export const TIKTOK_TIMEOUT_MS = 30_000;

/** fetch with a timeout; network errors become a plain message (never the URL). */
export async function tiktokFetch(url: string, init: RequestInit = {},): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(TIKTOK_TIMEOUT_MS,), },);
    } catch (e) {
        const name = (e as Error)?.name;
        throw new Error(name === 'TimeoutError' || name === 'AbortError' ? `TikTok did not answer within ${TIKTOK_TIMEOUT_MS / 1000} s` : 'TikTok is unreachable (network error)',);
    }
}

async function readJson(res: Response,): Promise<unknown> {
    return res.json().catch(() => ({}));
}

/** POST the Login Kit token endpoint (code exchange or refresh). */
export async function requestDisplayToken(params: Record<string, string>,): Promise<TikTokToken> {
    const res = await tiktokFetch(TIKTOK_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache', },
        body: new URLSearchParams(params,),
    },);
    const body = await readJson(res,);
    try {
        return parseTikTokToken(body,);
    } catch (e) {
        logger.warn('tiktok: token request failed', { status: res.status, grant: params.grant_type, error: (e as Error).message, },);
        throw e;
    }
}

/** POST a Business tt_user OAuth endpoint ('token' | 'refresh_token'). */
export async function requestBusinessToken(endpoint: 'token' | 'refresh_token', body: Record<string, string>,): Promise<TikTokToken> {
    const res = await tiktokFetch(`${TIKTOK_BUSINESS_API}/tt_user/oauth2/${endpoint}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', },
        body: JSON.stringify(body,),
    },);
    const json = await readJson(res,);
    try {
        return parseBusinessToken(json,);
    } catch (e) {
        logger.warn('tiktok business: token request failed', { status: res.status, endpoint, error: (e as Error).message, },);
        throw e;
    }
}

const toResult = (t: TikTokToken,): OAuthTokenResult => ({
    accessToken: t.accessToken,
    refreshToken: t.refreshToken ?? undefined,
    expiresIn: t.expiresIn ?? undefined,
    tokenType: 'Bearer',
    rawData: { ...t, },
});

const fromResult = (r: OAuthTokenResult,): TikTokToken => {
    const raw = r.rawData as Partial<TikTokToken>;
    return {
        accessToken: r.accessToken,
        refreshToken: r.refreshToken ?? null,
        expiresIn: r.expiresIn ?? null,
        refreshExpiresIn: raw.refreshExpiresIn ?? null,
        openId: raw.openId ?? null,
        scope: raw.scope ?? null,
    };
};

interface TikTokConfig {
    appId: string;
    appSecret: string;
    redirectUri: string;
}

/** Login Kit (basic tier). */
export class TikTokOAuthProvider implements OAuthProvider, OAuthProviderOptions {
    credentialKeys = ['accessToken', 'refreshToken', 'tokenExpiresAt', 'refreshTokenExpiresAt', 'scope', 'openId', 'oauthError',];

    constructor(private config: TikTokConfig,) {}

    getAuthorizationUrl(state: string,): string {
        return tiktokAuthorizeUrl(this.config.appId, this.config.redirectUri, state,);
    }

    async exchangeCode(code: string,): Promise<OAuthTokenResult> {
        return toResult(
            await requestDisplayToken({
                client_key: this.config.appId,
                client_secret: this.config.appSecret,
                code,
                grant_type: 'authorization_code',
                redirect_uri: this.config.redirectUri,
            },),
        );
    }

    tokenCredentials(token: OAuthTokenResult,): Record<string, unknown> {
        return displayTokenCredentials(fromResult(token,),);
    }

    async getUserInfo(accessToken: string,): Promise<OAuthUserInfo> {
        const res = await tiktokFetch(`${TIKTOK_DISPLAY_API}/user/info/?fields=open_id,display_name,username,avatar_url`, {
            headers: { Authorization: `Bearer ${accessToken}`, },
        },);
        const body = await readJson(res,) as { data?: { user?: Record<string, unknown>; }; error?: { code?: string; message?: string; }; };
        const user = body.data?.user;
        if (!res.ok || !user?.open_id || (body.error?.code && body.error.code !== 'ok')) {
            throw new Error(body.error?.message || 'Could not read the TikTok profile',);
        }
        return {
            accountId: String(user.open_id,),
            displayName: String(user.display_name || user.username || user.open_id,),
            avatarUrl: user.avatar_url ? String(user.avatar_url,) : undefined,
            rawData: { username: user.username ?? null, },
        };
    }

    async refreshToken(currentToken: string, credentials: Record<string, unknown>,): Promise<OAuthTokenResult | null> {
        const refresh = String(credentials.refreshToken ?? '',);
        if (!refresh) return null;
        void currentToken;
        return toResult(
            await requestDisplayToken({
                client_key: this.config.appId,
                client_secret: this.config.appSecret,
                grant_type: 'refresh_token',
                refresh_token: refresh,
            },),
        );
    }
}

/** Business app credentials saved on the 'tiktok' row. */
export function businessAppCredentials(credentials: Record<string, unknown>,): { appId: string; appSecret: string; } | null {
    const appId = String(credentials.businessAppId ?? '',).trim();
    const appSecret = String(credentials.businessAppSecret ?? '',).trim();
    return appId && appSecret ? { appId, appSecret, } : null;
}

/** TikTok API for Business — Accounts (upgraded tier). */
export class TikTokBusinessOAuthProvider implements OAuthProvider, OAuthProviderOptions {
    connection = 'tiktok';
    secondary = true;
    credentialKeys = [
        'businessAccessToken', 'businessRefreshToken', 'businessTokenExpiresAt', 'businessRefreshTokenExpiresAt',
        'businessScope', 'businessId', 'businessOauthError', 'businessUsername',
    ];

    constructor(private config: TikTokConfig & { authUrl?: string | null; },) {}

    appCredentials(credentials: Record<string, unknown>,) {
        return businessAppCredentials(credentials,);
    }

    getAuthorizationUrl(state: string,): string {
        return businessAuthorizeUrl(this.config.appId, this.config.redirectUri, state, this.config.authUrl,);
    }

    async exchangeCode(code: string,): Promise<OAuthTokenResult> {
        return toResult(
            await requestBusinessToken('token', {
                client_id: this.config.appId,
                client_secret: this.config.appSecret,
                grant_type: 'authorization_code',
                auth_code: code,
                redirect_uri: this.config.redirectUri,
            },),
        );
    }

    tokenCredentials(token: OAuthTokenResult,): Record<string, unknown> {
        return businessTokenCredentials(fromResult(token,),);
    }

    async getUserInfo(accessToken: string,): Promise<OAuthUserInfo> {
        // The open_id from the token answer is the business_id; the profile call proves it works.
        const infoRes = await tiktokFetch(`${TIKTOK_BUSINESS_API}/tt_user/token_info/get/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', },
            body: JSON.stringify({ app_id: this.config.appId, access_token: accessToken, },),
        },).catch(() => null,);
        const tokenInfo = (infoRes ? await readJson(infoRes,) : {}) as { data?: { creator_id?: string; scope?: string; }; };
        const businessId = tokenInfo.data?.creator_id;
        if (!businessId) throw new Error('Could not read the TikTok Business account (token_info)',);
        const res = await tiktokFetch(`${TIKTOK_BUSINESS_API}/business/get/?` + new URLSearchParams({
            business_id: businessId,
            fields: JSON.stringify(['display_name', 'username', 'profile_image',],),
        },), { headers: { 'Access-Token': accessToken, }, },);
        const body = await readJson(res,) as { code?: number; message?: string; data?: Record<string, unknown>; };
        if (body.code !== 0) throw new Error(body.message || 'Could not read the TikTok Business profile',);
        const d = body.data ?? {};
        return {
            accountId: businessId,
            displayName: String(d.display_name || d.username || businessId,),
            avatarUrl: d.profile_image ? String(d.profile_image,) : undefined,
            rawData: {
                businessId,
                businessUsername: d.username ?? null,
                ...(tokenInfo.data?.scope ? { businessScope: tokenInfo.data.scope, } : {}),
                businessOauthError: null,
            },
        };
    }

    async refreshToken(_currentToken: string, credentials: Record<string, unknown>,): Promise<OAuthTokenResult | null> {
        const refresh = String(credentials.businessRefreshToken ?? '',);
        if (!refresh) return null;
        return toResult(
            await requestBusinessToken('refresh_token', {
                client_id: this.config.appId,
                client_secret: this.config.appSecret,
                grant_type: 'refresh_token',
                refresh_token: refresh,
            },),
        );
    }
}
