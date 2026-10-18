/**
 * Membership applications (`/api/v1/membership-applications`) — admin review of
 * applications for tiers that require approval. Admin tier + the
 * `memberships.applications:review` permission. Members apply through
 * `POST /payments/membership/apply`. Logic in `services/membershipApplications.ts`.
 */
import { z, } from 'zod';
import type { MembershipApplicationDecisionBody, } from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import * as applications from '../services/membershipApplications';
import * as permissions from '../services/permissions';

const review = (user: { id?: string; role?: string; } | undefined,) =>
    permissions.requirePermission({ id: user?.id, role: user?.role, }, 'memberships.applications:review',);

const idParams = z.object({ id: z.string().uuid(), },);
const decision = z.object({ note: z.string().max(2000,).optional(), },) satisfies z.ZodType<MembershipApplicationDecisionBody>;

export const membershipApplicationsRoutes = [
    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List membership applications (?status=pending, ?userId=).',
        input: {
            query: z.object({
                status: z.enum(['pending', 'approved', 'rejected', 'withdrawn',],).optional(),
                userId: z.string().uuid().optional(),
                withoutAccount: z.coerce.boolean().optional(),
                page: z.coerce.number().int().min(1,).default(1,),
                limit: z.coerce.number().int().min(1,).max(200,).default(50,),
            },),
        },
        handler: async ({ query, user, },) => {
            await review(user,);
            const { data, total, } = await applications.list(query,);
            return reply(data, { meta: { page: query.page, limit: query.limit, total, totalPages: Math.max(1, Math.ceil(total / query.limit,),), }, },);
        },
    },),
    defineRoute({
        method: 'get', path: '/summary', auth: 'admin',
        summary: 'Count of applications waiting for review (Users page header).',
        handler: async ({ user, },) => {
            await review(user,);
            return applications.summary();
        },
    },),
    defineRoute({
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'One application: the answers, the tier and the saved card.',
        input: { params: idParams, },
        handler: async ({ params, user, },) => {
            await review(user,);
            return applications.get(params.id,);
        },
    },),
    defineRoute({
        method: 'post', path: '/:id/approve', auth: 'admin',
        summary: 'Approve: start the membership and charge the saved card now (fails with the card error, leaving it pending).',
        input: { params: idParams, body: decision, },
        handler: async ({ params, body, user, audit, },) => {
            await review(user,);
            return applications.approve(params.id, body.note, audit(),);
        },
    },),
    defineRoute({
        method: 'post', path: '/:id/reject', auth: 'admin',
        summary: 'Reject: nothing is charged; the applicant is emailed.',
        input: { params: idParams, body: decision, },
        handler: async ({ params, body, user, audit, },) => {
            await review(user,);
            return applications.reject(params.id, body.note, audit(),);
        },
    },),
    defineRoute({
        method: 'post', path: '/:id/withdraw-offer', auth: 'admin',
        summary: 'Withdraw an approved offer (hide-price level) that the member has not started yet.',
        input: { params: idParams, },
        handler: async ({ params, user, audit, },) => {
            await review(user,);
            return applications.withdrawOffer(params.id, audit(),);
        },
    },),
];
