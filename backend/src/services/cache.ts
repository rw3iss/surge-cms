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

export async function invalidatePageCache(pageId?: string,): Promise<void> {
    if (pageId) {
        await del(`page:${pageId}`,);
        await del(`page:slug:*`,);
    }
    await delPattern('pages:*',);
    await delPattern('navigation:*',);
    // Invalidate SSR cache for all public pages when any page changes
    await delPattern('ssr:html:*',);
}

export async function invalidatePostCache(postId?: string,): Promise<void> {
    if (postId) {
        await del(`post:${postId}`,);
        await del(`post:slug:*`,);
    }
    await delPattern('posts:*',);
    await delPattern('ssr:html:*',);
}

export async function invalidateCampaignCache(campaignId?: string,): Promise<void> {
    if (campaignId) {
        await del(`campaign:${campaignId}`,);
    }
    await delPattern('campaigns:*',);
    await delPattern('donations:*',);
    await delPattern('ssr:html:*',);
}

export async function invalidateFormCache(formId?: string,): Promise<void> {
    if (formId) {
        await del(`form:${formId}`,);
    }
    await delPattern('forms:*',);
}

export async function invalidateUserCache(userId?: string,): Promise<void> {
    if (userId) {
        await del(`user:${userId}`,);
    }
}

export async function invalidateSettingsCache(): Promise<void> {
    await delPattern('settings:*',);
    await delPattern('navigation:*',);
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
    if (redis) {
        await redis.quit();
        redis = null;
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
    invalidateSettingsCache,
    flushAll,
    healthCheck,
    close: closeRedis,
};
