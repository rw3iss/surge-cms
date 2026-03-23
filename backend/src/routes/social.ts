import type { SocialPlatform, SocialPost, } from '@surge/shared';
import { Router, } from 'express';
import { z, } from 'zod';
import { query, } from '../db';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { cache, } from '../services/cache';
import { getSocialPosts, syncAllPlatforms, syncSocialPosts, } from '../services/social';
import { mapRows, } from '../utils/mapRow';
import { handleRouteError, sendSuccess, } from '../utils/response';

const router = Router();

// Get social posts (public - for homepage and widgets)
router.get('/posts', async (req, res,) => {
    try {
        const { platform, page = 1, limit = 20, } = req.query;
        const offset = (Number(page,) - 1) * Number(limit,);

        const cacheKey = `social:posts:${platform || 'all'}:${page}:${limit}`;

        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const posts = await getSocialPosts(
            platform as SocialPlatform | undefined,
            Number(limit,),
            offset,
        );

        // Get total count
        let whereClause = '';
        const params: unknown[] = [];
        if (platform) {
            params.push(platform,);
            whereClause = `WHERE platform = $${params.length}`;
        }

        const countResult = await query(`SELECT COUNT(*) FROM social_posts ${whereClause}`, params,);
        const total = parseInt(countResult.rows[0].count, 10,);

        const response = {
            data: posts,
            meta: {
                page: Number(page,),
                limit: Number(limit,),
                total,
                totalPages: Math.ceil(total / Number(limit,),),
            },
        };

        await cache.set(cacheKey, response, 600,);

        sendSuccess(res, posts, {
            page: Number(page,),
            limit: Number(limit,),
            total,
            totalPages: Math.ceil(total / Number(limit,),),
        },);
    } catch (error) {
        handleRouteError(res, error, 'fetch social posts',);
    }
},);

// Get specific platform posts (public)
router.get('/posts/:platform', async (req, res,) => {
    try {
        const { platform, } = req.params;
        const { page = 1, limit = 10, } = req.query;
        const offset = (Number(page,) - 1) * Number(limit,);

        const validPlatforms: SocialPlatform[] = ['patreon', 'youtube', 'instagram', 'facebook', 'twitter', 'tiktok',];

        if (!validPlatforms.includes(platform as SocialPlatform,)) {
            return res.status(400,).json({
                success: false,
                error: { code: 'BAD_REQUEST', message: 'Invalid platform', },
            },);
        }

        const cacheKey = `social:${platform}:${page}:${limit}`;

        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const posts = await getSocialPosts(platform as SocialPlatform, Number(limit,), offset,);

        const countResult = await query(
            'SELECT COUNT(*) FROM social_posts WHERE platform = $1',
            [platform,],
        );
        const total = parseInt(countResult.rows[0].count, 10,);

        const response = {
            data: posts,
            meta: {
                page: Number(page,),
                limit: Number(limit,),
                total,
                totalPages: Math.ceil(total / Number(limit,),),
            },
        };

        await cache.set(cacheKey, response, 600,);

        sendSuccess(res, posts, {
            page: Number(page,),
            limit: Number(limit,),
            total,
            totalPages: Math.ceil(total / Number(limit,),),
        },);
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
            const count = await syncSocialPosts(platform as SocialPlatform,);
            results = { [platform]: count, };
        } else {
            results = await syncAllPlatforms();
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
