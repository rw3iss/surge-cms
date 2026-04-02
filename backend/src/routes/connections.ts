import crypto from 'crypto';
import { Router, } from 'express';
import { z, } from 'zod';
import { config, } from '../config';
import { query, } from '../db';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { cache, } from '../services/cache';
import { getOAuthProvider, isOAuthProvider, } from '../services/oauth';
import { registerProviderCron, unregisterProviderCron, } from '../services/socialCrons';
import { mapRow, mapRows, } from '../utils/mapRow';
import { handleRouteError, sendError, sendSuccess, } from '../utils/response';
import { logger, } from '../utils/logger';

const router = Router();

const VALID_PROVIDERS = ['instagram', 'facebook', 'tiktok', 'patreon', 'youtube', 'twitter',];

// ─── List all connections ───

router.get('/', authenticate(), requireAdmin, async (_req, res,) => {
    try {
        const result = await query(
            `SELECT id, provider, is_connected, is_enabled, display_name, account_id,
                    credentials, settings, auto_publish, auto_publish_count, sort_order,
                    last_synced_at, connected_by, created_at, updated_at
             FROM social_connections
             ORDER BY sort_order, provider`,
        );

        // Strip sensitive credential fields for the response
        const connections = mapRows(result.rows,).map((conn: any,) => ({
            ...conn,
            credentials: sanitizeCredentials(conn.credentials,),
        }),);

        sendSuccess(res, connections,);
    } catch (error) {
        handleRouteError(res, error, 'list connections',);
    }
},);

// ─── Get single connection ───

router.get('/:provider', authenticate(), requireAdmin, async (req, res,) => {
    try {
        const { provider, } = req.params;
        if (!VALID_PROVIDERS.includes(provider,)) {
            return sendError(res, 'BAD_REQUEST', 'Invalid provider', 400,);
        }

        const result = await query(
            `SELECT * FROM social_connections WHERE provider = $1`,
            [provider,],
        );

        if (result.rows.length === 0) {
            return sendSuccess(res, null,);
        }

        const conn = mapRow(result.rows[0],) as Record<string, unknown>;
        sendSuccess(res, {
            ...conn,
            credentials: sanitizeCredentials(conn.credentials as Record<string, unknown>,),
        },);
    } catch (error) {
        handleRouteError(res, error, 'get connection',);
    }
},);

// ─── Create/update connection (save credentials & settings) ───

const upsertSchema = z.object({
    provider: z.enum(VALID_PROVIDERS as [string, ...string[]],),
    enabled: z.boolean().optional(),
    autoPublish: z.boolean().optional(),
    autoPublishCount: z.number().nullable().optional(),
    credentials: z.record(z.unknown(),).optional(),
},);

router.post('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = upsertSchema.parse(req.body,);
        await upsertConnection(data, req.userId!,);
        sendSuccess(res, { message: 'Connection saved', },);
    } catch (error) {
        handleRouteError(res, error, 'save connection',);
    }
},);

router.put('/:provider', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = upsertSchema.parse({ ...req.body, provider: req.params.provider, },);
        await upsertConnection(data, req.userId!,);
        sendSuccess(res, { message: 'Connection updated', },);
    } catch (error) {
        handleRouteError(res, error, 'update connection',);
    }
},);

// ─── Disconnect (clear token, keep app credentials for easy reconnect) ───

router.delete('/:provider', authenticate(), requireAdmin, async (req, res,) => {
    try {
        const { provider, } = req.params;
        if (!VALID_PROVIDERS.includes(provider,)) {
            return sendError(res, 'BAD_REQUEST', 'Invalid provider', 400,);
        }

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
            return sendError(res, 'NOT_FOUND', 'Connection not found', 404,);
        }

        unregisterProviderCron(provider,);
        await cache.delPattern('social:*',);

        logger.info(`Social connection disconnected: ${provider}`,);
        sendSuccess(res, { message: 'Disconnected', },);
    } catch (error) {
        handleRouteError(res, error, 'disconnect provider',);
    }
},);

// ─── OAuth: Generate authorization URL ───

router.get('/:provider/oauth/authorize', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { provider, } = req.params;

        if (!isOAuthProvider(provider,)) {
            return sendError(res, 'BAD_REQUEST', `${provider} does not use OAuth`, 400,);
        }

        // Read app credentials from DB
        const connResult = await query(
            `SELECT credentials FROM social_connections WHERE provider = $1`,
            [provider,],
        );

        const credentials = connResult.rows[0]?.credentials;
        if (!credentials?.appId || !credentials?.appSecret) {
            return sendError(
                res,
                'MISSING_CREDENTIALS',
                'Save your App ID and App Secret before connecting.',
                400,
            );
        }

        const state = crypto.randomBytes(32,).toString('hex',);
        const statePayload = JSON.stringify({
            provider,
            userId: req.userId,
            timestamp: Date.now(),
        },);

        // Store state in Redis for 10 minutes
        await cache.set(`oauth_state:${state}`, statePayload, 600,);

        const redirectUri = buildCallbackUrl(provider,);
        const oauthProvider = getOAuthProvider(provider, credentials, redirectUri,);
        const authUrl = oauthProvider.getAuthorizationUrl(state,);

        sendSuccess(res, { authUrl, state, },);
    } catch (error) {
        handleRouteError(res, error, 'generate OAuth URL',);
    }
},);

// ─── OAuth: Callback (Meta redirects here) ───

router.get('/:provider/oauth/callback', async (req, res,) => {
    const { provider, } = req.params;
    const { code, state, error: oauthError, error_description, } = req.query;
    const frontendUrl = `${config.frontendUrl}/admin/settings`;

    try {
        // Handle OAuth denial
        if (oauthError) {
            logger.warn(`OAuth denied for ${provider}`, { error: oauthError, error_description, },);
            return res.redirect(`${frontendUrl}?oauth_error=${encodeURIComponent(String(error_description || oauthError),)}`,);
        }

        if (!code || !state) {
            return res.redirect(`${frontendUrl}?oauth_error=Missing+authorization+code+or+state`,);
        }

        // Validate state
        const statePayload = await cache.get(`oauth_state:${state}`,);
        if (!statePayload) {
            return res.redirect(`${frontendUrl}?oauth_error=Invalid+or+expired+authorization+state`,);
        }

        await cache.del(`oauth_state:${state}`,);
        const { userId, } = JSON.parse(statePayload as string,);

        // Read app credentials
        const connResult = await query(
            `SELECT credentials FROM social_connections WHERE provider = $1`,
            [provider,],
        );

        const credentials = connResult.rows[0]?.credentials;
        if (!credentials?.appId || !credentials?.appSecret) {
            return res.redirect(`${frontendUrl}?oauth_error=App+credentials+not+found`,);
        }

        const redirectUri = buildCallbackUrl(provider,);
        const oauthProvider = getOAuthProvider(provider, credentials, redirectUri,);

        // Exchange code for tokens
        const tokenResult = await oauthProvider.exchangeCode(String(code,),);

        // Get user/account info
        const userInfo = await oauthProvider.getUserInfo(tokenResult.accessToken,);

        // Calculate token expiry
        const tokenExpiresAt = tokenResult.expiresIn ?
            new Date(Date.now() + tokenResult.expiresIn * 1000,).toISOString() :
            null;

        // Update connection in DB
        await query(
            `UPDATE social_connections
             SET is_connected = true,
                 display_name = $2,
                 account_id = $3,
                 credentials = credentials || $4::jsonb,
                 connected_by = $5,
                 updated_at = NOW()
             WHERE provider = $1`,
            [
                provider,
                userInfo.displayName,
                userInfo.accountId,
                JSON.stringify({
                    ...credentials,
                    accessToken: tokenResult.accessToken,
                    tokenExpiresAt,
                    ...(userInfo.rawData || {}),
                },),
                userId,
            ],
        );

        // Register and start the token refresh cron
        registerProviderCron(provider,);

        await cache.delPattern('social:*',);

        logger.info(`OAuth connection successful: ${provider} (${userInfo.displayName})`,);
        res.redirect(`${frontendUrl}?oauth_success=${provider}`,);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'OAuth connection failed';
        logger.error(`OAuth callback error for ${provider}`, { error, },);
        res.redirect(`${frontendUrl}?oauth_error=${encodeURIComponent(message,)}`,);
    }
},);

// ─── Helpers ───

function buildCallbackUrl(provider: string,): string {
    const base = config.frontendUrl.replace(/:3000$/, ':3001',); // In dev, API is on 3001
    return `${base}/api/${config.apiVersion}/connections/${provider}/oauth/callback`;
}

function sanitizeCredentials(credentials: Record<string, unknown> | null,): Record<string, unknown> {
    if (!credentials) return {};
    const sanitized = { ...credentials, };
    // Mask sensitive tokens, keep metadata
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
    return sanitized;
}

async function upsertConnection(
    data: z.infer<typeof upsertSchema>,
    userId: string,
): Promise<void> {
    const existing = await query(
        `SELECT id, credentials FROM social_connections WHERE provider = $1`,
        [data.provider,],
    );

    // Merge new credentials with existing (don't overwrite tokens when saving app creds)
    const existingCreds = existing.rows[0]?.credentials || {};
    const mergedCreds = { ...existingCreds, ...data.credentials, };

    if (existing.rows.length > 0) {
        await query(
            `UPDATE social_connections
             SET is_enabled = COALESCE($2, is_enabled),
                 auto_publish = COALESCE($3, auto_publish),
                 auto_publish_count = $4,
                 credentials = $5::jsonb,
                 connected_by = $6,
                 updated_at = NOW()
             WHERE provider = $1`,
            [
                data.provider,
                data.enabled,
                data.autoPublish,
                data.autoPublishCount ?? null,
                JSON.stringify(mergedCreds,),
                userId,
            ],
        );
    } else {
        await query(
            `INSERT INTO social_connections (provider, is_enabled, auto_publish, auto_publish_count, credentials, connected_by)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
            [
                data.provider,
                data.enabled ?? true,
                data.autoPublish ?? false,
                data.autoPublishCount ?? null,
                JSON.stringify(mergedCreds,),
                userId,
            ],
        );
    }
}

export default router;
