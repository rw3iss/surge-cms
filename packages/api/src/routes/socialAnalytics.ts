/**
 * /api/v1/social-analytics — collected social analytics (staff).
 * Reads come only from our own tables (services/social/analytics/read.ts);
 * collectors are run by the daily `social-analytics` cron or "Collect now".
 */
import { z, } from 'zod';
import type {
    AssertCompatible,
    SocialAnalyticsCollectBody,
    SocialAnalyticsOverviewQuery,
    SocialAnalyticsPostsQuery,
    SocialAnalyticsRunsQuery,
    SocialAnalyticsSeriesQuery,
} from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import { viewerOf, } from '../services/discussions';
import * as permissions from '../services/permissions';
import * as analytics from '../services/socialAnalytics';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/,);

const rangeQuery = z.object({ from: day.optional(), to: day.optional(), },);
type _AssertRange = AssertCompatible<z.infer<typeof rangeQuery>, SocialAnalyticsOverviewQuery>;

const seriesQuery = rangeQuery.extend({ platform: z.string().max(32,), metric: z.string().max(64,), },);
type _AssertSeries = AssertCompatible<z.infer<typeof seriesQuery>, SocialAnalyticsSeriesQuery>;

const postsQuery = rangeQuery.extend({
    platform: z.string().max(32,).optional(),
    kind: z.string().max(32,).optional(),
    search: z.string().max(200,).optional(),
    sort: z.enum(['publishedAt', 'views', 'viewsInPeriod', 'likes', 'comments', 'shares', 'watchTimeS', 'engagementRate', 'impressions',],).optional(),
    dir: z.enum(['asc', 'desc',],).optional(),
    page: z.coerce.number().int().min(1,).optional(),
    limit: z.coerce.number().int().min(1,).max(100,).optional(),
    publishedInPeriod: z.preprocess((v,) => (v === 'true' || v === true ? true : v === 'false' || v === false ? false : undefined), z.boolean().optional(),),
},);
type _AssertPosts = AssertCompatible<z.infer<typeof postsQuery>, SocialAnalyticsPostsQuery>;

const collectBody = z.object({ platforms: z.array(z.string().max(32,),).max(10,).optional(), },) satisfies z.ZodType<SocialAnalyticsCollectBody>;

const runsQuery = z.object({
    platform: z.string().max(32,).optional(),
    limit: z.coerce.number().int().min(1,).max(200,).optional(),
},);
type _AssertRuns = AssertCompatible<z.infer<typeof runsQuery>, SocialAnalyticsRunsQuery>;

const VIEW = 'social.analytics:view';
const MANAGE = 'social.analytics:manage';

export const socialAnalyticsRoutes = [
    defineRoute({
        method: 'get', path: '/overview', auth: 'staff',
        summary: 'Per-platform totals for a period (followers, views, watch time, engagement) + definition-change notes.',
        input: { query: rangeQuery, },
        handler: async ({ query, user, },) => {
            await permissions.requirePermission(viewerOf(user,), VIEW,);
            return analytics.overview(query,);
        },
    },),
    defineRoute({
        method: 'get', path: '/series', auth: 'staff',
        summary: 'One daily series of a platform (followers, views, watchTimeMinutes, likes, …).',
        input: { query: seriesQuery, },
        handler: async ({ query, user, },) => {
            await permissions.requirePermission(viewerOf(user,), VIEW,);
            return analytics.series(query.platform, query.metric, query,);
        },
    },),
    defineRoute({
        method: 'get', path: '/posts', auth: 'staff',
        summary: 'Captured posts with their latest metrics, views gained in the period and at day 7 (paginated).',
        input: { query: postsQuery, },
        handler: async ({ query, user, },) => {
            await permissions.requirePermission(viewerOf(user,), VIEW,);
            const r = await analytics.posts(query,);
            return reply(r.data, { meta: { page: r.page, limit: r.limit, total: r.total, totalPages: Math.max(1, Math.ceil(r.total / r.limit,),), }, },);
        },
    },),
    defineRoute({
        method: 'get', path: '/posts/:id', auth: 'staff',
        summary: 'One post\'s metrics and its daily history in the period.',
        input: { params: z.object({ id: z.string().uuid(), },), query: rangeQuery, },
        handler: async ({ params, query, user, },) => {
            await permissions.requirePermission(viewerOf(user,), VIEW,);
            return analytics.postSeries(params.id, query,);
        },
    },),
    defineRoute({
        method: 'get', path: '/collectors', auth: 'staff',
        summary: 'Each platform collector: ready / partial / off, what it collects and what to do.',
        handler: async ({ user, },) => {
            await permissions.requirePermission(viewerOf(user,), VIEW,);
            return analytics.collectorStatuses();
        },
    },),
    defineRoute({
        method: 'get', path: '/runs', auth: 'staff',
        summary: 'Recent collector runs (status, counts, warnings, errors).',
        input: { query: runsQuery, },
        handler: async ({ query, user, },) => {
            await permissions.requirePermission(viewerOf(user,), MANAGE,);
            return analytics.listRuns(query.platform, query.limit,);
        },
    },),
    defineRoute({
        method: 'post', path: '/summary', auth: 'staff',
        summary: 'AI summary of the period (headline, what changed, top posts, next steps) via the AI module.',
        input: { body: rangeQuery, },
        handler: async ({ body, user, },) => {
            await permissions.requirePermission(viewerOf(user,), VIEW,);
            await permissions.requirePermission(viewerOf(user,), 'ai:use',);
            return analytics.summarize(body,);
        },
    },),
    defineRoute({
        method: 'post', path: '/collect', auth: 'staff',
        summary: 'Run the collectors now (all ready ones, or the named platforms).',
        input: { body: collectBody, },
        handler: async ({ body, user, },) => {
            await permissions.requirePermission(viewerOf(user,), MANAGE,);
            return analytics.runCollection({ platforms: body.platforms, trigger: 'manual', },);
        },
    },),
];
