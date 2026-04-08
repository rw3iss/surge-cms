import type { Page, } from '@surge/shared';
import { Router, } from 'express';
import { z, } from 'zod';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { checkContentAccess, ContentAccessLevel, } from '../middleware/content-access';
import { ValidationError, } from '../middleware/error';
import * as pagesRepo from '../repositories/pages.repo';
import * as revisionsRepo from '../repositories/revisions.repo';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import { handleBulkAction, } from '../utils/bulkActions';
import { handleRouteError, sendCreated, sendPaginated, sendSuccess, } from '../utils/response';

const router = Router();

const pageSchema = z.object({
    slug: z.string().min(1,).max(255,).regex(/^[a-z0-9-]+$/,),
    title: z.string().min(1,).max(255,),
    titleAlignment: z.enum(['left', 'center', 'right',],).optional(),
    description: z.string().optional(),
    metaTitle: z.string().max(255,).optional(),
    metaDescription: z.string().optional(),
    metaKeywords: z.array(z.string(),).optional(),
    ogImage: z.string().url().optional(),
    status: z.enum(['draft', 'published', 'scheduled', 'archived', 'deleted',],).optional(),
    publishAt: z.string().datetime().nullable().optional(),
    isHomepage: z.boolean().optional(),
    showInNav: z.boolean().optional(),
    navOrder: z.number().int().optional(),
    isPrivate: z.boolean().optional(),
    accessLevel: z.enum(['public', 'member', 'patron',],).optional(),
},);

const blockSchema = z.object({
    type: z.enum([
        'rich_text',
        'post',
        'form',
        'image',
        'video',
        'gallery',
        'social_feed',
        'campaign',
        'hero',
        'html',
    ],),
    title: z.string().max(255,).optional(),
    content: z.string().optional(),
    settings: z.record(z.unknown(),).optional(),
    order: z.number().int().optional(),
    isVisible: z.boolean().optional(),
    style: z.record(z.unknown(),).nullable().optional(),
},);

// ─── Public Routes ───

router.get('/navigation', async (_req, res,) => {
    try {
        const cacheKey = 'navigation:main';
        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const navigation = await pagesRepo.getNavigation();
        await cache.set(cacheKey, navigation, 600,);
        sendSuccess(res, navigation,);
    } catch (error) {
        handleRouteError(res, error, 'fetch navigation',);
    }
},);

router.get('/slug/:slug', authenticate(false,), async (req: AuthenticatedRequest, res,) => {
    try {
        const { slug, } = req.params;
        const cacheKey = `page:slug:${slug}`;
        const isAdminPreview = req.query.preview === 'admin' && req.user?.role === 'admin';

        if (!req.user) {
            const cached = await cache.get<Page>(cacheKey,);
            if (cached && !cached.isPrivate) return sendSuccess(res, cached,);
        }

        // Admin preview mode: allow viewing draft/archived pages
        const page = isAdminPreview ?
            await pagesRepo.findPageBySlugAnyStatus(slug,) :
            await pagesRepo.findPageBySlug(slug,);
        if (!page) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Page not found', },
            },);
        }

        // Access control - legacy private check
        if (page.isPrivate && !req.user) {
            return res.status(401,).json({
                success: false,
                error: { code: 'UNAUTHORIZED', message: 'Authentication required', },
            },);
        }

        // Content access level check
        const accessLevel = (page.accessLevel || 'public') as ContentAccessLevel;
        if (accessLevel !== 'public') {
            const accessCheck = await checkContentAccess(accessLevel, req.user,);
            if (!accessCheck.allowed) {
                return res.status(403,).json({
                    success: false,
                    locked: true,
                    accessLevel,
                    preview: {
                        title: page.title,
                        description: page.description || page.metaDescription || null,
                        featuredImage: page.ogImage || null,
                    },
                    error: { code: 'CONTENT_LOCKED', message: accessCheck.reason || 'Access denied', },
                },);
            }
        }

        page.blocks = await pagesRepo.findBlocksByPageIdWithStyles(page.id, true,);

        if (!page.isPrivate && accessLevel === 'public') {
            await cache.set(cacheKey, page, 300,);
        }

        sendSuccess(res, page,);
    } catch (error) {
        handleRouteError(res, error, 'fetch page',);
    }
},);

// ─── Admin Routes ───

router.get('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { status, search, sort, page = 1, limit = 20, } = req.query;
        const pagination = { page: Number(page,), limit: Number(limit,), };

        const result = await pagesRepo.findPages(
            { status: status as string, search: search as string, sort: sort as string, },
            pagination,
        );

        sendPaginated(res, result.data, pagination.page, pagination.limit, result.total,);
    } catch (error) {
        handleRouteError(res, error, 'fetch pages',);
    }
},);

router.get('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const page = await pagesRepo.findPageById(req.params.id,);
        page.blocks = await pagesRepo.findBlocksByPageIdWithStyles(page.id,);
        sendSuccess(res, page,);
    } catch (error) {
        handleRouteError(res, error, 'fetch page',);
    }
},);

router.post('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = pageSchema.parse(req.body,);
        const page = await pagesRepo.createPage(data, req.userId!,);
        await cache.invalidatePageCache();
        await logAudit({
            userId: req.userId!,
            action: 'create',
            entityType: 'page',
            entityId: page.id,
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendCreated(res, page,);
    } catch (error) {
        handleRouteError(res, error, 'create page',);
    }
},);

router.put('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = pageSchema.partial().parse(req.body,);
        try {
            const existing = await pagesRepo.findPageById(req.params.id,);
            if (existing) {
                await revisionsRepo.createRevision(
                    'page',
                    req.params.id,
                    existing as any,
                    req.userId || null,
                );
                await revisionsRepo.pruneRevisions('page', req.params.id, 50,);
            }
        } catch {
            /* non-fatal */
        }
        const page = await pagesRepo.updatePage(req.params.id, data,);
        await cache.invalidatePageCache(req.params.id,);
        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'page',
            entityId: req.params.id,
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, page,);
    } catch (error) {
        handleRouteError(res, error, 'update page',);
    }
},);

router.delete('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        await pagesRepo.deletePage(req.params.id,);
        await cache.invalidatePageCache(req.params.id,);
        await logAudit({
            userId: req.userId!,
            action: 'delete',
            entityType: 'page',
            entityId: req.params.id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, { message: 'Page deleted', },);
    } catch (error) {
        handleRouteError(res, error, 'delete page',);
    }
},);

// ─── Revisions ───

router.get('/:id/revisions', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const revisions = await revisionsRepo.listRevisions('page', req.params.id,);
        sendSuccess(res, revisions,);
    } catch (error) {
        handleRouteError(res, error, 'list page revisions',);
    }
},);

router.get('/:id/revisions/:version', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const version = parseInt(req.params.version, 10,);
        const revision = await revisionsRepo.getRevision('page', req.params.id, version,);
        sendSuccess(res, revision,);
    } catch (error) {
        handleRouteError(res, error, 'get page revision',);
    }
},);

router.post(
    '/:id/revisions/:version/restore',
    authenticate(),
    requireAdmin,
    async (req: AuthenticatedRequest, res,) => {
        try {
            const version = parseInt(req.params.version, 10,);
            const revision = await revisionsRepo.getRevision('page', req.params.id, version,);
            const snap = revision.snapshot as any;
            const current = await pagesRepo.findPageById(req.params.id,);
            if (current) {
                await revisionsRepo.createRevision(
                    'page',
                    req.params.id,
                    current as any,
                    req.userId || null,
                    `Pre-restore snapshot (restoring v${version})`,
                );
            }
            const restored = await pagesRepo.updatePage(req.params.id, {
                title: snap.title,
                slug: snap.slug,
                description: snap.description,
                status: snap.status,
                accessLevel: snap.accessLevel,
                publishAt: snap.publishAt,
            },);
            await cache.invalidatePageCache(req.params.id,);
            sendSuccess(res, restored,);
        } catch (error) {
            handleRouteError(res, error, 'restore page revision',);
        }
    },
);

// ─── Bulk Actions ───

router.post('/bulk', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    await handleBulkAction(res, req.body, {
        table: 'pages',
        allowedStatuses: ['draft', 'published', 'scheduled', 'archived', 'deleted',],
        softDelete: true,
        onInvalidate: () => cache.invalidatePageCache(),
    },);
},);

// ─── Block Routes ───

router.post('/:pageId/blocks', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = blockSchema.parse(req.body,);
        const block = await pagesRepo.createBlock(req.params.pageId, data,);
        await cache.invalidatePageCache(req.params.pageId,);
        sendCreated(res, block,);
    } catch (error) {
        handleRouteError(res, error, 'create block',);
    }
},);

router.put('/:pageId/blocks/:blockId', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = blockSchema.partial().parse(req.body,);
        const block = await pagesRepo.updateBlock(req.params.pageId, req.params.blockId, data,);
        await cache.invalidatePageCache(req.params.pageId,);
        sendSuccess(res, block,);
    } catch (error) {
        handleRouteError(res, error, 'update block',);
    }
},);

router.delete('/:pageId/blocks/:blockId', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        await pagesRepo.deleteBlock(req.params.pageId, req.params.blockId,);
        await cache.invalidatePageCache(req.params.pageId,);
        sendSuccess(res, { message: 'Block deleted', },);
    } catch (error) {
        handleRouteError(res, error, 'delete block',);
    }
},);

router.put('/:pageId/blocks/reorder', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { blockIds, } = req.body;
        if (!Array.isArray(blockIds,)) throw new ValidationError('blockIds must be an array',);

        await pagesRepo.reorderBlocks(req.params.pageId, blockIds,);
        await cache.invalidatePageCache(req.params.pageId,);
        sendSuccess(res, { message: 'Blocks reordered', },);
    } catch (error) {
        handleRouteError(res, error, 'reorder blocks',);
    }
},);

export default router;
