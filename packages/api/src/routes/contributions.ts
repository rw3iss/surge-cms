/**
 * Contributor payouts (admin) — `/api/v1/contributions`. Settings live in
 * Posts → Settings → Contributions; contributions are listed on /admin/posts
 * (Contributions view). Permission `contributions:manage` (admin), except the
 * settings READ, which every staff reviewer needs for the default payout.
 * Service: services/contributions. Guide: docs/how-it-works/CONTRIBUTOR-PAYOUTS.md.
 */
import type { ContributionListQuery, ContributorSettingsBody, } from '@sitesurge/types';
import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import * as contributions from '../services/contributions';
import * as permissions from '../services/permissions';

type Caller = { id?: string; role?: string; } | undefined;
const manage = (user: Caller,) => permissions.requirePermission({ id: user?.id, role: user?.role, }, 'contributions:manage',);
const postParams = z.object({ postId: z.string().uuid(), },);
const STATES = ['all', 'pending_review', 'returned', 'approved', 'paid', 'revoked',] as const;

export const contributionRoutes = [
    defineRoute({
        method: 'get', path: '/settings', auth: 'staff',
        summary: 'Contributor payout settings (enabled, default payout, holding period, payout schedule; the Connect webhook secret masked).',
        handler: () => contributions.settingsForAdmin(),
    },),
    defineRoute({
        method: 'put', path: '/settings', auth: 'admin',
        summary: 'Update the contributor payout settings.',
        input: {
            body: z.object({
                enabled: z.boolean().optional(),
                defaultPayoutCents: z.number().int().min(0,).max(10_000_000,).optional(),
                currency: z.string().length(3,).optional(),
                holdDays: z.number().int().min(0,).max(365,).optional(),
                payoutSchedule: z.enum(['off', 'weekly', 'biweekly', 'monthly',],).optional(),
                connectWebhookSecret: z.string().max(200,).optional(),
            },) satisfies z.ZodType<ContributorSettingsBody>,
        },
        handler: async ({ body, user, audit, },) => { await manage(user,); return contributions.updateContributorSettings(body, audit(),); },
    },),
    defineRoute({
        method: 'get', path: '/summary', auth: 'admin',
        summary: 'Counts by state, money owed / payable / paid, and every contributor\'s balance + Stripe status.',
        handler: async ({ user, },) => { await manage(user,); return contributions.summary(); },
    },),
    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'Contributed posts (submitted for review, or credited) with their payout — filter by state / author / search, sortable, paginated.',
        input: {
            query: z.object({
                state: z.enum(STATES,).optional(),
                authorId: z.string().uuid().optional(),
                search: z.string().max(200,).optional(),
                sort: z.string().max(32,).optional(),
                page: z.coerce.number().int().min(1,).default(1,),
                limit: z.coerce.number().int().min(1,).max(100,).default(20,),
            },) satisfies z.ZodType<ContributionListQuery, any>,
        },
        handler: async ({ query, user, },) => {
            await manage(user,);
            const r = await contributions.list(query,);
            return reply(r.data, { meta: { page: r.page, limit: r.limit, total: r.total, totalPages: Math.ceil(r.total / r.limit,), }, },);
        },
    },),
    defineRoute({
        method: 'post', path: '/payouts', auth: 'admin',
        summary: 'Pay contributors their payable balance (the listed ones, else everyone with a payable balance).',
        input: { body: z.object({ userIds: z.array(z.string().uuid(),).max(500,).optional(), },), },
        handler: async ({ body, user, },) => { await manage(user,); return contributions.payOut(body.userIds, user?.id ?? null,); },
    },),
    defineRoute({
        method: 'get', path: '/:postId', auth: 'admin',
        summary: 'One contributed post with its payout.',
        input: { params: postParams, },
        handler: async ({ params, user, },) => { await manage(user,); return contributions.get(params.postId,); },
    },),
    defineRoute({
        method: 'put', path: '/:postId/payout', auth: 'admin',
        summary: 'Credit or change a contribution\'s payout (not once paid; re-credits a revoked one).',
        input: { params: postParams, body: z.object({ amountCents: z.number().int().min(0,).max(10_000_000,), },), },
        handler: async ({ params, body, user, audit, },) => { await manage(user,); return contributions.credit(params.postId, body.amountCents, audit(),); },
    },),
    defineRoute({
        method: 'post', path: '/:postId/revoke', auth: 'admin',
        summary: 'Revoke an unpaid contribution payout.',
        input: { params: postParams, },
        handler: async ({ params, user, audit, },) => { await manage(user,); return contributions.revoke(params.postId, audit(),); },
    },),
    defineRoute({
        method: 'post', path: '/:postId/unpublish', auth: 'admin',
        summary: 'Take a contributed post off the site (back to draft). Its payout is left as is — revoke it separately.',
        input: { params: postParams, },
        handler: async ({ params, user, audit, },) => { await manage(user,); return contributions.unpublish(params.postId, audit(),); },
    },),
];
