/**
 * Social feed service — route-layer orchestration for the social block /
 * homepage widgets (headless spec).
 *
 * The platform fetchers + sync engine live in `services/social.ts`
 * (YouTube/Twitter/Instagram/… API pulls). This module owns the
 * HTTP-route logic that the old `routes/social.ts` carried inline:
 * the cached DB-backed post lists, the per-platform search/sort query,
 * the homepage selection get/set, post deletion, and the admin sync
 * wrapper. It is named `socialFeed` to avoid colliding with the
 * existing `social` platform-fetcher service.
 *
 * Caching note: every cached read here is public-shaped — `social_posts`
 * are published feed items with NO per-user or admin shaping, so the
 * caches are safe to populate for any reader (matching prior behavior).
 */
import type { SocialPlatform, SocialPost, } from '@rw/cms-shared';
import { query, } from '../db';
import { mapRows, } from '../utils/mapRow';
import { uuidOrNull, } from '../utils/uuid';
import { cache, } from './cache';
import {
    getLiveFeed,
    getLiveFeeds,
    getSocialPosts,
    syncAllPlatforms,
    syncSocialPosts,
} from './social';

export const VALID_PLATFORMS: SocialPlatform[] = [
    'patreon', 'youtube', 'instagram', 'facebook', 'twitter', 'tiktok',
];

export interface SocialListResult {
    data: SocialPost[];
    meta: { page: number; limit: number; total: number; totalPages: number; };
}

// ─── DB-backed post lists (cached) ────────────────────────────────

/** Stored social posts across platforms, cached 600s. */
export async function listPosts(
    platform: SocialPlatform | undefined,
    page: number,
    limit: number,
): Promise<SocialListResult> {
    const offset = (page - 1) * limit;
    const cacheKey = `social:posts:${platform || 'all'}:${page}:${limit}`;

    const cached = await cache.get<SocialListResult>(cacheKey,);
    if (cached) return cached;

    const posts = await getSocialPosts(platform, limit, offset,);

    let whereClause = '';
    const params: unknown[] = [];
    if (platform) {
        params.push(platform,);
        whereClause = `WHERE platform = $${params.length}`;
    }
    const countResult = await query(`SELECT COUNT(*) FROM social_posts ${whereClause}`, params,);
    const total = parseInt(countResult.rows[0].count, 10,);
    const meta = { page, limit, total, totalPages: Math.ceil(total / limit,), };

    const out: SocialListResult = { data: posts, meta, };
    await cache.set(cacheKey, out, 600,);
    return out;
}

/** Stored posts for one platform, with optional search + sort. Search
 *  results bypass the cache (they are query-specific). */
export async function listPlatformPosts(opts: {
    platform: SocialPlatform;
    page: number;
    limit: number;
    search?: string;
    sort?: string;
    sortDir?: string;
},): Promise<SocialListResult> {
    const { platform, page, limit, search, sort = 'date', sortDir = 'desc', } = opts;
    const offset = (page - 1) * limit;

    const conditions: string[] = ['platform = $1',];
    const params: unknown[] = [platform,];

    if (search && search.trim()) {
        params.push(`%${search.trim()}%`,);
        conditions.push(`(content ILIKE $${params.length} OR author_name ILIKE $${params.length})`,);
    }
    const where = `WHERE ${conditions.join(' AND ',)}`;

    const dir = sortDir.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    let orderBy: string;
    switch (sort) {
        case 'likes': orderBy = `likes ${dir} NULLS LAST`; break;
        case 'comments': orderBy = `comments ${dir} NULLS LAST`; break;
        case 'date':
        default: orderBy = `published_at ${dir} NULLS LAST`; break;
    }

    // Skip cache when search is active (results are query-specific).
    const cacheKey = search ? null : `social:${platform}:${page}:${limit}:${sort}:${sortDir}`;
    if (cacheKey) {
        const cached = await cache.get<SocialListResult>(cacheKey,);
        if (cached) return cached;
    }

    const countResult = await query(`SELECT COUNT(*) FROM social_posts ${where}`, params,);
    const total = parseInt(countResult.rows[0].count, 10,);

    params.push(limit, offset,);
    const result = await query(
        `SELECT * FROM social_posts ${where} ORDER BY ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );
    const posts = mapRows<SocialPost>(result.rows,);
    const meta = { page, limit, total, totalPages: Math.ceil(total / limit,), };

    const out: SocialListResult = { data: posts, meta, };
    if (cacheKey) await cache.set(cacheKey, out, 600,);
    return out;
}

// ─── Live provider feeds (delegated to the platform-fetcher service) ──

export function liveFeeds(limit = 10,): Promise<SocialPost[]> {
    return getLiveFeeds(limit,);
}

export function liveFeed(platform: SocialPlatform, limit = 10,): Promise<SocialPost[]> {
    return getLiveFeed(platform, limit,);
}

// ─── Homepage selection ───────────────────────────────────────────

/** Posts selected for the homepage; falls back to the latest per
 *  platform when none are configured. Cached 300s. */
export async function homepagePosts(): Promise<SocialPost[]> {
    const cacheKey = 'social:homepage';
    const cached = await cache.get<SocialPost[]>(cacheKey,);
    if (cached) return cached;

    const settingsResult = await query(
        `SELECT value FROM site_settings WHERE key = 'homepage_social_posts'`,
    );

    let selectedPosts: SocialPost[] = [];
    if (settingsResult.rows.length > 0) {
        const settings = settingsResult.rows[0].value;
        const postIds = settings.postIds || [];
        if (postIds.length > 0) {
            const postsResult = await query(
                `SELECT * FROM social_posts WHERE id = ANY($1) ORDER BY published_at DESC`,
                [postIds,],
            );
            selectedPosts = mapRows<SocialPost>(postsResult.rows,);
        }
    }

    if (selectedPosts.length === 0) {
        const latestResult = await query(
            `SELECT DISTINCT ON (platform) * FROM social_posts
         ORDER BY platform, published_at DESC
         LIMIT 6`,
        );
        selectedPosts = mapRows<SocialPost>(latestResult.rows,);
    }

    await cache.set(cacheKey, selectedPosts, 300,);
    return selectedPosts;
}

export async function setHomepagePosts(postIds: string[], userId?: string,): Promise<void> {
    await query(
        `INSERT INTO site_settings (key, value, updated_by)
       VALUES ('homepage_social_posts', $1, $2)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
        // updated_by is a UUID FK; synthetic actors (api-key:<name>) become NULL.
        [JSON.stringify({ postIds, },), uuidOrNull(userId,),],
    );
    await cache.del('social:homepage',);
}

// ─── Admin mutations ──────────────────────────────────────────────

/** Manual admin sync (always forces regardless of auto_publish). */
export async function sync(platform?: SocialPlatform,): Promise<Record<string, number>> {
    let results: Record<string, number>;
    if (platform) {
        const count = await syncSocialPosts(platform, true,);
        results = { [platform]: count, };
    } else {
        results = await syncAllPlatforms(true,);
    }
    await cache.delPattern('social:*',);
    return results;
}

/** Delete a stored social post. Returns false when the row is missing. */
export async function deletePost(id: string,): Promise<boolean> {
    const result = await query(
        'DELETE FROM social_posts WHERE id = $1 RETURNING id',
        [id,],
    );
    if (result.rows.length === 0) return false;
    await cache.delPattern('social:*',);
    return true;
}
