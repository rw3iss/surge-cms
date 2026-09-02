/**
 * Permissions API.
 *
 * Every mutating route is additionally gated on `permissions:manage` — the
 * `admin` auth tier is the floor, and the permission narrows within it. That
 * makes the system govern itself rather than being a second, unenforced source
 * of truth.
 */
import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import * as permissions from '../services/permissions';

const MANAGE = 'permissions:manage';

const keyParams = z.object({ key: z.string().min(1,).max(120,), },);

const upsertBody = z.object({
    key: z.string().min(1,).max(120,),
    feature: z.string().max(64,).optional(),
    label: z.string().min(1,).max(160,),
    description: z.string().max(2000,).nullish(),
    action: z.string().max(40,).nullish(),
    defaultAccess: z.enum(['everyone', 'roles', 'nobody',],).optional(),
    defaultRoles: z.array(z.string().max(32,),).optional(),
},);

const patchBody = z.object({
    label: z.string().min(1,).max(160,).optional(),
    description: z.string().max(2000,).nullish(),
    defaultAccess: z.enum(['everyone', 'roles', 'nobody',],).optional(),
    defaultRoles: z.array(z.string().max(32,),).optional(),
},);

const grantBody = z.object({
    subjectType: z.enum(['role', 'user',],),
    subjectId: z.string().min(1,).max(64,),
    granted: z.boolean().default(true,),
},);

const grantQuery = z.object({
    subjectType: z.enum(['role', 'user',],),
    subjectId: z.string().min(1,).max(64,),
},);

export const permissionsRoutes = [

    // The catalog with its grants — the admin screen's single read.
    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List every registered permission with its rule and grants.',
        handler: async ({ user, },) => {
            await permissions.requirePermission({ id: user?.id, role: user?.role, }, MANAGE,);
            return permissions.listWithGrants();
        },
    },),

    /**
     * What the CALLER may do. Deliberately `user`-tier and unguarded: a client
     * asking about its own access is not privileged, and the UI needs it to
     * decide which buttons to render.
     */
    defineRoute({
        method: 'get', path: '/me', auth: 'user',
        summary: 'The calling user\'s resolved permissions.',
        handler: ({ user, },) =>
            permissions.permissionsFor({ id: user?.id, role: user?.role, },),
    },),

    // Resolved permissions for one user — powers the per-user modal.
    defineRoute({
        method: 'get', path: '/user/:key', auth: 'admin',
        summary: 'Resolved permissions + explicit grants for one user.',
        input: { params: keyParams, },
        handler: async ({ params, user, },) => {
            await permissions.requirePermission({ id: user?.id, role: user?.role, }, MANAGE,);
            const userId = params.key;
            const [grants, resolved,] = await Promise.all([
                permissions.grantsForUser(userId,),
                // The user's own role is looked up by the service; passing the
                // id alone would resolve role-based defaults as "no role".
                permissions.permissionsForUserId(userId,),
            ],);
            return { userId, grants, resolved, };
        },
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a permission by hand.',
        input: { body: upsertBody, },
        handler: async ({ body, user, audit, },) => {
            await permissions.requirePermission({ id: user?.id, role: user?.role, }, MANAGE,);
            const created = await permissions.createPermission(body, audit(),);
            return reply(created, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'put', path: '/:key', auth: 'admin',
        summary: 'Update a permission\'s rule (default access + roles).',
        input: { params: keyParams, body: patchBody, },
        handler: async ({ params, body, user, audit, },) => {
            await permissions.requirePermission({ id: user?.id, role: user?.role, }, MANAGE,);
            return permissions.updatePermission(params.key, body, audit(),);
        },
    },),

    defineRoute({
        method: 'delete', path: '/:key', auth: 'admin',
        summary: 'Delete a hand-made permission (system ones are refused).',
        input: { params: keyParams, },
        handler: async ({ params, user, audit, },) => {
            await permissions.requirePermission({ id: user?.id, role: user?.role, }, MANAGE,);
            await permissions.deletePermission(params.key, audit(),);
            return { message: 'Permission deleted', };
        },
    },),

    // ── Grants ──
    defineRoute({
        method: 'post', path: '/:key/grants', auth: 'admin',
        summary: 'Grant or deny a permission to a role or user.',
        input: { params: keyParams, body: grantBody, },
        handler: async ({ params, body, user, audit, },) => {
            await permissions.requirePermission({ id: user?.id, role: user?.role, }, MANAGE,);
            await permissions.setGrant(
                params.key, body.subjectType, body.subjectId, body.granted, audit(),
            );
            return { message: 'Grant saved', };
        },
    },),

    defineRoute({
        method: 'delete', path: '/:key/grants', auth: 'admin',
        summary: 'Remove a grant, falling back to the permission\'s default.',
        input: { params: keyParams, query: grantQuery, },
        handler: async ({ params, query, user, audit, },) => {
            await permissions.requirePermission({ id: user?.id, role: user?.role, }, MANAGE,);
            await permissions.removeGrant(
                params.key, query.subjectType, query.subjectId, audit(),
            );
            return { message: 'Grant removed', };
        },
    },),
];
