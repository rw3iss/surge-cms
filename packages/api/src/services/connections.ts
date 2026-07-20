/**
 * Social-connection service.
 *
 * Owns all data access, credential masking, OAuth orchestration, and the
 * cron register/unregister side-effects for the `connections` routes.
 * Routes stay thin and call into here.
 *
 * Credentials are JSONB blobs holding app id/secret plus issued OAuth
 * tokens. `sanitizeCredentials` masks the sensitive fields before they
 * leave the server; raw credentials never appear in an API response.
 */
import crypto from 'crypto';
import type { ConnectionRow, MaskedCredentials, } from '@sitesurge/types';
import { config, } from '../config';
import { AppError, NotFoundError, } from '../core/errors';
import { query, transaction, } from '../db';
import { cache, } from './cache';
import { getOAuthProvider, isOAuthProvider, } from './oauth';
import { registerProviderCron, unregisterProviderCron, } from './socialCrons';
import { logger, } from '../utils/logger';
import { mapRow, mapRows, } from '../utils/mapRow';
import { uuidOrNull, } from '../utils/uuid';

export const VALID_PROVIDERS = ['instagram', 'facebook', 'tiktok', 'patreon', 'youtube', 'twitter',];

export interface UpsertConnectionInput {
    provider: string;
    enabled?: boolean;
    autoPublish?: boolean;
    autoPublishCount?: number | null;
    credentials?: Record<string, unknown>;
    /** Provider-specific settings blob (e.g. X `{ twitterMode }`). Merged. */
    settings?: Record<string, unknown>;
}

/** Mask sensitive credential fields, keeping non-secret metadata + boolean
 *  "has*" flags so the admin UI can show connection state. */
export function sanitizeCredentials(
    credentials: Record<string, unknown> | null,
): MaskedCredentials {
    if (!credentials) return {};
    const sanitized = { ...credentials, };
    if (sanitized.accessToken) {
        const token = String(sanitized.accessToken,);
        sanitized.accessToken = token.slice(0, 8,) + '...' + token.slice(-4,);
        sanitized.hasAccessToken = true;
    }
    if (sanitized.appSecret) {
        sanitized.appSecret = '••••••••';
        sanitized.hasAppSecret = true;
    }
    if (sanitized.refreshToken) {
        sanitized.refreshToken = '••••••••';
        sanitized.hasRefreshToken = true;
    }
    // X OAuth 1.0a secrets — mask both (apiKey/consumer key stays visible, like appId).
    if (sanitized.apiSecret) {
        sanitized.apiSecret = '••••••••';
        sanitized.hasApiSecret = true;
    }
    if (sanitized.accessSecret) {
        sanitized.accessSecret = '••••••••';
        sanitized.hasAccessSecret = true;
    }
    return sanitized;
}

function assertValidProvider(provider: string,): void {
    if (!VALID_PROVIDERS.includes(provider,)) {
        throw new AppError(400, 'BAD_REQUEST', 'Invalid provider',);
    }
}

/** List all connections with credentials masked. */
export async function list(): Promise<ConnectionRow[]> {
    const result = await query(
        `SELECT id, provider, is_connected, is_enabled, display_name, account_id,
                credentials, settings, auto_publish, auto_publish_count, sort_order,
                last_synced_at, connected_by, created_at, updated_at
         FROM social_connections
         ORDER BY sort_order, provider`,
    );

    return mapRows(result.rows,).map((conn: any,) => ({
        ...conn,
        credentials: sanitizeCredentials(conn.credentials,),
    }),);
}

/** Fetch one connection (masked credentials). Returns null if missing. */
export async function get(provider: string,): Promise<ConnectionRow | null> {
    assertValidProvider(provider,);

    const result = await query(
        `SELECT * FROM social_connections WHERE provider = $1`,
        [provider,],
    );

    if (result.rows.length === 0) {
        return null;
    }

    const conn = mapRow(result.rows[0],) as Record<string, unknown>;
    return {
        ...conn,
        credentials: sanitizeCredentials(conn.credentials as Record<string, unknown>,),
    } as ConnectionRow;
}

/** Create or update a connection's app credentials + publish settings.
 *  Merges new credentials over existing so saving app creds doesn't wipe
 *  issued tokens. */
export async function upsert(data: UpsertConnectionInput, userId: string,): Promise<void> {
    assertValidProvider(data.provider,);

    // connected_by is a UUID FK; synthetic actors (api-key:<name>) become NULL.
    const connectedBy = uuidOrNull(userId,);

    const existing = await query(
        `SELECT id, credentials, settings FROM social_connections WHERE provider = $1`,
        [data.provider,],
    );

    // Merge new credentials/settings with existing (don't overwrite tokens when
    // saving app creds, or clobber other settings keys when saving one).
    const existingCreds = existing.rows[0]?.credentials || {};
    const mergedCreds = { ...existingCreds, ...data.credentials, };
    const existingSettings = existing.rows[0]?.settings || {};
    const mergedSettings = { ...existingSettings, ...data.settings, };

    if (existing.rows.length > 0) {
        await query(
            `UPDATE social_connections
             SET is_enabled = COALESCE($2, is_enabled),
                 auto_publish = COALESCE($3, auto_publish),
                 auto_publish_count = $4,
                 credentials = $5::jsonb,
                 settings = $6::jsonb,
                 connected_by = $7,
                 updated_at = NOW()
             WHERE provider = $1`,
            [
                data.provider,
                data.enabled,
                data.autoPublish,
                data.autoPublishCount ?? null,
                JSON.stringify(mergedCreds,),
                JSON.stringify(mergedSettings,),
                connectedBy,
            ],
        );
    } else {
        await query(
            `INSERT INTO social_connections (provider, is_enabled, auto_publish, auto_publish_count, credentials, settings, connected_by)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
            [
                data.provider,
                data.enabled ?? true,
                data.autoPublish ?? false,
                data.autoPublishCount ?? null,
                JSON.stringify(mergedCreds,),
                JSON.stringify(mergedSettings,),
                connectedBy,
            ],
        );
    }
}

/** Disconnect: clear issued tokens (keep app credentials for reconnect),
 *  stop the refresh cron, and bust the social cache. */
export async function disconnect(provider: string,): Promise<void> {
    assertValidProvider(provider,);

    // Keep app credentials (appId, appSecret) but clear tokens
    const result = await query(
        `UPDATE social_connections
         SET is_connected = false,
             display_name = NULL,
             account_id = NULL,
             credentials = credentials - 'accessToken' - 'tokenExpiresAt' - 'refreshToken',
             last_synced_at = NULL,
             updated_at = NOW()
         WHERE provider = $1
         RETURNING id`,
        [provider,],
    );

    if (result.rows.length === 0) {
        throw new NotFoundError('Connection',);
    }

    unregisterProviderCron(provider,);
    await cache.invalidateSocialCache();

    logger.info(`Social connection disconnected: ${provider}`,);
}

/**
 * Move a connection one slot up or down in the manual sort order.
 *
 * `social_connections.sort_order` (indexed by idx_social_connections_sort)
 * drives the list ordering. We load the rows in the same order `list()`
 * uses, find the target's neighbour in the requested direction, and swap
 * their `sort_order` values in a single transaction. No-op (still 200) when
 * the target is already at the edge. Rows that never had an explicit order
 * share sort_order=0; we normalise to the row's array index on swap so
 * repeated moves stay well-defined.
 */
export async function reorder(provider: string, direction: 'up' | 'down',): Promise<void> {
    assertValidProvider(provider,);

    const ordered = await query(
        `SELECT id, provider, sort_order
         FROM social_connections
         ORDER BY sort_order, provider`,
    );
    const rows = ordered.rows as Array<{ id: string; provider: string; sort_order: number; }>;

    const index = rows.findIndex((r,) => r.provider === provider);
    if (index === -1) {
        throw new NotFoundError('Connection',);
    }

    const swapWith = direction === 'up' ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= rows.length) {
        return; // already at the edge — nothing to do
    }

    // Normalise to array indices so ties (all-zero sort_order) resolve.
    const a = rows[index];
    const b = rows[swapWith];

    await transaction(async (client,) => {
        await client.query(
            `UPDATE social_connections SET sort_order = $2, updated_at = NOW() WHERE id = $1`,
            [a.id, swapWith,],
        );
        await client.query(
            `UPDATE social_connections SET sort_order = $2, updated_at = NOW() WHERE id = $1`,
            [b.id, index,],
        );
    },);

    await cache.invalidateSocialCache();
}

/** Build the OAuth redirect_uri for a provider. In dev the API is on 3001
 *  while the frontend base is 3000 — swap the port. */
function buildCallbackUrl(provider: string,): string {
    const base = config.frontendUrl.replace(/:3000$/, ':3001',); // In dev, API is on 3001
    return `${base}/api/${config.apiVersion}/connections/${provider}/oauth/callback`;
}

/** Generate an OAuth authorization URL + state, storing the state in Redis
 *  for 10 minutes. Requires saved app credentials. */
export async function startOAuth(
    provider: string,
    userId: string | undefined,
): Promise<{ authUrl: string; state: string; }> {
    if (!isOAuthProvider(provider,)) {
        throw new AppError(400, 'BAD_REQUEST', `${provider} does not use OAuth`,);
    }

    const connResult = await query(
        `SELECT credentials FROM social_connections WHERE provider = $1`,
        [provider,],
    );

    const credentials = connResult.rows[0]?.credentials;
    if (!credentials?.appId || !credentials?.appSecret) {
        throw new AppError(
            400,
            'MISSING_CREDENTIALS',
            'Save your App ID and App Secret before connecting.',
        );
    }

    const state = crypto.randomBytes(32,).toString('hex',);
    const statePayload = JSON.stringify({
        provider,
        userId,
        timestamp: Date.now(),
    },);

    // Store state in Redis for 10 minutes
    await cache.set(cache.CACHE_KEYS.oauthState(state,), statePayload, 600,);

    const redirectUri = buildCallbackUrl(provider,);
    const oauthProvider = getOAuthProvider(provider, credentials, redirectUri,);
    const authUrl = oauthProvider.getAuthorizationUrl(state,);

    return { authUrl, state, };
}

/**
 * Outcome of an OAuth callback. The route maps each variant to a
 * byte-identical redirect query string (the original used `+`-encoded
 * literals for the static messages and `encodeURIComponent` for the
 * dynamic ones — `encoded` carries that distinction so nothing changes
 * on the wire).
 *   - success:        ?oauth_success=<provider>
 *   - static error:   ?oauth_error=<message verbatim, already +-encoded>
 *   - dynamic error:  ?oauth_error=<encodeURIComponent(message)>
 */
export type OAuthCallbackResult =
    | { kind: 'success'; provider: string; }
    | { kind: 'error'; query: string; };

/**
 * Complete the OAuth dance: validate state, exchange the code, persist the
 * token (always — even if account discovery fails), discover account info,
 * register the refresh cron, and bust the social cache. Returns a typed
 * result so the route can build the exact redirect URL it always did.
 */
export async function completeOAuth(
    provider: string,
    code: string | undefined,
    state: string | undefined,
    oauthError: unknown,
    errorDescription: unknown,
): Promise<OAuthCallbackResult> {
    // Handle OAuth denial
    if (oauthError) {
        logger.warn(`OAuth denied for ${provider}`, { error: oauthError, error_description: errorDescription, },);
        return { kind: 'error', query: encodeURIComponent(String(errorDescription || oauthError,),), };
    }

    if (!code || !state) {
        return { kind: 'error', query: 'Missing+authorization+code+or+state', };
    }

    // Validate state (read-and-delete — CSRF state is single-use).
    const statePayload = await cache.consumeOAuthState(state,);
    if (!statePayload) {
        return { kind: 'error', query: 'Invalid+or+expired+authorization+state', };
    }

    // cache.get() already JSON-parses the value, so statePayload is an
    // object — don't double-parse.
    const parsed = typeof statePayload === 'string' ?
        JSON.parse(statePayload,) :
        statePayload as Record<string, unknown>;
    const { userId, } = parsed;

    // Read app credentials
    const connResult = await query(
        `SELECT credentials FROM social_connections WHERE provider = $1`,
        [provider,],
    );

    const credentials = connResult.rows[0]?.credentials;
    if (!credentials?.appId || !credentials?.appSecret) {
        return { kind: 'error', query: 'App+credentials+not+found', };
    }

    const redirectUri = buildCallbackUrl(provider,);
    const oauthProvider = getOAuthProvider(provider, credentials, redirectUri,);

    // Exchange code for tokens
    const tokenResult = await oauthProvider.exchangeCode(String(code,),);

    // Calculate token expiry
    const tokenExpiresAt = tokenResult.expiresIn ?
        new Date(Date.now() + tokenResult.expiresIn * 1000,).toISOString() :
        null;

    // ALWAYS save the token first — getUserInfo can fail (e.g. no FB Page
    // linked) but the token is still valid. If we lose it, the user has to
    // re-authorize from scratch.
    await query(
        `UPDATE social_connections
         SET credentials = credentials || $2::jsonb,
             connected_by = $3,
             updated_at = NOW()
         WHERE provider = $1`,
        [
            provider,
            JSON.stringify({
                ...credentials,
                accessToken: tokenResult.accessToken,
                tokenExpiresAt,
            },),
            // connected_by is a UUID FK; the state-carried actor may be a
            // synthetic api-key:<name> — coerce to NULL.
            uuidOrNull(userId as string | null | undefined,),
        ],
    );

    // Try to get user/account info (discovers the IG Business Account ID
    // via the Facebook Pages API). This can fail if the user's Instagram
    // isn't linked to a Facebook Page yet — in that case we still keep the
    // token and redirect with a descriptive message so they can fix the
    // link and retry.
    let userInfo;
    try {
        userInfo = await oauthProvider.getUserInfo(tokenResult.accessToken,);
    } catch (infoError) {
        const msg = infoError instanceof Error ? infoError.message : 'Could not retrieve account info';
        logger.warn(`OAuth ${provider}: token saved but getUserInfo failed`, { error: msg, },);
        // Token is saved — redirect with a specific message
        return {
            kind: 'error',
            query: encodeURIComponent(
                msg + '. Your token was saved — link your Instagram to a Facebook Page, then reconnect.',
            ),
        };
    }

    // Full success — save account info too
    await query(
        `UPDATE social_connections
         SET is_connected = true,
             display_name = $2,
             account_id = $3,
             credentials = credentials || $4::jsonb,
             updated_at = NOW()
         WHERE provider = $1`,
        [
            provider,
            userInfo.displayName,
            userInfo.accountId,
            JSON.stringify({
                ...(userInfo.rawData || {}),
            },),
        ],
    );

    // Register and start the token refresh cron
    registerProviderCron(provider,);

    await cache.invalidateSocialCache();

    logger.info(`OAuth connection successful: ${provider} (${userInfo.displayName})`,);
    return { kind: 'success', provider, };
}
