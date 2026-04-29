import type { SocialPlatform, SocialPost, } from '@rw/shared';
import { Router, } from 'express';
import { z, } from 'zod';
import { query, } from '../db';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { cache, } from '../services/cache';
import { getLiveFeed, getLiveFeeds, getSocialPosts, syncAllPlatforms, syncSocialPosts, } from '../services/social';
import { mapRows, } from '../utils/mapRow';
import { handleRouteError, sendSuccess, } from '../utils/response';

const router = Router();

// Get social posts (public - for homepage and widgets)
router.get('/posts', async (req, res,) => {
    try {
        const { platform, page = 1, limit = 20, } = req.query;
        const pageNum = Number(page,);
        const limitNum = Number(limit,);
        const offset = (pageNum - 1) * limitNum;

        const cacheKey = `social:posts:${platform || 'all'}:${pageNum}:${limitNum}`;

        const cached = await cache.get(cacheKey,);
        if (cached) {
            // Cached shape is { data, meta } — send directly
            return res.json({ success: true, ...(cached as object), },);
        }

        const posts = await getSocialPosts(
            platform as SocialPlatform | undefined,
            limitNum,
            offset,
        );

        let whereClause = '';
        const params: unknown[] = [];
        if (platform) {
            params.push(platform,);
            whereClause = `WHERE platform = $${params.length}`;
        }

        const countResult = await query(`SELECT COUNT(*) FROM social_posts ${whereClause}`, params,);
        const total = parseInt(countResult.rows[0].count, 10,);
        const meta = { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum,), };

        await cache.set(cacheKey, { data: posts, meta, }, 600,);
        sendSuccess(res, posts, meta,);
    } catch (error) {
        handleRouteError(res, error, 'fetch social posts',);
    }
},);

// Get specific platform posts (public)
// Supports: ?page=1&limit=10&search=term&sort=date&sortDir=desc
router.get('/posts/:platform', async (req, res,) => {
    try {
        const { platform, } = req.params;
        const {
            page = 1,
            limit = 10,
            search,
            sort = 'date',
            sortDir = 'desc',
        } = req.query;
        const pageNum = Number(page,);
        const limitNum = Math.min(Number(limit,), 50,);
        const offset = (pageNum - 1) * limitNum;

        const validPlatforms: SocialPlatform[] = ['patreon', 'youtube', 'instagram', 'facebook', 'twitter', 'tiktok',];

        if (!validPlatforms.includes(platform as SocialPlatform,)) {
            return res.status(400,).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Invalid platform', },
            },);
        }

        // Build query with optional search
        const conditions: string[] = ['platform = $1'];
        const params: unknown[] = [platform,];

        if (search && typeof search === 'string' && search.trim()) {
            params.push(`%${search.trim()}%`,);
            conditions.push(`(content ILIKE $${params.length} OR author_name ILIKE $${params.length})`,);
        }

        const where = `WHERE ${conditions.join(' AND ')}`;

        // Sort
        const dir = String(sortDir,).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        let orderBy: string;
        switch (String(sort,)) {
            case 'likes':
                orderBy = `likes ${dir} NULLS LAST`;
                break;
            case 'comments':
                orderBy = `comments ${dir} NULLS LAST`;
                break;
            case 'date':
            default:
                orderBy = `published_at ${dir} NULLS LAST`;
                break;
        }

        // Skip Redis cache when search is active (results are user-specific)
        const cacheKey = search ? null : `social:${platform}:${pageNum}:${limitNum}:${sort}:${sortDir}`;
        if (cacheKey) {
            const cached = await cache.get(cacheKey,);
            if (cached) return res.json({ success: true, ...(cached as object), },);
        }

        const countResult = await query(`SELECT COUNT(*) FROM social_posts ${where}`, params,);
        const total = parseInt(countResult.rows[0].count, 10,);

        params.push(limitNum, offset,);
        const result = await query(
            `SELECT * FROM social_posts ${where} ORDER BY ${orderBy} LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params,
        );

        const posts = mapRows(result.rows,);

        const meta = {
            page: pageNum,
            limit: limitNum,
            total,
            totalPages: Math.ceil(total / limitNum,),
        };

        if (cacheKey) {
            await cache.set(cacheKey, { data: posts, meta, }, 600,);
        }

        sendSuccess(res, posts, meta,);
    } catch (error) {
        handleRouteError(res, error, 'fetch platform posts',);
    }
},);

// Sync social posts (admin)
router.post('/sync', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { platform, } = req.body;

        let results;

        if (platform) {
            // Manual admin sync always forces regardless of auto_publish setting
            const count = await syncSocialPosts(platform as SocialPlatform, true,);
            results = { [platform]: count, };
        } else {
            results = await syncAllPlatforms(true,);
        }

        // Invalidate cache
        await cache.delPattern('social:*',);

        sendSuccess(res, {
            message: 'Sync completed',
            results,
        },);
    } catch (error) {
        handleRouteError(res, error, 'sync social posts',);
    }
},);

// ─── Live Feed (cached API fetch, no DB) ───

// Get live feed from all connected providers (public - for homepage)
router.get('/feed', async (req, res,) => {
    try {
        const limit = Math.min(Number(req.query.limit,) || 10, 50,);
        const posts = await getLiveFeeds(limit,);
        sendSuccess(res, posts,);
    } catch (error) {
        handleRouteError(res, error, 'fetch live social feeds',);
    }
},);

// Get live feed from a specific platform (public + admin picker)
router.get('/feed/:platform', async (req, res,) => {
    try {
        const { platform, } = req.params;
        const validPlatforms: SocialPlatform[] = ['patreon', 'youtube', 'instagram', 'facebook', 'twitter', 'tiktok',];

        if (!validPlatforms.includes(platform as SocialPlatform,)) {
            return res.status(400,).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Invalid platform', },
            },);
        }

        const limit = Math.min(Number(req.query.limit,) || 10, 50,);
        const posts = await getLiveFeed(platform as SocialPlatform, limit,);
        sendSuccess(res, posts,);
    } catch (error) {
        handleRouteError(res, error, 'fetch live social feed',);
    }
},);

// Get selected posts for homepage (admin can configure)
router.get('/homepage', async (_req, res,) => {
    try {
        const cacheKey = 'social:homepage';

        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        // Get homepage block settings to see which posts are selected
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

        // If no selected posts, get latest from each platform
        if (selectedPosts.length === 0) {
            const latestResult = await query(
                `SELECT DISTINCT ON (platform) * FROM social_posts
         ORDER BY platform, published_at DESC
         LIMIT 6`,
            );

            selectedPosts = mapRows<SocialPost>(latestResult.rows,);
        }

        await cache.set(cacheKey, selectedPosts, 300,);

        sendSuccess(res, selectedPosts,);
    } catch (error) {
        handleRouteError(res, error, 'fetch homepage social posts',);
    }
},);

// Update homepage social posts selection (admin)
router.put('/homepage', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { postIds, } = z.object({
            postIds: z.array(z.string().uuid(),),
        },).parse(req.body,);

        await query(
            `INSERT INTO site_settings (key, value, updated_by)
       VALUES ('homepage_social_posts', $1, $2)
       ON CONFLICT (key) DO UPDATE SET
         value = EXCLUDED.value,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
            [JSON.stringify({ postIds, },), req.userId,],
        );

        await cache.del('social:homepage',);

        sendSuccess(res, { message: 'Homepage posts updated', },);
    } catch (error) {
        handleRouteError(res, error, 'update homepage posts',);
    }
},);

// Delete social post (admin)
router.delete('/posts/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { id, } = req.params;

        const result = await query(
            'DELETE FROM social_posts WHERE id = $1 RETURNING id',
            [id,],
        );

        if (result.rows.length === 0) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Social post not found', },
            },);
        }

        await cache.delPattern('social:*',);

        sendSuccess(res, { message: 'Post deleted', },);
    } catch (error) {
        handleRouteError(res, error, 'delete social post',);
    }
},);

export default router;
