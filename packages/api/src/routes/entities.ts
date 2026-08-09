/**
 * Generic entities module — the entity-type registry (schema management) +
 * generic instance CRUD for every registered type. Thin manifest handlers;
 * business logic lives in `services/entities.ts` + `services/entityTypes.ts`.
 */
import { z, } from 'zod';
import { isStaffRole, } from '@sitesurge/types';
import { defineRoute, reply, } from '../api/defineRoute';
import { NotFoundError, } from '../core/errors';
import * as cbtSvc from '../services/contentBlockTemplates';
import * as entitiesSvc from '../services/entities';
import * as typesSvc from '../services/entityTypes';

const keyParam = z.object({ key: z.string(), },);
const typeParam = z.object({ type: z.string(), },);
const typeIdParam = z.object({ type: z.string(), id: z.string(), },);
const typeRefParam = z.object({ type: z.string(), idOrSlug: z.string(), },);

const listQuery = z.object({
    page: z.coerce.number().int().min(1,).optional(),
    limit: z.coerce.number().int().min(1,).max(200,).optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc',],).optional(),
    search: z.string().optional(),
    status: z.string().optional(),
    filter: z.string().optional(),
},);

const fieldSchema = z.object({
    id: z.string().optional(),
    key: z.string(),
    label: z.string().optional(),
    type: z.string(),
    core: z.boolean().optional(),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    indexed: z.boolean().optional(),
    searchable: z.boolean().optional(),
    defaultValue: z.unknown().optional(),
    options: z.record(z.string(), z.unknown(),).optional(),
    position: z.number().optional(),
},).passthrough();

const routingSchema = z.object({
    detailEnabled: z.boolean(), detailPrefix: z.string(),
    indexEnabled: z.boolean(), indexPrefix: z.string(),
},).partial();
const cachingSchema = z.object({
    indexEnabled: z.boolean(), indexTtlSeconds: z.number(),
    recordEnabled: z.boolean(), recordTtlSeconds: z.number(),
},).partial();

const createTypeSchema = z.object({
    key: z.string(),
    label: z.string(),
    labelPlural: z.string().optional(),
    description: z.string().optional(),
    hasSlug: z.boolean().optional(),
    hasStatus: z.boolean().optional(),
    searchable: z.boolean().optional(),
    routing: routingSchema.optional(),
    caching: cachingSchema.optional(),
    fields: z.array(fieldSchema,).optional(),
},);
const updateTypeSchema = createTypeSchema.partial();
const instanceBody = z.record(z.string(), z.unknown(),);

const templateIdParam = z.object({ type: z.string(), id: z.string(), },);
const templateCreateSchema = z.object({
    name: z.string(),
    description: z.string().optional(),
    mode: z.enum(['single', 'list',],).optional(),
    maxRecords: z.number().int().nullable().optional(),
},);
const templateUpdateSchema = templateCreateSchema.partial();
const templateBlockSchema = z.object({
    id: z.string().optional(),
    parentBlockId: z.string().nullable().optional(),
    blockType: z.string(),
    position: z.number().int(),
    settings: z.record(z.string(), z.unknown(),).optional(),
    style: z.record(z.string(), z.unknown(),).optional(),
},);
const templateBlocksBody = z.object({ blocks: z.array(templateBlockSchema,), },);

function meta(total: number, page = 1, limit = 20,) {
    return { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit,),), };
}

export const entitiesRoutes = [
    // ── Entity types (schema) ──
    defineRoute({
        method: 'get', path: '/types', auth: 'staff', summary: 'List entity types',
        handler: async () => typesSvc.listTypes(),
    },),
    defineRoute({
        method: 'get', path: '/types/:key', auth: 'staff', summary: 'Get an entity type',
        input: { params: keyParam, },
        handler: async ({ params, },) => {
            const t = await typesSvc.getType(params.key,);
            if (!t) throw new NotFoundError(`Entity type "${params.key}"`,);
            return t;
        },
    },),
    defineRoute({
        method: 'post', path: '/types', auth: 'admin', summary: 'Create a custom entity type',
        input: { body: createTypeSchema, },
        handler: async ({ body, },) => reply(await typesSvc.createType(body as never,), { status: 201, },),
    },),
    defineRoute({
        method: 'put', path: '/types/:key', auth: 'admin', summary: 'Update an entity type (schema/props)',
        input: { params: keyParam, body: updateTypeSchema, },
        handler: async ({ params, body, },) => typesSvc.updateType(params.key, body as never,),
    },),
    defineRoute({
        method: 'delete', path: '/types/:key', auth: 'admin', summary: 'Delete a custom entity type',
        input: { params: keyParam, },
        handler: async ({ params, },) => {
            await typesSvc.deleteType(params.key,);
            return { deleted: true, };
        },
    },),

    // ── Content-block templates ──
    // Registered BEFORE the `/:type/:idOrSlug` + `/:type` instance routes so
    // `/:type/templates` isn't captured by the single-entity matcher.
    defineRoute({
        method: 'get', path: '/:type/templates', auth: 'staff', summary: 'List content-block templates for a type',
        input: { params: typeParam, },
        handler: async ({ params, },) => cbtSvc.listByType(params.type,),
    },),
    defineRoute({
        method: 'get', path: '/:type/templates/:id', auth: 'staff', summary: 'Get a content-block template + its blocks',
        input: { params: templateIdParam, },
        handler: async ({ params, },) => {
            const template = await cbtSvc.findById(params.id,);
            if (!template) throw new NotFoundError(`Content-block template "${params.id}"`,);
            return { ...template, blocks: await cbtSvc.findBlocksResolved(params.id,), };
        },
    },),
    defineRoute({
        method: 'post', path: '/:type/templates', auth: 'admin', summary: 'Create a content-block template',
        input: { params: typeParam, body: templateCreateSchema, },
        handler: async ({ params, body, },) =>
            reply(await cbtSvc.create({ ...body, entityTypeKey: params.type, },), { status: 201, },),
    },),
    defineRoute({
        method: 'put', path: '/:type/templates/:id', auth: 'admin', summary: 'Update a content-block template',
        input: { params: templateIdParam, body: templateUpdateSchema, },
        handler: async ({ params, body, },) => {
            const template = await cbtSvc.update(params.id, body,);
            if (!template) throw new NotFoundError(`Content-block template "${params.id}"`,);
            return template;
        },
    },),
    defineRoute({
        method: 'delete', path: '/:type/templates/:id', auth: 'admin', summary: 'Delete a content-block template',
        input: { params: templateIdParam, },
        handler: async ({ params, },) => {
            await cbtSvc.remove(params.id,);
            return { deleted: true, };
        },
    },),
    defineRoute({
        method: 'get', path: '/:type/templates/:id/blocks', auth: 'staff', summary: 'Get a template\'s resolved blocks',
        input: { params: templateIdParam, },
        handler: async ({ params, },) => cbtSvc.findBlocksResolved(params.id,),
    },),
    defineRoute({
        method: 'put', path: '/:type/templates/:id/blocks', auth: 'admin', summary: 'Replace a template\'s blocks',
        input: { params: templateIdParam, body: templateBlocksBody, },
        handler: async ({ params, body, },) => {
            await cbtSvc.replaceBlocks(params.id, body.blocks,);
            return { saved: true, };
        },
    },),

    // ── Instances (generic CRUD) ──
    defineRoute({
        method: 'get', path: '/:type', auth: 'optional', summary: 'List/query entities of a type',
        input: { params: typeParam, query: listQuery, },
        handler: async ({ params, query, user, },) => {
            const admin = isStaffRole(user?.role,);
            const q: Record<string, unknown> = {
                page: query.page, limit: query.limit, sortBy: query.sortBy, sortOrder: query.sortOrder,
                search: query.search, status: query.status,
                filter: query.filter ? safeJson(query.filter,) : undefined,
            };
            if (!admin && !q.status) q.status = 'published'; // no-op for statusless types
            const res = await entitiesSvc.list(params.type, q, { admin, },);
            return reply(res.items, { meta: meta(res.total, query.page, query.limit,), },);
        },
    },),
    defineRoute({
        method: 'get', path: '/:type/:idOrSlug', auth: 'optional', summary: 'Get one entity by id or slug',
        input: { params: typeRefParam, },
        handler: async ({ params, user, },) =>
            entitiesSvc.get(params.type, params.idOrSlug, { admin: isStaffRole(user?.role,), },),
    },),
    defineRoute({
        method: 'post', path: '/:type', auth: 'staff', summary: 'Create an entity',
        input: { params: typeParam, body: instanceBody, },
        handler: async ({ params, body, userId, },) =>
            reply(await entitiesSvc.create(params.type, body, { userId, },), { status: 201, },),
    },),
    defineRoute({
        method: 'put', path: '/:type/:id', auth: 'staff', summary: 'Update an entity',
        input: { params: typeIdParam, body: instanceBody, },
        handler: async ({ params, body, },) => entitiesSvc.update(params.type, params.id, body,),
    },),
    defineRoute({
        method: 'delete', path: '/:type/:id', auth: 'staff', summary: 'Delete an entity',
        input: { params: typeIdParam, },
        handler: async ({ params, },) => {
            await entitiesSvc.remove(params.type, params.id,);
            return { deleted: true, };
        },
    },),
];

function safeJson(s: string,): unknown {
    try {
        return JSON.parse(s,);
    } catch {
        return undefined;
    }
}
