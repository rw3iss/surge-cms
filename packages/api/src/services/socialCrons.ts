/**
 * Cron jobs for social media integrations.
 * Conditionally registers jobs based on active connections in the database.
 * Exports register/unregister functions for use by the connections route.
 */
import { query, } from '../db';
import { logger, } from '../utils/logger';
import { cronRegistry, } from './cron';
import { getOAuthProvider, isOAuthProvider, } from './oauth';
import { cache, } from './cache';
import type { SocialPlatform, } from '@sitesurge/types';

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

// ─── Background feed sync ───

/**
 * Pull new posts from every connected, enabled provider whose "Sync posts
 * automatically" switch (`auto_publish`) is on. Without this the feed only
 * moved when an admin pressed Sync — a Social block in auto-feed mode then
 * kept showing yesterday's video. Each provider is synced on its own, so one
 * failing provider (an expired token) cannot stop the others.
 */
export const SOCIAL_SYNC_CRON = {
    name: 'social-sync',
    schedule: '*/15 * * * *',
    description: 'Pulls new posts from providers with automatic sync on (every 15 minutes).',
    handler: async (): Promise<void> => {
        const { syncSocialPosts, } = await import('./social.js');
        const r = await query<{ provider: SocialPlatform; }>(
            `SELECT provider FROM social_connections WHERE is_connected = true AND is_enabled = true AND auto_publish = true`,
        ).catch(() => ({ rows: [] as { provider: SocialPlatform; }[], }));
        let total = 0;
        for (const { provider, } of r.rows) {
            try {
                total += await syncSocialPosts(provider, false,);
            } catch (err) {
                logger.warn('social-sync: provider failed', { provider, error: (err as Error).message, },);
            }
        }
        if (total > 0) await cache.invalidateSocialCache();
    },
};

// ─── Init: check DB for existing connected providers and register their crons ───

export async function initSocialCrons(): Promise<void> {
    // Always registered: it checks the connections itself on every run, so a
    // provider connected later needs no re-registration.
    cronRegistry.register(SOCIAL_SYNC_CRON,);
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
