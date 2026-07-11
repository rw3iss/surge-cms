import Redis from 'ioredis';
import { config, } from '../config';
import { logger, } from '../utils/logger';

let redis: Redis | null = null;

export function getRedis(): Redis {
    if (!redis) {
        redis = new Redis(config.redis.url as string, {
            maxRetriesPerRequest: 3,
            lazyConnect: true,
        },);

        redis.on('error', (err,) => {
            logger.error('Redis connection error', { error: err.message, },);
        },);

        redis.on('connect', () => {
            logger.info('Connected to Redis',);
        },);
    }

    return redis;
}

export async function get<T,>(key: string,): Promise<T | null> {
    try {
        const redis = getRedis();
        const value = await redis.get(key,);
        return value ? JSON.parse(value,) : null;
    } catch (error) {
        logger.error('Cache get error', { key, error, },);
        return null;
    }
}

export async function set(
    key: string,
    value: unknown,
    ttlSeconds = config.redis.cacheTtl,
): Promise<void> {
    try {
        const redis = getRedis();
        const serialized = JSON.stringify(value,);
        if (ttlSeconds > 0) {
            await redis.setex(key, ttlSeconds, serialized,);
        } else {
            await redis.set(key, serialized,);
        }
    } catch (error) {
        logger.error('Cache set error', { key, error, },);
    }
}

export async function del(key: string,): Promise<void> {
    try {
        const redis = getRedis();
        await redis.del(key,);
    } catch (error) {
        logger.error('Cache delete error', { key, error, },);
    }
}

export async function delPattern(pattern: string,): Promise<void> {
    try {
        const redis = getRedis();
        const keys = await redis.keys(pattern,);
        if (keys.length > 0) {
            await redis.del(...keys,);
            logger.debug('Deleted cache keys', { pattern, count: keys.length, },);
        }
    } catch (error) {
        logger.error('Cache delete pattern error', { pattern, error, },);
    }
}

/** Drop the cached sitemap.xml so the next request rebuilds it from
 *  current content. Called from every page / post / campaign / form
 *  invalidator below, plus from the explicit admin regenerate route. */
export async function invalidateSitemapCache(): Promise<void> {
    await del('sitemap:xml',);
}

export async function invalidatePageCache(pageId?: string,): Promise<void> {
    if (pageId) {
        await del(`page:${pageId}`,);
        // `page:slug:*` was previously called via `del()`, which deleted
        // the literal key `page:slug:*` (a no-op — that key never
        // exists). Use the pattern variant so all cached slug entries
        // for a saved page are actually busted; otherwise the public
        // /:slug route serves a 5-minute-stale copy after every save.
        await delPattern('page:slug:*',);
    }
    // The homepage flag is a page-level mutation, so any save could
    // change which page is "the homepage" — clear it on every page
    // invalidation rather than only when we know it changed.
    await del('page:homepage',);
    await delPattern('pages:*',);
    await delPattern('navigation:*',);
    // Invalidate SSR cache for all public pages when any page changes
    await delPattern('ssr:html:*',);
    await invalidateSitemapCache();
}

export async function invalidatePostCache(postId?: string,): Promise<void> {
    if (postId) {
        await del(`post:${postId}`,);
        await del(`post:slug:*`,);
    }
    await delPattern('posts:*',);
    await delPattern('ssr:html:*',);
    await invalidateSitemapCache();
}

export async function invalidateCampaignCache(campaignId?: string,): Promise<void> {
    if (campaignId) {
        await del(`campaign:${campaignId}`,);
    }
    await delPattern('campaigns:*',);
    await delPattern('donations:*',);
    await delPattern('ssr:html:*',);
    await invalidateSitemapCache();
}

export async function invalidateFormCache(formId?: string,): Promise<void> {
    if (formId) {
        await del(`form:${formId}`,);
    }
    await delPattern('forms:*',);
    await invalidateSitemapCache();
}

export async function invalidateUserCache(userId?: string,): Promise<void> {
    if (userId) {
        await del(`user:${userId}`,);
    }
}

/** Invalidate mailing-list catalog + per-list caches. */
export async function invalidateMailingListsCache(listId?: string,): Promise<void> {
    if (listId) await del(`mail:list:${listId}`,);
    await del('mail:lists:enabled',);
    await delPattern('mail:lists:*',);
}

/** Invalidate mail-template catalog + per-template caches. */
export async function invalidateMailTemplatesCache(templateId?: string,): Promise<void> {
    if (templateId) await del(`mail:template:${templateId}`,);
    await del('mail:templates',);
    await delPattern('mail:templates:*',);
}

export async function invalidateSettingsCache(): Promise<void> {
    await delPattern('settings:*',);
    await delPattern('navigation:*',);
    // SSR HTML cache contains site name / logo / description from settings
    await delPattern('ssr:html:*',);
    // In-process site meta cache used by SSR route resolver
    try {
        const { invalidateSiteMetaCache, } = await import('./ssr/routes.js');
        invalidateSiteMetaCache();
    } catch {
        /* module may not be loaded yet */
    }
}

export async function flushAll(): Promise<void> {
    try {
        const redis = getRedis();
        await redis.flushdb();
        logger.info('Cache flushed',);
    } catch (error) {
        logger.error('Cache flush error', { error, },);
    }
}

export async function healthCheck(): Promise<boolean> {
    try {
        const redis = getRedis();
        await redis.ping();
        return true;
    } catch {
        return false;
    }
}

export async function closeRedis(): Promise<void> {
    if (!redis) return;
    const r = redis;
    redis = null;
    // Try a graceful QUIT first, but fall back to `disconnect()` if it hangs.
    // In dev, Redis being unreachable can make quit() block until a TCP
    // timeout, which is much longer than our shutdown deadline.
    const CLOSE_TIMEOUT_MS = 800;
    try {
        await Promise.race([
            r.quit(),
            new Promise((_, reject,) =>
                setTimeout(() => reject(new Error('redis quit timeout',),), CLOSE_TIMEOUT_MS,)),
        ],);
    } catch {
        try {
            r.disconnect();
        } catch {
            /* ignore */
        }
    }
}

export const cache = {
    get,
    set,
    del,
    delPattern,
    invalidatePageCache,
    invalidatePostCache,
    invalidateCampaignCache,
    invalidateFormCache,
    invalidateUserCache,
    invalidateMailingListsCache,
    invalidateMailTemplatesCache,
    invalidateSettingsCache,
    invalidateSitemapCache,
    flushAll,
    healthCheck,
    close: closeRedis,
};
