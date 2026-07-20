import Redis from 'ioredis';
import { config, } from '../config';
import { logger, } from '../utils/logger';

/**
 * ══════════════════════════════════════════════════════════════════════
 * THE cache-invalidation contract.
 *
 * DO NOT call `cache.del` / `cache.delPattern` directly from a service.
 * Add a `CACHE_KEYS` entry + a named `invalidateXCache()` here instead and
 * call that. A guard test (`cache-contract.test.ts`) fails the build if a
 * raw `del`/`delPattern` appears outside this file.
 *
 * Every Redis key string used anywhere in the API is declared once, in the
 * `CACHE_KEYS` map below — literals live NOWHERE else. Read/write sites
 * import a builder; invalidation goes through the named invalidators.
 * Changing a string here changes a production key: only do so deliberately.
 * ══════════════════════════════════════════════════════════════════════
 */
export const CACHE_KEYS = {
    // ── Social ──
    socialAll: 'social:*',
    socialHomepage: 'social:homepage',
    socialPosts: (platform: string, page: number, limit: number,) =>
        `social:posts:${platform}:${page}:${limit}`,
    socialPlatform: (platform: string, page: number, limit: number, sort: string, sortDir: string,) =>
        `social:${platform}:${page}:${limit}:${sort}:${sortDir}`,
    socialLiveFeed: (platform: string, limit: number,) => `social:feed:${platform}:${limit}`,
    socialEmbed: (id: string,) => `social:embed:${id}`,

    // ── Block styles ──
    blockStylesAll: 'block_styles:all',

    // ── Fonts ──
    fontsList: 'fonts:list',

    // ── Settings (namespace) ──
    settingsAll: 'settings:*',
    settingsByKey: (key: string,) => `settings:${key}`,
    settingsPublic: 'settings:public',
    settingsSiteColors: 'settings:site_colors',

    // ── SSR ──
    ssrAll: 'ssr:html:*',
    ssrPath: (pathname: string,) => `ssr:html:${pathname}`,

    // ── Shop ──
    shopCategories: 'shop:categories',
    shopCollectionsPrefix: 'shop:collections:',
    shopCollections: (suffix: string,) => `shop:collections:${suffix}`,
    shopTags: 'shop:tags',
    shopProductsPrefix: 'shop:products:',
    shopProductSlugPrefix: 'shop:product:slug:',
    shopProductSlug: (slug: string,) => `shop:product:slug:${slug}`,
    shopReviewsPrefix: 'shop:reviews:',
    shopReviews: (productId: string, sort: string, page: number, limit: number,) =>
        `shop:reviews:${productId}:${sort}:${page}:${limit}`,
    shopSettingsRaw: 'shop:settings:raw',
    shopSettingsPublic: 'shop:settings:public',
    shopStripeStatus: 'shop:stripe:status',

    // ── Feed / sitemap ──
    feedRss: 'feed:rss',
    sitemapXml: 'sitemap:xml',

    // ── Transient (not entity cache) ──
    oauthState: (state: string,) => `oauth_state:${state}`,
} as const;

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
    await del(CACHE_KEYS.sitemapXml,);
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
    await delPattern(CACHE_KEYS.ssrAll,);
    await invalidateSitemapCache();
}

export async function invalidatePostCache(postId?: string,): Promise<void> {
    if (postId) {
        await del(`post:${postId}`,);
        await del(`post:slug:*`,);
    }
    await delPattern('posts:*',);
    await delPattern(CACHE_KEYS.ssrAll,);
    await invalidateSitemapCache();
}

export async function invalidateCampaignCache(campaignId?: string,): Promise<void> {
    if (campaignId) {
        await del(`campaign:${campaignId}`,);
    }
    await delPattern('campaigns:*',);
    await delPattern('donations:*',);
    await delPattern(CACHE_KEYS.ssrAll,);
    await invalidateSitemapCache();
}

export async function invalidateFormCache(formId?: string,): Promise<void> {
    if (formId) {
        await del(`form:${formId}`,);
    }
    // `forms:*` (published list) does NOT match the per-slug key `form:slug:*`
    // (the cache that holds a form's questions/fields), so bust it explicitly —
    // otherwise field edits stay stale for the 300s TTL.
    await delPattern('form:slug:*',);
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
    await delPattern(CACHE_KEYS.settingsAll,);
    await delPattern('navigation:*',);
    // SSR HTML cache contains site name / logo / description from settings
    await delPattern(CACHE_KEYS.ssrAll,);
    // In-process site meta cache used by SSR route resolver
    try {
        const { invalidateSiteMetaCache, } = await import('./ssr/routes.js');
        invalidateSiteMetaCache();
    } catch {
        /* module may not be loaded yet */
    }
}

/** Bust every social cache (stored post lists, homepage selection, live feeds). */
export async function invalidateSocialCache(): Promise<void> {
    await delPattern(CACHE_KEYS.socialAll,);
}

/** Bust only the homepage-selection cache. */
export async function invalidateSocialHomepageCache(): Promise<void> {
    await del(CACHE_KEYS.socialHomepage,);
}

/** Bust one post's resolved-embed cache (card / oEmbed HTML). */
export async function invalidateSocialEmbed(id: string,): Promise<void> {
    await del(CACHE_KEYS.socialEmbed(id,),);
}

export async function invalidateBlockStylesCache(): Promise<void> {
    await del(CACHE_KEYS.blockStylesAll,);
}

export async function invalidateFontsCache(): Promise<void> {
    await del(CACHE_KEYS.fontsList,);
}

/** Swatches persist under the settings namespace (settings:site_colors). This
 *  is a subset of what invalidateSettingsCache already clears; kept explicit
 *  for call-site readability. */
export async function invalidateSwatchesCache(): Promise<void> {
    await del(CACHE_KEYS.settingsSiteColors,);
}

/** Drop one rendered SSR HTML entry. */
export async function invalidateSsrCache(pathname: string,): Promise<void> {
    await del(CACHE_KEYS.ssrPath(pathname,),);
}

/** Drop every rendered SSR HTML entry. */
export async function invalidateAllSsrCache(): Promise<void> {
    await delPattern(CACHE_KEYS.ssrAll,);
}

export async function invalidateShopCatalogCache(): Promise<void> {
    await del(CACHE_KEYS.shopCategories,);
    await delPattern(`${CACHE_KEYS.shopCollectionsPrefix}*`,);
    await del(CACHE_KEYS.shopTags,);
    // Product detail carries taxonomy → bust product caches too.
    await delPattern(`${CACHE_KEYS.shopProductSlugPrefix}*`,);
    await delPattern(`${CACHE_KEYS.shopProductsPrefix}*`,);
}

export async function invalidateShopProductCache(): Promise<void> {
    await delPattern(`${CACHE_KEYS.shopProductsPrefix}*`,);
    await delPattern(`${CACHE_KEYS.shopProductSlugPrefix}*`,);
}

/** Slug-only product bust (variant inventory changes). */
export async function invalidateShopProductSlugCache(): Promise<void> {
    await delPattern(`${CACHE_KEYS.shopProductSlugPrefix}*`,);
}

/** Review list for one product + the denormalized rating on product caches. */
export async function invalidateShopReviewCache(productId: string,): Promise<void> {
    await delPattern(`${CACHE_KEYS.shopReviewsPrefix}${productId}:*`,);
    await delPattern(`${CACHE_KEYS.shopProductSlugPrefix}*`,);
    await delPattern(`${CACHE_KEYS.shopProductsPrefix}*`,);
}

export async function invalidateShopSettingsCache(): Promise<void> {
    await del(CACHE_KEYS.shopSettingsRaw,);
    await del(CACHE_KEYS.shopSettingsPublic,);
}

/** Read-and-delete the transient OAuth CSRF state (get already JSON-parses). */
export async function consumeOAuthState<T,>(state: string,): Promise<T | null> {
    const key = CACHE_KEYS.oauthState(state,);
    const payload = await get<T>(key,);
    await del(key,);
    return payload;
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
    invalidateSocialCache,
    invalidateSocialHomepageCache,
    invalidateSocialEmbed,
    invalidateBlockStylesCache,
    invalidateFontsCache,
    invalidateSwatchesCache,
    invalidateSsrCache,
    invalidateAllSsrCache,
    invalidateShopCatalogCache,
    invalidateShopProductCache,
    invalidateShopProductSlugCache,
    invalidateShopReviewCache,
    invalidateShopSettingsCache,
    consumeOAuthState,
    CACHE_KEYS,
    flushAll,
    healthCheck,
    close: closeRedis,
};
