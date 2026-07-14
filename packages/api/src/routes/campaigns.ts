import { z, } from 'zod';
import type {
    AssertCompatible,
    CampaignAllDonationsQuery,
    CampaignCreateBody,
    CampaignDonationsQuery,
    CampaignListQuery,
} from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import { isAdminRole, } from '../api/roles';
import { NotFoundError, } from '../core/errors';
import * as campaigns from '../services/campaigns';

// ─── Schemas ──────────────────────────────────────────────────────

const campaignSchema = z.object({
    title: z.string().min(1,).max(255,),
    slug: z.string().min(1,).max(255,).regex(/^[a-z0-9-]+$/,),
    description: z.string(),
    shortDescription: z.string().optional(),
    featuredImage: z.string().url().nullish(),
    goalAmountCents: z.number().int().positive().nullish(),
    showRaisedAmount: z.boolean().optional(),
    status: z.enum(['draft', 'active', 'completed', 'cancelled',],).optional(),
    startDate: z.string().datetime().nullish(),
    endDate: z.string().datetime().nullish(),
    isPublished: z.boolean().optional(),
},) satisfies z.ZodType<CampaignCreateBody>;

const listQuery = z.object({
    // Public params
    includePast: z.string().optional(),
    activeOnly: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.string().optional(),
    // Admin trigger + filters
    all: z.string().optional(),
    status: z.string().optional(),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(20,),
},);

const donationsQuery = z.object({
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(20,),
},);

const allDonationsQuery = z.object({
    campaignId: z.string().optional(),
    status: z.string().optional(),
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(50,),
},);

const idParams = z.object({ id: z.string(), },);

// Query schemas coerce (string → number), so assert z.infer compatibility.
type _AssertCampaignListQuery = AssertCompatible<z.infer<typeof listQuery>, CampaignListQuery>;
type _AssertCampaignDonationsQuery = AssertCompatible<z.infer<typeof donationsQuery>, CampaignDonationsQuery>;
type _AssertCampaignAllDonationsQuery = AssertCompatible<z.infer<typeof allDonationsQuery>, CampaignAllDonationsQuery>;

// ─── Routes ───────────────────────────────────────────────────────
// Literal paths (/slug/:slug, /donations/summary, /donations/all,
// /bulk) and /:id/donations declared before the /:id catch-all.

export const campaignsRoutes = [

    // List campaigns. Public published-only array by default; admins
    // passing all=true (or status) get the paginated all-statuses list.
    defineRoute({
        method: 'get', path: '/', auth: 'optional',
        summary: 'List campaigns. Public published-only by default; admins passing all=true/status get the paginated admin list.',
        input: { query: listQuery, },
        handler: async ({ user, apiKey, query, },) => {
            const isAdmin = isAdminRole(user?.role,) || Boolean(apiKey,);

            if (isAdmin && (query.all === 'true' || query.status !== undefined)) {
                const result = await campaigns.list(
                    { status: query.status, sortBy: query.sortBy, sortOrder: query.sortOrder, },
                    { page: query.page, limit: query.limit, },
                );
                return reply(result.data, { meta: result.meta, },);
            }

            return campaigns.listPublicCached({
                includePast: query.includePast === 'true',
                activeOnly: query.activeOnly !== 'false',
                sortBy: query.sortBy ?? 'created_at',
                sortOrder: query.sortOrder ?? 'desc',
            },);
        },
    },),

    // Public slug fetch (cached, published-only).
    defineRoute({
        method: 'get', path: '/slug/:slug', auth: 'public',
        summary: 'Fetch a published campaign by slug.',
        input: { params: z.object({ slug: z.string(), },), },
        handler: async ({ params, },) => {
            const campaign = await campaigns.getPublicBySlugCached(params.slug,);
            if (!campaign) throw new NotFoundError('Campaign',);
            return campaign;
        },
    },),

    // Donation summary (admin, cached).
    defineRoute({
        method: 'get', path: '/donations/summary', auth: 'admin',
        summary: 'Dashboard donation summary.',
        handler: () => campaigns.donationSummary(),
    },),

    // All donations (admin).
    defineRoute({
        method: 'get', path: '/donations/all', auth: 'admin',
        summary: 'List all donations with optional campaign/status filters.',
        input: { query: allDonationsQuery, },
        handler: async ({ query, },) => {
            const result = await campaigns.listAllDonations(
                { campaignId: query.campaignId, status: query.status, },
                { page: query.page, limit: query.limit, },
            );
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    // Donations for a campaign (public).
    defineRoute({
        method: 'get', path: '/:id/donations', auth: 'public',
        summary: 'List a campaign\'s donations.',
        input: { params: idParams, query: donationsQuery, },
        handler: async ({ params, query, },) => {
            const result = await campaigns.listDonationsForCampaign(
                params.id,
                { page: query.page, limit: query.limit, },
            );
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    // Bulk actions (admin).
    defineRoute({
        method: 'post', path: '/bulk', auth: 'admin',
        summary: 'Bulk status change / delete by id list.',
        handler: ({ body, },) => campaigns.bulk(body,),
    },),

    // Fetch by id. Admins (JWT or key) see any status; anonymous callers see
    // published campaigns only — lets public pages embed a campaign block by id.
    defineRoute({
        method: 'get', path: '/:id', auth: 'optional',
        summary: 'Fetch a campaign by id. Admins see any status; anonymous callers see published campaigns only.',
        input: { params: idParams, },
        handler: async ({ params, user, apiKey, },) => {
            const isAdmin = isAdminRole(user?.role,) || Boolean(apiKey,);
            const campaign = await campaigns.getById(params.id,);
            if (!campaign || (!isAdmin && !campaign.isPublished)) throw new NotFoundError('Campaign',);
            return campaign;
        },
    },),

    // Create (admin).
    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a campaign.',
        input: { body: campaignSchema, },
        handler: async ({ body, audit, },) => {
            const campaign = await campaigns.create(body, audit(),);
            return reply(campaign, { status: 201, },);
        },
    },),

    // Update (admin).
    defineRoute({
        method: 'put', path: '/:id', auth: 'admin',
        summary: 'Update a campaign.',
        input: { params: idParams, body: campaignSchema.partial(), },
        handler: ({ params, body, audit, },) => campaigns.update(params.id, body, audit(),),
    },),

    // Delete (admin).
    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a campaign.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await campaigns.remove(params.id, audit(),);
            return { message: 'Campaign deleted', };
        },
    },),
];
