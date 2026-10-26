/**
 * Affiliate program — `/api/v1/affiliates` (feature `affiliates`; 404 while off).
 *   /me…      the signed-in affiliate (`affiliates:self` + holding the affiliate role)
 *   /admin…   the program (`affiliates:manage`)
 * Service: services/affiliates. Guide: docs/how-it-works/AFFILIATES-AND-DISCOUNTS.md.
 */
import type { AffiliateCodeSplitBody, AffiliateSettingsBody, } from '@sitesurge/types';
import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import * as affiliates from '../services/affiliates';
import * as permissions from '../services/permissions';
import { discountCodeBody, } from './shopDiscounts';

type Caller = { id?: string; role?: string; } | undefined;
const manage = (user: Caller,) => permissions.requirePermission({ id: user?.id, role: user?.role, }, 'affiliates:manage',);
async function self(user: Caller,): Promise<string> {
    await permissions.requirePermission({ id: user?.id, role: user?.role, }, 'affiliates:self',);
    return affiliates.assertAffiliate(user?.id,);
}

const userParams = z.object({ userId: z.string().uuid(), },);

export const affiliateRoutes = [
    // ── The affiliate's own page ──
    defineRoute({
        method: 'get', path: '/me/status', auth: 'user',
        summary: 'Is the caller an affiliate (shows the Profile → Affiliate program tab)?',
        handler: async ({ user, },) => ({ affiliate: user ? await affiliates.isAffiliate(user.id,) : false, }),
    },),
    defineRoute({
        method: 'get', path: '/me', auth: 'user',
        summary: 'The affiliate page: Stripe status, balance, codes, commissions (no buyer details), payouts.',
        handler: async ({ user, },) => affiliates.me(await self(user,),),
    },),
    defineRoute({
        method: 'put', path: '/me/codes/:id', auth: 'user',
        summary: 'Set how much of your commission on a code buyers get as a discount.',
        input: {
            params: z.object({ id: z.string().uuid(), },),
            body: z.object({ buyerDiscountPercent: z.number().min(0,).max(100,), },) satisfies z.ZodType<AffiliateCodeSplitBody>,
        },
        handler: async ({ user, params, body, audit, },) => affiliates.setSplit(await self(user,), params.id, body.buyerDiscountPercent, audit(),),
    },),
    defineRoute({
        method: 'post', path: '/me/stripe/onboard', auth: 'user',
        summary: 'Connect (or finish connecting) your Stripe Express account — returns the Stripe onboarding link.',
        handler: async ({ user, },) => ({ url: await affiliates.onboardingLink(await self(user,), user?.email ?? null,), }),
    },),
    defineRoute({
        method: 'post', path: '/me/stripe/dashboard', auth: 'user',
        summary: 'A one-time link into your Stripe Express dashboard (payouts, bank details).',
        handler: async ({ user, },) => ({ url: await affiliates.dashboardLink(await self(user,),), }),
    },),
    defineRoute({
        method: 'post', path: '/me/stripe/refresh', auth: 'user',
        summary: 'Re-read your Stripe account status (after onboarding).',
        handler: async ({ user, },) => affiliates.refreshStatus(await self(user,),),
    },),

    // ── Admin ──
    defineRoute({
        method: 'get', path: '/settings', auth: 'admin',
        summary: 'Affiliate program settings (role, refund window, payout schedule, default commission).',
        handler: async ({ user, },) => { await manage(user,); return affiliates.maskSettings(await affiliates.getAffiliateSettings(),); },
    },),
    defineRoute({
        method: 'put', path: '/settings', auth: 'admin',
        summary: 'Update the affiliate program settings.',
        input: {
            body: z.object({
                role: z.string().max(32,).optional(),
                refundWindowDays: z.number().int().min(0,).max(365,).optional(),
                payoutSchedule: z.enum(['off', 'weekly', 'biweekly', 'monthly',],).optional(),
                defaultCommissionPercent: z.number().min(0,).max(100,).optional(),
                connectWebhookSecret: z.string().max(200,).optional(),
            },) satisfies z.ZodType<AffiliateSettingsBody>,
        },
        handler: async ({ body, user, audit, },) => { await manage(user,); return affiliates.updateAffiliateSettings(body, audit(),); },
    },),
    defineRoute({
        method: 'get', path: '/admin/stats', auth: 'admin',
        summary: 'Program numbers: members, sales + commission (30 days), owed, payable now.',
        handler: async ({ user, },) => { await manage(user,); return affiliates.stats(); },
    },),
    defineRoute({
        method: 'get', path: '/admin/members', auth: 'admin',
        summary: 'Every affiliate (users with the affiliate role, or holding a code) with codes, balance and sales.',
        handler: async ({ user, },) => { await manage(user,); return affiliates.members(); },
    },),
    defineRoute({
        method: 'get', path: '/admin/members/:userId', auth: 'admin',
        summary: 'One affiliate with their commissions and payouts.',
        input: { params: userParams, },
        handler: async ({ params, user, },) => { await manage(user,); return affiliates.member(params.userId,); },
    },),
    defineRoute({
        method: 'post', path: '/admin/members/:userId/codes', auth: 'admin',
        summary: 'Give an affiliate a code (commission defaults to the program setting).',
        input: { params: userParams, body: discountCodeBody, },
        handler: async ({ params, body, user, audit, },) => {
            await manage(user,);
            return reply(await affiliates.createCode(params.userId, body, audit(),), { status: 201, },);
        },
    },),
    defineRoute({
        method: 'post', path: '/admin/members/:userId/payout', auth: 'admin',
        summary: "Pay out an affiliate's payable commission now (a Stripe transfer to their Express account).",
        input: { params: userParams, },
        handler: async ({ params, user, },) => { await manage(user,); return affiliates.payOut(params.userId, 'manual', user?.id ?? null,); },
    },),
];
