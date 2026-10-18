/**
 * Cron jobs for social media integrations.
 *
 * Every job is registered ONCE at boot on the cluster primary (crons are
 * primary-only) and checks the connections itself on each run — so
 * connecting / disconnecting a provider needs no (re)registration. That used
 * to happen inside the request handler, i.e. on whichever worker served it:
 * the job then ran on a worker, ran twice after a restart, and a disconnect
 * only stopped it on one process.
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
    // Not connected (the job is always registered): nothing to do.
    if (!credentials?.accessToken) return;

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

// ─── Init (primary only) ───

/** Every social job, registered unconditionally — each one checks the connections itself. */
export const SOCIAL_CRONS = (): ProviderCronDef[] => [SOCIAL_SYNC_CRON, ...Object.values(PROVIDER_CRONS,),];

export async function initSocialCrons(): Promise<void> {
    for (const def of SOCIAL_CRONS()) cronRegistry.register(def,);
}
