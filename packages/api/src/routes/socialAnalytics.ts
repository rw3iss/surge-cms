/**
 * /api/v1/social-analytics — collected social analytics (staff).
 * Reads come only from our own tables (services/social/analytics/read.ts);
 * collectors are run by the daily `social-analytics` cron or "Collect now".
 */
import { z, } from 'zod';
import type { Request, Response, } from 'express';
import type {
    AssertCompatible,
    SocialAnalyticsAudienceQuery,
    SocialAnalyticsDigestCreateBody,
    SocialAnalyticsDigestsQuery,
    SocialAnalyticsSettingsBody,
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

const settingsBody = z.object({
    digest: z.object({
        enabled: z.boolean(),
        frequency: z.enum(['daily', 'weekly', 'monthly',],),
        weekday: z.number().int(),
        monthDay: z.number().int(),
        hour: z.number().int(),
        timezone: z.string().max(64,),
        platforms: z.array(z.string().max(32,),).max(20,),
        sections: z.array(z.enum(['totals', 'platforms', 'trends', 'topPosts', 'audience', 'ai',],),).max(6,),
        topPosts: z.number().int(),
        aiPool: z.string().max(64,),
    },).partial().optional(),
    email: z.object({
        enabled: z.boolean(),
        format: z.enum(['full', 'summary',],),
        recipients: z.array(z.string().max(254,),).max(100,),
        recipientMode: z.enum(['augment', 'override',],),
    },).partial().optional(),
    retentionDays: z.number().int().min(1,).nullable().optional(),
    benchmarks: z.object({ instagram: z.array(z.string().max(64,),).max(20,), facebook: z.array(z.string().max(200,),).max(20,), },).partial().optional(),
},) satisfies z.ZodType<SocialAnalyticsSettingsBody>;

const digestsQuery = z.object({
    page: z.coerce.number().int().min(1,).optional(),
    limit: z.coerce.number().int().min(1,).max(100,).optional(),
},);
type _AssertDigests = AssertCompatible<z.infer<typeof digestsQuery>, SocialAnalyticsDigestsQuery>;

const digestCreateBody = z.object({ from: day.optional(), to: day.optional(), email: z.boolean().optional(), },) satisfies z.ZodType<SocialAnalyticsDigestCreateBody>;
const idParams = z.object({ id: z.string().uuid(), },);

const audienceQuery = rangeQuery.extend({ platform: z.string().max(32,), },);
type _AssertAudience = AssertCompatible<z.infer<typeof audienceQuery>, SocialAnalyticsAudienceQuery>;

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
        summary: 'Run the collectors now (all ready ones, or the named platforms). Waits ≤ 50 s; runs still going come back with status "running".',
        input: { body: collectBody, },
        handler: async ({ body, user, },) => {
            await permissions.requirePermission(viewerOf(user,), MANAGE,);
            return analytics.collectNow({ platforms: body.platforms, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/audience', auth: 'staff',
        summary: 'Audience + content breakdowns for a platform: demographics, online hours, content types, hashtags, stories, benchmarks.',
        input: { query: audienceQuery, },
        handler: async ({ query, user, },) => {
            await permissions.requirePermission(viewerOf(user,), VIEW,);
            return analytics.audience(query.platform, query,);
        },
    },),

    // ─── Settings + digests ───
    defineRoute({
        method: 'get', path: '/settings', auth: 'staff',
        summary: 'Analytics settings: digest schedule, sections, email, retention.',
        handler: async ({ user, },) => {
            await permissions.requirePermission(viewerOf(user,), VIEW,);
            return analytics.getSettings();
        },
    },),
    defineRoute({
        method: 'put', path: '/settings', auth: 'staff',
        summary: 'Update the analytics settings (digest / email objects merge field by field).',
        input: { body: settingsBody, },
        handler: async ({ body, user, audit, },) => {
            await permissions.requirePermission(viewerOf(user,), MANAGE,);
            return analytics.updateSettings(body, audit(),);
        },
    },),
    defineRoute({
        method: 'get', path: '/digests', auth: 'staff',
        summary: 'Stored digests, newest first (paginated).',
        input: { query: digestsQuery, },
        handler: async ({ query, user, },) => {
            await permissions.requirePermission(viewerOf(user,), VIEW,);
            const r = await analytics.listDigests(query.page, query.limit,);
            return reply(r.data, { meta: { page: r.page, limit: r.limit, total: r.total, totalPages: Math.max(1, Math.ceil(r.total / r.limit,),), }, },);
        },
    },),
    defineRoute({
        method: 'get', path: '/digests/:id', auth: 'staff',
        summary: 'One digest with its stored snapshot.',
        input: { params: idParams, },
        handler: async ({ params, user, },) => {
            await permissions.requirePermission(viewerOf(user,), VIEW,);
            return analytics.getDigest(params.id,);
        },
    },),
    defineRoute({
        method: 'post', path: '/digests', auth: 'staff',
        summary: 'Generate a digest now (default: the last configured period). Returns at once with status "generating" — poll it.',
        input: { body: digestCreateBody, },
        handler: async ({ body, user, },) => {
            await permissions.requirePermission(viewerOf(user,), MANAGE,);
            return analytics.generateDigest({ from: body.from, to: body.to, email: body.email, trigger: 'manual', createdBy: user?.id ?? null, wait: false, },);
        },
    },),
    defineRoute({
        method: 'post', path: '/digests/:id/send', auth: 'staff',
        summary: 'Email a stored digest to the configured recipients.',
        input: { params: idParams, },
        handler: async ({ params, user, },) => {
            await permissions.requirePermission(viewerOf(user,), MANAGE,);
            return analytics.sendDigestEmail(await analytics.getDigest(params.id,), { manual: true, },);
        },
    },),
    defineRoute({
        method: 'delete', path: '/digests/:id', auth: 'staff',
        summary: 'Delete a stored digest.',
        input: { params: idParams, },
        handler: async ({ params, user, },) => {
            await permissions.requirePermission(viewerOf(user,), MANAGE,);
            return analytics.deleteDigest(params.id,);
        },
    },),
    defineRoute({
        method: 'get', path: '/digests/:id/email', auth: 'staff', raw: true,
        summary: 'The digest rendered as its email (HTML page) — `format` full|summary (default: the settings format).',
        input: { params: idParams, query: z.object({ format: z.enum(['full', 'summary',],).optional(), },), },
        handler: async ({ params, query, user, res, }: { params: { id: string; }; query: { format?: 'full' | 'summary'; }; user?: { id?: string; role?: string; }; res: Response; req: Request; },) => {
            await permissions.requirePermission(viewerOf(user as never,), VIEW,);
            const digest = await analytics.getDigest(params.id,);
            const format = query.format ?? (await analytics.getSettings()).email.format;
            const html = await analytics.renderEmailFor(digest, format,);
            res.setHeader('Content-Type', 'text/html; charset=utf-8',);
            res.setHeader('Cache-Control', 'no-store',);
            res.setHeader('X-Robots-Tag', 'noindex',);
            res.send(html,);
        },
    },),
];
