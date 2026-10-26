/**
 * Shop discount codes — `/api/v1/shop/discounts` (feature `shop`).
 * Admin CRUD (`shop.discounts:manage`) + a public code check.
 * Service: services/shop/discounts.ts. Guide: docs/how-it-works/AFFILIATES-AND-DISCOUNTS.md.
 */
import type { ShopDiscountCheckBody, ShopDiscountCodeBody, ShopDiscountListQuery, } from '@sitesurge/types';
import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import * as permissions from '../services/permissions';
import * as discounts from '../services/shop/discounts';

const manage = (user: { id?: string; role?: string; } | undefined,) =>
    permissions.requirePermission({ id: user?.id, role: user?.role, }, 'shop.discounts:manage',);

const isoDate = z.string().max(40,).refine((v,) => !Number.isNaN(Date.parse(v,),), 'Expected a date',);

export const discountCodeBody = z.object({
    code: z.string().trim().min(3,).max(64,).optional(),
    kind: z.enum(['percent', 'fixed',],).optional(),
    percent: z.number().min(0,).max(100,).optional(),
    amountCents: z.number().int().min(0,).optional(),
    active: z.boolean().optional(),
    startsAt: isoDate.nullable().optional(),
    endsAt: isoDate.nullable().optional(),
    maxUses: z.number().int().positive().nullable().optional(),
    maxUsesPerUser: z.number().int().positive().nullable().optional(),
    minSubtotalCents: z.number().int().min(0,).nullable().optional(),
    allowedTierIds: z.array(z.string().uuid(),).max(50,).optional(),
    allowedRoles: z.array(z.string().max(32,),).max(50,).optional(),
    appliesToTickets: z.boolean().optional(),
    affiliateUserId: z.string().uuid().nullable().optional(),
    commissionPercent: z.number().min(0,).max(100,).nullable().optional(),
    note: z.string().max(1000,).nullable().optional(),
},) satisfies z.ZodType<ShopDiscountCodeBody>;

const listQuery = z.object({
    type: z.enum(['site', 'affiliate',],).optional(),
    affiliateUserId: z.string().uuid().optional(),
    search: z.string().max(64,).optional(),
},) satisfies z.ZodType<ShopDiscountListQuery>;

const idParams = z.object({ id: z.string().uuid(), },);

export const shopDiscountRoutes = [
    // Public: "is this code usable by me?" (checkout field live check; totals come from the preview).
    defineRoute({
        method: 'post', path: '/check', auth: 'optional',
        summary: 'Check a discount code for the caller (valid + a summary, or why not). Totals come from the checkout preview.',
        input: { body: z.object({ code: z.string().trim().min(1,).max(64,), },) satisfies z.ZodType<ShopDiscountCheckBody>, },
        handler: ({ body, user, },) => discounts.check(body.code, user ?? null,),
    },),

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List discount codes (site-wide and/or affiliate), with their paid-use counts.',
        input: { query: listQuery, },
        handler: async ({ query, user, },) => { await manage(user,); return discounts.list(query,); },
    },),
    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a discount code.',
        input: { body: discountCodeBody, },
        handler: async ({ body, user, audit, },) => { await manage(user,); return reply(await discounts.create(body, audit(),), { status: 201, },); },
    },),
    defineRoute({
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'One discount code.',
        input: { params: idParams, },
        handler: async ({ params, user, },) => { await manage(user,); return discounts.get(params.id,); },
    },),
    defineRoute({
        method: 'get', path: '/:id/redemptions', auth: 'admin',
        summary: 'Paid orders that used a code (newest first).',
        input: { params: idParams, },
        handler: async ({ params, user, },) => { await manage(user,); return discounts.redemptions(params.id,); },
    },),
    defineRoute({
        method: 'put', path: '/:id', auth: 'admin',
        summary: 'Update a discount code (partial).',
        input: { params: idParams, body: discountCodeBody, },
        handler: async ({ params, body, user, audit, },) => { await manage(user,); return discounts.update(params.id, body, audit(),); },
    },),
    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a discount code (soft — orders keep their history).',
        input: { params: idParams, },
        handler: async ({ params, user, audit, },) => { await manage(user,); await discounts.remove(params.id, audit(),); return { ok: true, }; },
    },),
];
