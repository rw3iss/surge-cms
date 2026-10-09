/**
 * Roles (`/api/v1/roles`) and subscription tiers (`/api/v1/subscription-tiers`).
 * Reads are admin-tier; writes also need `roles:manage` / `subscriptions:manage`.
 * Logic in `services/subscriptionTiers.ts`.
 */
import { z, } from 'zod';
import type { RoleCreateBody, RoleUpdateBody, SubscriptionTierBody, } from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import * as permissions from '../services/permissions';
import * as tiers from '../services/subscriptionTiers';

const need = (user: { id?: string; role?: string; } | undefined, key: string,) =>
    permissions.requirePermission({ id: user?.id, role: user?.role, }, key,);

const roleKey = z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/,), },);
const tierId = z.object({ id: z.string().uuid(), },);

const tierBody = z.object({
    slug: z.string().max(64,).optional(),
    name: z.string().trim().min(1,).max(255,).optional(),
    description: z.string().max(2000,).nullable().optional(),
    role: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/,).nullable().optional(),
    isActive: z.boolean().optional(),
    stripePriceId: z.string().max(255,).nullable().optional(),
    sortOrder: z.number().int().optional(),
    permissions: z.array(z.string().max(120,),).max(500,).optional(),
},) satisfies z.ZodType<SubscriptionTierBody>;

export const rolesRoutes = [
    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'All roles: built-ins and custom (with user counts).',
        handler: () => tiers.listRoles(),
    },),
    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a custom role (inherits a member-level base role).',
        input: {
            body: z.object({
                key: z.string(), label: z.string().trim().min(1,).max(80,),
                description: z.string().max(500,).optional(), baseRole: z.string().nullable().optional(),
            },) satisfies z.ZodType<RoleCreateBody>,
        },
        handler: async ({ body, user, audit, },) => {
            await need(user, 'roles:manage',);
            return reply(await tiers.createRole(body, audit(),), { status: 201, },);
        },
    },),
    defineRoute({
        method: 'put', path: '/:key', auth: 'admin',
        summary: 'Update a custom role.',
        input: {
            params: roleKey,
            body: z.object({
                label: z.string().trim().min(1,).max(80,).optional(),
                description: z.string().max(500,).optional(), baseRole: z.string().nullable().optional(),
            },) satisfies z.ZodType<RoleUpdateBody>,
        },
        handler: async ({ params, body, user, audit, },) => {
            await need(user, 'roles:manage',);
            return tiers.updateRole(params.key, body, audit(),);
        },
    },),
    defineRoute({
        method: 'delete', path: '/:key', auth: 'admin',
        summary: 'Delete a custom role (refused while users or a subscription use it).',
        input: { params: roleKey, },
        handler: async ({ params, user, audit, },) => {
            await need(user, 'roles:manage',);
            await tiers.deleteRole(params.key, audit(),);
            return { deleted: true, };
        },
    },),
];

export const subscriptionTiersRoutes = [
    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'All subscription tiers (role, extra permissions, Stripe price, subscriber count).',
        handler: () => tiers.listTiers(),
    },),
    // Before /:id.
    defineRoute({
        method: 'get', path: '/options', auth: 'staff',
        summary: 'Tier picker for content gating: id/name/slug/free, in rank order (staff).',
        handler: () => tiers.tierOptions(),
    },),
    defineRoute({
        method: 'get', path: '/stripe-prices', auth: 'admin',
        summary: 'Recurring prices in the connected Stripe account (connected=false when Stripe is not set up).',
        handler: () => tiers.stripePrices(),
    },),
    defineRoute({
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'One subscription tier.',
        input: { params: tierId, },
        handler: ({ params, },) => tiers.getTier(params.id,),
    },),
    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a subscription tier.',
        input: { body: tierBody, },
        handler: async ({ body, user, audit, },) => {
            await need(user, 'subscriptions:manage',);
            return reply(await tiers.saveTier(null, body, audit(),), { status: 201, },);
        },
    },),
    defineRoute({
        method: 'put', path: '/:id', auth: 'admin',
        summary: "Update a tier (a role change re-syncs its subscribers' roles; `permissions` replaces its extra grants).",
        input: { params: tierId, body: tierBody, },
        handler: async ({ params, body, user, audit, },) => {
            await need(user, 'subscriptions:manage',);
            return tiers.saveTier(params.id, body, audit(),);
        },
    },),
    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a tier that never had subscribers (otherwise deactivate it).',
        input: { params: tierId, },
        handler: async ({ params, user, audit, },) => {
            await need(user, 'subscriptions:manage',);
            await tiers.deleteTier(params.id, audit(),);
            return { deleted: true, };
        },
    },),
];
