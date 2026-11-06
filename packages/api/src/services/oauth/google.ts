/**
 * Google OAuth for the YouTube connection ("Sign in with Google").
 *
 * Why: an API key reads only PUBLIC data, so unlisted videos never appear in
 * a key-based sync. Signed in as the channel (or a manager of it) with the
 * read-only YouTube scope, the uploads playlist returns unlisted videos too.
 *
 * `access_type=offline` + `prompt=consent` make Google issue a REFRESH token
 * (it only does so on a consent screen), which the server uses to renew the
 * ~1 h access token without anyone signing in again
 * (services/social/youtubeAuth.ts).
 */
import { logger, } from '../../utils/logger';
import type { OAuthProvider, OAuthTokenResult, OAuthUserInfo, } from './types';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const YOUTUBE_READONLY_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
/** YouTube Analytics + Reporting APIs (views, watch time, impressions) — the channel OWNER must grant it. */
export const YT_ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';
const YT_API = 'https://www.googleapis.com/youtube/v3';
/** A hung Google socket must not hang a sign-in or a collector run. */
const TIMEOUT_MS = 20_000;

/** fetch with a timeout; a network failure / timeout becomes an Error WITHOUT `code` (= transient, not a revoked grant). */
async function googleFetch(url: string, init: RequestInit,): Promise<Response> {
    try {
        return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS,), },);
    } catch (e) {
        const name = (e as Error)?.name;
        throw new Error(name === 'TimeoutError' || name === 'AbortError' ? `Google did not answer within ${TIMEOUT_MS / 1000} s` : 'Google is unreachable (network error)',);
    }
}

interface GoogleConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}

/** A channel the signed-in account can read (Brand Accounts: the chosen one). */
export interface YouTubeOAuthChannel {
    id: string;
    title: string;
    handle: string | null;
    thumbnailUrl: string | null;
}

async function tokenRequest(body: Record<string, string>,): Promise<OAuthTokenResult> {
    const res = await googleFetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', },
        body: new URLSearchParams(body,).toString(),
    },);
    const data = await res.json().catch(() => ({})) as Record<string, any>;
    if (!res.ok || !data.access_token) {
        logger.warn('google: token request failed', { status: res.status, error: data.error, description: data.error_description, },);
        const err = new Error(data.error_description || data.error || `Google token request failed (${res.status})`,);
        (err as Error & { code?: string; }).code = data.error;
        throw err;
    }
    return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        tokenType: data.token_type ?? 'Bearer',
        rawData: { scope: data.scope, },
    };
}

/** Exchange a refresh token for a new access token (no user interaction). */
export function refreshGoogleToken(clientId: string, clientSecret: string, refreshToken: string,): Promise<OAuthTokenResult> {
    return tokenRequest({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token', },);
}

/** Channels the token can read (`mine=true`). */
export async function listMyChannels(accessToken: string,): Promise<YouTubeOAuthChannel[]> {
    const res = await googleFetch(`${YT_API}/channels?part=snippet&mine=true&maxResults=50`, {
        headers: { Authorization: `Bearer ${accessToken}`, },
    },);
    const data = await res.json().catch(() => ({})) as { items?: Array<Record<string, any>>; error?: { message?: string; }; };
    if (!res.ok) throw new Error(data.error?.message || `YouTube channels lookup failed (${res.status})`,);
    return (data.items ?? []).map((c,) => ({
        id: String(c.id,),
        title: String(c.snippet?.title ?? '',),
        handle: (c.snippet?.customUrl as string | undefined) ?? null,
        thumbnailUrl: (c.snippet?.thumbnails?.default?.url as string | undefined) ?? null,
    }));
}

export class GoogleYouTubeOAuthProvider implements OAuthProvider {
    constructor(private config: GoogleConfig,) {}

    getAuthorizationUrl(state: string,): string {
        const params = new URLSearchParams({
            client_id: this.config.clientId,
            redirect_uri: this.config.redirectUri,
            response_type: 'code',
            scope: `${YOUTUBE_READONLY_SCOPE} ${YT_ANALYTICS_SCOPE}`,
            access_type: 'offline',
            // A refresh token is only issued on a consent screen; without this a
            // second connect returns none and the connection dies in an hour.
            prompt: 'consent',
            include_granted_scopes: 'true',
            state,
        },);
        return `${AUTH_URL}?${params.toString()}`;
    }

    exchangeCode(code: string,): Promise<OAuthTokenResult> {
        return tokenRequest({
            code,
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            redirect_uri: this.config.redirectUri,
            grant_type: 'authorization_code',
        },);
    }

    async getUserInfo(accessToken: string,): Promise<OAuthUserInfo> {
        const channels = await listMyChannels(accessToken,);
        if (!channels.length) {
            throw new Error('This Google account has no YouTube channel. Sign in again and choose the channel\'s account (a Brand Account if the channel uses one)',);
        }
        const first = channels[0];
        return {
            accountId: first.id,
            displayName: first.handle || first.title,
            avatarUrl: first.thumbnailUrl ?? undefined,
            // Merged into the connection credentials: the channel list drives the
            // admin's channel picker; the first one is selected to start with.
            rawData: { oauthChannels: channels, channelId: first.id, oauthError: null, },
        };
    }

    async refreshToken(_current: string, credentials: Record<string, unknown>,): Promise<OAuthTokenResult | null> {
        const rt = credentials.refreshToken as string | undefined;
        if (!rt) return null;
        return refreshGoogleToken(this.config.clientId, this.config.clientSecret, rt,);
    }
}
