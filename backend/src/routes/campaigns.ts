import { Router, } from 'express';
import { z, } from 'zod';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import * as campaignsRepo from '../repositories/campaigns.repo';
import { logAudit, } from '../services/audit';
import { cache, } from '../services/cache';
import { handleBulkAction, } from '../utils/bulkActions';
import { handleRouteError, sendCreated, sendPaginated, sendSuccess, } from '../utils/response';

const router = Router();

const campaignSchema = z.object({
    title: z.string().min(1,).max(255,),
    slug: z.string().min(1,).max(255,).regex(/^[a-z0-9-]+$/,),
    description: z.string(),
    shortDescription: z.string().optional(),
    featuredImage: z.string().url().nullish(),
    goalAmountCents: z.number().int().positive().nullish(),
    status: z.enum(['draft', 'active', 'completed', 'cancelled',],).optional(),
    startDate: z.string().datetime().nullish(),
    endDate: z.string().datetime().nullish(),
    isPublished: z.boolean().optional(),
},);

// ─── Public Routes ───

router.get('/public', async (req, res,) => {
    try {
        const {
            includePast = 'false',
            activeOnly = 'true',
            sortBy = 'created_at',
            sortOrder = 'desc',
        } = req.query;

        const cacheKey = `campaigns:public:${includePast}:${activeOnly}:${sortBy}:${sortOrder}`;

        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const campaigns = await campaignsRepo.findPublicCampaigns({
            includePast: includePast === 'true',
            activeOnly: activeOnly !== 'false',
            sortBy: String(sortBy,),
            sortOrder: String(sortOrder,),
        },);
        await cache.set(cacheKey, campaigns, 300,);
        sendSuccess(res, campaigns,);
    } catch (error) {
        handleRouteError(res, error, 'fetch campaigns',);
    }
},);

router.get('/slug/:slug', async (req, res,) => {
    try {
        const { slug, } = req.params;
        const cacheKey = `campaign:slug:${slug}`;

        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const campaign = await campaignsRepo.findCampaignBySlug(slug,);
        if (!campaign) {
            return res.status(404,).json({
                success: false,
                error: { code: 'NOT_FOUND', message: 'Campaign not found', },
            },);
        }

        await cache.set(cacheKey, campaign, 300,);
        sendSuccess(res, campaign,);
    } catch (error) {
        handleRouteError(res, error, 'fetch campaign',);
    }
},);

router.get('/:id/donations', async (req, res,) => {
    try {
        const { page = 1, limit = 20, } = req.query;
        const pagination = { page: Number(page,), limit: Number(limit,), };
        const result = await campaignsRepo.findCampaignDonations(req.params.id, pagination,);
        sendPaginated(res, result.data, pagination.page, pagination.limit, result.total,);
    } catch (error) {
        handleRouteError(res, error, 'fetch donations',);
    }
},);

// ─── Admin Routes ───

router.get('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { status, page = 1, limit = 20, } = req.query;
        const pagination = { page: Number(page,), limit: Number(limit,), };
        const result = await campaignsRepo.findAllCampaigns(
            { status: status as string, },
            pagination,
        );
        sendPaginated(res, result.data, pagination.page, pagination.limit, result.total,);
    } catch (error) {
        handleRouteError(res, error, 'fetch campaigns',);
    }
},);

router.get('/donations/summary', authenticate(), requireAdmin, async (_req: AuthenticatedRequest, res,) => {
    try {
        const cacheKey = 'donations:summary';
        const cached = await cache.get(cacheKey,);
        if (cached) return sendSuccess(res, cached,);

        const summary = await campaignsRepo.getDonationSummary();
        await cache.set(cacheKey, summary, 300,);
        sendSuccess(res, summary,);
    } catch (error) {
        handleRouteError(res, error, 'fetch donation summary',);
    }
},);

router.get('/donations/all', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const { campaignId, status, page = 1, limit = 50, } = req.query;
        const pagination = { page: Number(page,), limit: Number(limit,), };
        const result = await campaignsRepo.findAllDonations(
            { campaignId: campaignId as string, status: status as string, },
            pagination,
        );
        sendPaginated(res, result.data, pagination.page, pagination.limit, result.total,);
    } catch (error) {
        handleRouteError(res, error, 'fetch donations',);
    }
},);

router.get('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const campaign = await campaignsRepo.findCampaignById(req.params.id,);
        sendSuccess(res, campaign,);
    } catch (error) {
        handleRouteError(res, error, 'fetch campaign',);
    }
},);

router.post('/', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = campaignSchema.parse(req.body,);
        const campaign = await campaignsRepo.createCampaign(data, req.userId!,);
        await cache.invalidateCampaignCache();
        await logAudit({
            userId: req.userId!,
            action: 'create',
            entityType: 'campaign',
            entityId: campaign.id,
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendCreated(res, campaign,);
    } catch (error) {
        handleRouteError(res, error, 'create campaign',);
    }
},);

router.put('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        const data = campaignSchema.partial().parse(req.body,);
        const campaign = await campaignsRepo.updateCampaign(req.params.id, data,);
        await cache.invalidateCampaignCache(req.params.id,);
        await logAudit({
            userId: req.userId!,
            action: 'update',
            entityType: 'campaign',
            entityId: req.params.id,
            newValues: data,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, campaign,);
    } catch (error) {
        handleRouteError(res, error, 'update campaign',);
    }
},);

router.delete('/:id', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    try {
        await campaignsRepo.deleteCampaign(req.params.id,);
        await cache.invalidateCampaignCache(req.params.id,);
        await logAudit({
            userId: req.userId!,
            action: 'delete',
            entityType: 'campaign',
            entityId: req.params.id,
            ipAddress: req.ip,
            userAgent: req.get('user-agent',),
        },);
        sendSuccess(res, { message: 'Campaign deleted', },);
    } catch (error) {
        handleRouteError(res, error, 'delete campaign',);
    }
},);

// ─── Bulk Actions ───

router.post('/bulk', authenticate(), requireAdmin, async (req: AuthenticatedRequest, res,) => {
    await handleBulkAction(res, req.body, {
        table: 'campaigns',
        allowedStatuses: ['draft', 'active', 'completed', 'cancelled',],
        softDelete: false,
        onInvalidate: () => cache.invalidateCampaignCache(),
    },);
},);

export default router;
