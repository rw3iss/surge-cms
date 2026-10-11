/**
 * How the YouTube reader authenticates.
 *
 *  - **oauth** — the connection was signed in with Google (has a refresh
 *    token). Sees the channel's UNLISTED videos too. The ~1 h access token is
 *    renewed here, on demand, and saved; nobody signs in again unless Google
 *    revokes the grant.
 *  - **key** — an API key: public videos only (the original mode).
 *
 * A failed renewal (grant revoked, client secret changed) records
 * `oauthError` on the connection — the admin shows "Reconnect" — and falls
 * back to the API key when one is saved, so the list never empties.
 */
import { config, } from '../../config';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { refreshGoogleToken, } from '../oauth/google';

export type YouTubeAuth =
    | { mode: 'oauth'; accessToken: string; channelId: string; }
    | { mode: 'key'; apiKey: string; channelId: string; };

/** Renew this long before expiry. */
const SKEW_MS = 120_000;

async function readCreds(): Promise<Record<string, unknown>> {
    try {
        const r = await query<{ credentials: Record<string, unknown> | null; }>(
            `SELECT credentials FROM social_connections WHERE provider = 'youtube'`,
        );
        return r.rows[0]?.credentials ?? {};
    } catch (e) {
        logger.warn('youtube: could not read saved credentials', { error: (e as Error).message, },);
        return {};
    }
}

async function saveCreds(patch: Record<string, unknown>,): Promise<void> {
    await query(
        `UPDATE social_connections SET credentials = credentials || $1::jsonb, updated_at = NOW() WHERE provider = 'youtube'`,
        [JSON.stringify(patch,),],
    );
}

/** A valid access token for the signed-in connection, or null (not signed in / renewal failed). */
export async function youTubeAccessToken(creds?: Record<string, unknown>,): Promise<string | null> {
    const c = creds ?? await readCreds();
    const refreshToken = c.refreshToken as string | undefined;
    if (!refreshToken) return null;
    const current = c.accessToken as string | undefined;
    const expires = c.tokenExpiresAt ? Date.parse(String(c.tokenExpiresAt,),) : 0;
    if (current && expires - Date.now() > SKEW_MS) return current;

    const clientId = String(c.appId ?? '',);
    const clientSecret = String(c.appSecret ?? '',);
    if (!clientId || !clientSecret) return null;
    try {
        const t = await refreshGoogleToken(clientId, clientSecret, refreshToken,);
        await saveCreds({
            accessToken: t.accessToken,
            tokenExpiresAt: new Date(Date.now() + (t.expiresIn ?? 3600) * 1000,).toISOString(),
            // Google normally keeps the same refresh token; keep a new one if sent.
            ...(t.refreshToken ? { refreshToken: t.refreshToken, } : {}),
            oauthError: null,
        },);
        return t.accessToken;
    } catch (e) {
        const msg = (e as Error).message || 'Google sign-in expired';
        logger.warn('youtube: token renewal failed — reconnect needed', { error: msg, },);
        await saveCreds({ oauthError: msg, },).catch(() => {},);
        return null;
    }
}

/** Auth for a read: the signed-in channel first, else the API key. Null when neither works. */
export async function resolveYouTubeAuth(): Promise<YouTubeAuth | null> {
    const c = await readCreds();
    const channelId = String(c.channelId || config.social.youtube.channelId || '',).trim();
    if (c.refreshToken && /^UC[\w-]{22}$/.test(channelId,)) {
        const token = await youTubeAccessToken(c,);
        if (token) return { mode: 'oauth', accessToken: token, channelId, };
    }
    const apiKey = String(c.apiKey || config.social.youtube.apiKey || '',).trim();
    if (!apiKey || !channelId) return null;
    return { mode: 'key', apiKey, channelId, };
}

/** `fetch` init + query suffix for either mode. */
export function authRequest(auth: YouTubeAuth,): { query: string; init: RequestInit; } {
    return auth.mode === 'oauth'
        ? { query: '', init: { headers: { Authorization: `Bearer ${auth.accessToken}`, }, }, }
        : { query: `&key=${encodeURIComponent(auth.apiKey,)}`, init: {}, };
}
