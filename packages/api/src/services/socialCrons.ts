/**
 * Cron jobs for social media integrations.
 * Conditionally registers jobs based on active connections in the database.
 * Exports register/unregister functions for use by the connections route.
 */
import { query, } from '../db';
import { logger, } from '../utils/logger';
import { cronRegistry, } from './cron';
import { getOAuthProvider, isOAuthProvider, } from './oauth';

// ─── Provider cron definitions ───

interface ProviderCronDef {
    name: string;
    schedule: string;
    description: string;
    handler: () => Promise<void>;
}

const PROVIDER_CRONS: Record<string, ProviderCronDef> = {
    instagram: {
        name: 'instagram-token-refresh',
        schedule: '0 3 */7 * *', // Every 7 days at 3:00 AM
        description: 'Refreshes Instagram long-lived access token (expires every 60 days)',
        handler: refreshInstagramToken,
    },
};

// ─── Token refresh handlers ───

async function refreshInstagramToken(): Promise<void> {
    const result = await query(
        `SELECT credentials FROM social_connections WHERE provider = 'instagram' AND is_connected = true`,
    );

    const credentials = result.rows[0]?.credentials;
    if (!credentials?.accessToken) {
        logger.warn('No Instagram access token found, skipping refresh',);
        return;
    }

    if (!credentials.appId || !credentials.appSecret) {
        logger.warn('Instagram app credentials missing, cannot refresh token',);
        return;
    }

    const redirectUri = ''; // Not needed for token refresh
    const provider = getOAuthProvider('instagram', credentials, redirectUri,);
    const tokenResult = await provider.refreshToken(credentials.accessToken, credentials,);

    if (!tokenResult) {
        throw new Error('Instagram token refresh returned null',);
    }

    const tokenExpiresAt = tokenResult.expiresIn ?
        new Date(Date.now() + tokenResult.expiresIn * 1000,).toISOString() :
        null;

    await query(
        `UPDATE social_connections
         SET credentials = credentials || $1::jsonb,
             updated_at = NOW()
         WHERE provider = 'instagram'`,
        [JSON.stringify({
            accessToken: tokenResult.accessToken,
            tokenExpiresAt,
        },),],
    );

    logger.info(`Instagram token refreshed, expires in ${tokenResult.expiresIn} seconds`,);
}

// ─── Public API: register/unregister by provider ───

export function registerProviderCron(provider: string,): void {
    const def = PROVIDER_CRONS[provider];
    if (!def) return;

    cronRegistry.registerAndStart(def,);
}

export function unregisterProviderCron(provider: string,): void {
    const def = PROVIDER_CRONS[provider];
    if (!def) return;

    cronRegistry.unregister(def.name,);
}

// ─── Init: check DB for existing connected providers and register their crons ───

export async function initSocialCrons(): Promise<void> {
    try {
        const result = await query(
            `SELECT provider FROM social_connections WHERE is_connected = true`,
        );

        for (const row of result.rows) {
            if (PROVIDER_CRONS[row.provider]) {
                cronRegistry.register(PROVIDER_CRONS[row.provider],);
                logger.info(`Registered cron for connected provider: ${row.provider}`,);
            }
        }
    } catch (error) {
        logger.warn('Could not check social connections for cron init', { error, },);
    }
}
