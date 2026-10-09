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

    // ── Generic entities ──
    entityPrefix: (type: string,) => `entity:${type}:`,
    entityList: (type: string, hash: string,) => `entity:${type}:list:${hash}`,
    entityRecord: (type: string, id: string,) => `entity:${type}:rec:${id}`,
    // Distinct values of a filterable field — under the entity:<type>: prefix so
    // it's dropped by invalidateEntityCache on any record write of that type.
    entityFilterValues: (type: string, field: string,) => `entity:${type}:filtervals:${field}`,
    entityTypesAll: 'entity_types:all',

    // ── Content-block templates ──
    contentBlockTemplatesByType: (type: string,) => `cbt:type:${type}`,
    /** Templates bound to no entity type — the reusable "components". */
    contentBlockTemplatesGlobal: 'cbt:global',

    // ── Feed / sitemap ──
    feedRss: 'feed:rss',
    sitemapXml: 'sitemap:xml',

    // ── Transient (not entity cache) ──
    oauthState: (state: string,) => `oauth_state:${state}`,

    // Public post counts per type (anonymous view; cleared with posts:*).
    postTypeCountsAnon: 'posts:type-counts:anon',

    // Video: built master playlists (full + teaser), invalidated when a
    // rendition becomes ready or the video is re-packaged/deleted.
    videoMaster: (mediaId: string, variant: 'full' | 'teaser',) => `video:master:${mediaId}:${variant}`,
    videoMasterPrefix: (mediaId: string,) => `video:master:${mediaId}:*`,
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

/**
 * Core content types are ALSO generic entity types, and they are cached twice.
 *
 * `post`, `page`, `campaign`, `form` and `user` are seeded as `origin:'core'`
 * entity types adopting their existing tables, so the same row is readable two
 * ways: through the bespoke module (`posts:*`, `page:slug:*`, …) and through
 * the generic entity service (`entity:post:list:*`). Core CRUD still lives in
 * the bespoke modules, and those only ever knew about their own keys — so
 * publishing a post dropped `posts:*` and left `entity:post:list:*` intact.
 *
 * The visible symptom is an entity block or carousel bound to a query
 * ("newest published post") that keeps rendering the PREVIOUS article: the
 * block reads through the entity cache, which the writer never invalidated.
 *
 * `invalidateShopProductCache` already carried this fix for `product`. It is
 * called here from inside each core invalidator rather than added at the call
 * sites, because there are dozens of call sites and one that forgets
 * reintroduces the bug silently — nothing fails, the page is just wrong.
 */
async function invalidateMirroredEntityCache(type: string,): Promise<void> {
    await delPattern(`${CACHE_KEYS.entityPrefix(type,)}*`,);
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
    await invalidateMirroredEntityCache('page',);
    // Invalidate SSR cache for all public pages when any page changes
    await delPattern(CACHE_KEYS.ssrAll,);
    await invalidateSitemapCache();
}

export async function invalidatePostCache(postId?: string,): Promise<void> {
    if (postId) {
        await del(`post:${postId}`,);
    }
    // By-slug copies (posts.getPublicBySlug). This was `del('post:slug:*')` —
    // `del` removes ONE exact key, so the pattern never matched and a saved
    // post kept serving its old copy by slug until the 5-minute TTL. Cleared
    // on every post write (a rename leaves no old slug to target).
    await delPattern('post:slug:*',);
    await delPattern('posts:*',);
    await invalidateMirroredEntityCache('post',);
    await delPattern(CACHE_KEYS.ssrAll,);
    await invalidateSitemapCache();
}

export async function invalidateCampaignCache(campaignId?: string,): Promise<void> {
    if (campaignId) {
        await del(`campaign:${campaignId}`,);
    }
    await delPattern('campaigns:*',);
    // The public by-slug copy (`campaign:slug:<slug>`, campaigns.getPublicBySlugCached).
    // It was never cleared, so a saved setting or a new donation showed on
    // slug-addressed views (the campaign page, {{campaignStatus('slug')}})
    // only after its 5-minute TTL ran out. All slugs: a slug rename leaves no
    // way to know the old one here, and campaigns are few.
    await delPattern('campaign:slug:*',);
    await delPattern('donations:*',);
    await invalidateMirroredEntityCache('campaign',);
    await delPattern(CACHE_KEYS.ssrAll,);
    await invalidateSitemapCache();
}

/**
 * A media item's metadata is copied into the content that shows it
 * (`featuredMedia` on posts, campaigns, events, and entity records), so
 * editing or deleting media must drop those cached copies too — otherwise new
 * credits appear only after each cache's TTL.
 */
export async function invalidateMediaConsumersCache(): Promise<void> {
    await invalidatePostCache();
    await invalidateCampaignCache();
    await delPattern('entity:*',);
}

/** A video's renditions changed: drop its cached master playlists. */
export async function invalidateVideoCache(mediaId: string,): Promise<void> {
    await delPattern(CACHE_KEYS.videoMasterPrefix(mediaId,),);
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
    await invalidateMirroredEntityCache('form',);
    await invalidateSitemapCache();
}

export async function invalidateUserCache(userId?: string,): Promise<void> {
    if (userId) {
        await del(`user:${userId}`,);
    }
    await invalidateMirroredEntityCache('user',);
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

/** Drop all cached list + record reads for one generic entity type. */
export async function invalidateEntityCache(type: string,): Promise<void> {
    await delPattern(`${CACHE_KEYS.entityPrefix(type,)}*`,);
}

/** Drop the cached entity-type registry projection + all per-type reads. */
export async function invalidateEntityTypesCache(): Promise<void> {
    await del(CACHE_KEYS.entityTypesAll,);
    await delPattern('entity:*',);
}

/** Drop the cached content-block-template list for one entity type. */
export async function invalidateContentBlockTemplatesCache(type: string,): Promise<void> {
    await del(CACHE_KEYS.contentBlockTemplatesByType(type,),);
}

/** Drop the cached list of entity-less (global) templates. */
export async function invalidateContentBlockTemplatesGlobalCache(): Promise<void> {
    await del(CACHE_KEYS.contentBlockTemplatesGlobal,);
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
    // Products are ALSO an entity type, read through `entity:product:*` by the
    // entity block, carousels and `{{product(...)}}`. Without this a product
    // that was archived or un-featured kept appearing there until the 60s list
    // TTL expired — a stale carousel is the visible symptom of a cache the
    // writer didn't know about. Also drops the field-value suggestion lists.
    await delPattern(`${CACHE_KEYS.entityPrefix('product',)}*`,);
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
    // A Stripe-key change flows through here, so bust the cached connection
    // status for every context (keys are `shop:stripe:status:<context>`) so it
    // re-checks against the new keys.
    await del(CACHE_KEYS.shopStripeStatus,);
    await delPattern(`${CACHE_KEYS.shopStripeStatus}:*`,);
}

/** Read-and-delete the transient OAuth CSRF state (get already JSON-parses). */
export async function consumeOAuthState<T,>(state: string,): Promise<T | null> {
    const key = CACHE_KEYS.oauthState(state,);
    try {
        // ONE atomic GETDEL: with GET-then-DEL two callbacks racing on the same
        // state (or two instances) could both read it before either deleted it.
        const raw = await getRedis().getdel(key,);
        if (raw == null) return null;
        try {
            return JSON.parse(raw,) as T;
        } catch {
            return raw as unknown as T;
        }
    } catch (error) {
        logger.error('OAuth state consume failed', { key, error, },);
        return null;
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
    invalidateMediaConsumersCache,
    invalidateVideoCache,
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
    invalidateEntityCache,
    invalidateEntityTypesCache,
    invalidateContentBlockTemplatesCache,
    invalidateContentBlockTemplatesGlobalCache,
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
