import { Router, } from 'express';
import { z, } from 'zod';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { checkContentAccess, ContentAccessLevel, } from '../middleware/content-access';
import { ValidationError, } from '../middleware/error';
import * as postsRepo from '../repositories/posts.repo';
import * as revisionsRepo from '../repositories/revisions.repo';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import { handleBulkAction, } from '../utils/bulkActions';
import { handleRouteError, sendCreated, sendPaginated, sendSuccess, } from '../utils/response';

const router = Router();

const contentBlockSchema = z.object({
    id: z.string().optional(),
    type: z.enum(['text', 'social_media', 'image', 'video', 'document', 'url_link',],),
    sort_order: z.number().int().min(0,),
    data: z.record(z.unknown(),).default({},),
},);

const postSchema = z.object({
    slug: z.string().min(1,).max(255,).regex(/^[a-z0-9-]+$/,),
    title: z.string().min(1,).max(255,),
    excerpt: z.string().optional(),
    content: z.string().optional().default('',),
    featuredImage: z.string().url().optional(),
    status: z.enum(['draft', 'published', 'scheduled', 'archived', 'deleted',],).optional(),
    publishAt: z.string().datetime().nullable().optional(),
    isPrivate: z.boolean().optional(),
    accessLevel: z.enum(['public', 'member', 'patron',],).optional(),
    tags: z.array(z.string(),).optional(),
    categories: z.array(z.string(),).optional(),
    metaTitle: z.string().max(255,).optional(),
    metaDescription: z.string().optional(),
    publishedAt: z.string().datetime().optional(),
    contentBlocks: z.array(contentBlockSchema,).optional(),
},);

// ─── Public Routes ───

router.get('/public', authenticate(false,), async (req: AuthenticatedRequest, res,) => {
    try {
        const { page = 1, limit = 10, tag, category, search, } = req.query;
        const pagination = { page: Number(page,), limit: Number(limit,), };
        const cacheKey = `posts:public:${page}:${limit}:${tag || ''}:${category || ''}:${search || ''}`;

        if (!req.user) {
            const cached = await cache.get(cacheKey,);
            if (cached) return res.json({ success: true, ...cached, },);
        }

        const result = await postsRepo.findPublicPosts(
            { tag: tag as string, category: category as string, search: search as string, },
            pagination,
        );

        const response = {
            data: result.data,
            meta: {
                page: pagination.page,
                limit: pagination.limit,
                total: result.total,
                totalPages: Math.ceil(result.total / pagination.limit,),
            },
        };

        if (!req.user) {
            await cache.set(cacheKey, response, 300,);
        }

        res.json({ success: true, ...response, },);
    } catch (error) {
        handleRouteError(res, error, 'fetch posts',);
    }
},);

router.get('/slug/:slug', authenticate(false,), async (req: AuthenticatedRequest, res,) => {
    try {
        const { slug, } = req.params;
        const cacheKey = `post:slug:${slug}`;
        const isAdminPreview = req.query.preview === 'admin' && req.user?.role === 'admin';

        if (!req.user) {
            const cached = await cache.get(cacheKey,);
            if (cached) return sendSuccess(res, cached,);
        }

        const post = isAdminPreview ?
            await postsRepo.findPostBySlugAnyStatus(slug,) :
            await postsRepo.findPostBySlug(slug,);
        if (!post) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Post not found', },
            },);
        }

        if (post.isPrivate && !req.user) {
            return res.status(401,).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Authentication required', },
            },);
        }

        // Content access level check
        const accessLevel = (post.accessLevel || 'public') as ContentAccessLevel;
        if (accessLevel !== 'public') {
            const accessCheck = await checkContentAccess(accessLevel, req.user,);
            if (!accessCheck.allowed) {
                return res.status(403,).json({
                    success: false,
                    locked: true,
                    accessLevel,
                    preview: {
                        title: post.title,
                        description: post.excerpt || post.metaDescription || null,
                        featuredImage: post.featuredImage || null,
                    },
                    error: { code: 'CONTENT_LOCKED', message: accessCheck.reason || 'Access denied', },
                },);
            }
        }

        if (!post.isPrivate && accessLevel === 'public') {
            await cache.set(cacheKey, post, 300,);
        }

        sendSuccess(res, post,);
    } catch (error) {
        handleRouteError(res, error, 'fetch post',);
    }
},);

router.get('/search', authenticate(false,), async (req: AuthenticatedRequest, res,) => {
    try {
        const { q, page = 1, limit = 10, } = req.query;
        if (!q || typeof q !== 'string') {
            throw new ValidationError('Search query is required',);
        }

        const pagination = { page: Number(page,), limit: Number(limit,), };
        const result = await postsRepo.searchPosts(q, pagination,);
        sendPaginated(res, result.data, pagination.page, pagination.limit, result.total,);
    } catch (error) {
        handleRouteError(res, error, 'search posts',);
    }
},);

// ─── Admin Routes ───

router.get('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { status, search, sort, page = 1, limit = 20, } = req.query;
        const pagination = { page: Number(page,), limit: Number(limit,), };

        const result = await postsRepo.findAllPosts(
            { status: status as string, search: search as string, sort: sort as string, },
            pagination,
        );

        sendPaginated(res, result.data, pagination.page, pagination.limit, result.total,);
    } catch (error) {
        handleRouteError(res, error, 'fetch posts',);
    }
},);

router.get('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const post = await postsRepo.findPostById(req.params.id,);
        sendSuccess(res, post,);
    } catch (error) {
        handleRouteError(res, error, 'fetch post',);
    }
},);

router.post('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = postSchema.parse(req.body,);
        const post = await postsRepo.createPost(data, req.userId!,);
        await cache.invalidatePostCache();
        await logAudit({
            userId: req.userId!,
            action: 'create',
            entityType: 'post',
            entityId: post.id,
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendCreated(res, post,);
    } catch (error) {
        handleRouteError(res, error, 'create post',);
    }
},);

router.put('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = postSchema.partial().parse(req.body,);
        // Snapshot existing state BEFORE update for revision history
        try {
            const existing = await postsRepo.findPostById(req.params.id,);
            await revisionsRepo.createRevision('post', req.params.id, existing as any, req.userId || null,);
            await revisionsRepo.pruneRevisions('post', req.params.id, 50,);
        } catch {
            // Don't fail the save if revision snapshot fails
        }
        const post = await postsRepo.updatePost(req.params.id, data,);
        await cache.invalidatePostCache(req.params.id,);
        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'post',
            entityId: req.params.id,
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, post,);
    } catch (error) {
        handleRouteError(res, error, 'update post',);
    }
},);

router.delete('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        await postsRepo.deletePost(req.params.id,);
        await cache.invalidatePostCache(req.params.id,);
        await logAudit({
            userId: req.userId!,
            action: 'delete',
            entityType: 'post',
            entityId: req.params.id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, { message: 'Post deleted', },);
    } catch (error) {
        handleRouteError(res, error, 'delete post',);
    }
},);

// ─── Revisions ───

router.get('/:id/revisions', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const revisions = await revisionsRepo.listRevisions('post', req.params.id,);
        sendSuccess(res, revisions,);
    } catch (error) {
        handleRouteError(res, error, 'list post revisions',);
    }
},);

router.get('/:id/revisions/:version', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const version = parseInt(req.params.version, 10,);
        const revision = await revisionsRepo.getRevision('post', req.params.id, version,);
        sendSuccess(res, revision,);
    } catch (error) {
        handleRouteError(res, error, 'get post revision',);
    }
},);

router.post(
    '/:id/revisions/:version/restore',
    authenticate(),
    requireAdmin,
    async (req: AuthenticatedRequest, res,) => {
        try {
            const version = parseInt(req.params.version, 10,);
            const revision = await revisionsRepo.getRevision('post', req.params.id, version,);
            const snap = revision.snapshot as any;
            // Snapshot current state before restore
            const current = await postsRepo.findPostById(req.params.id,);
            await revisionsRepo.createRevision(
                'post',
                req.params.id,
                current as any,
                req.userId || null,
                `Pre-restore snapshot (restoring v${version})`,
            );
            const restored = await postsRepo.updatePost(req.params.id, {
                title: snap.title,
                slug: snap.slug,
                excerpt: snap.excerpt,
                content: snap.content,
                status: snap.status,
                accessLevel: snap.accessLevel,
                tags: snap.tags,
                contentBlocks: snap.contentBlocks,
                publishAt: snap.publishAt,
            },);
            await cache.invalidatePostCache(req.params.id,);
            sendSuccess(res, restored,);
        } catch (error) {
            handleRouteError(res, error, 'restore post revision',);
        }
    },
);

// ─── Bulk Actions ───

router.post('/bulk', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    await handleBulkAction(res, req.body, {
        table: 'posts',
        allowedStatuses: ['draft', 'published', 'scheduled', 'archived', 'deleted',],
        softDelete: true,
        onInvalidate: () => cache.invalidatePostCache(),
    },);
},);

// ─── Content Block Reorder (9.4 from TODO) ───

router.put('/:postId/blocks/reorder', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { blockIds, } = req.body;
        if (!Array.isArray(blockIds,)) throw new ValidationError('blockIds must be an array',);

        await postsRepo.reorderContentBlocks(req.params.postId, blockIds,);
        await cache.invalidatePostCache(req.params.postId,);
        sendSuccess(res, { message: 'Blocks reordered', },);
    } catch (error) {
        handleRouteError(res, error, 'reorder blocks',);
    }
},);

export default router;
