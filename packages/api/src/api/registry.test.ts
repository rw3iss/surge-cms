import express from 'express';
import request from 'supertest';
import { describe, expect, it, } from 'vitest';
import { z, } from 'zod';
import { NotFoundError, } from '../core/errors';
import { errorHandler, } from '../middleware/error';
import { defineRoute, reply, } from './defineRoute';
import { authMiddlewaresFor, buildRouter, manifest, registerModule, } from './registry';

function appFor(defs: Parameters<typeof buildRouter>[0],) {
    const app = express();
    app.use(express.json(),);
    app.use(buildRouter(defs,),);
    app.use(errorHandler,);
    return app;
}

describe('route framework', () => {
    it('shapes plain returns into { success, data }', async () => {
        const app = appFor([defineRoute({
            method: 'get', path: '/hello', auth: 'public', summary: 't',
            handler: () => ({ hi: true, }),
        }),],);
        const res = await request(app,).get('/hello',);
        expect(res.status,).toBe(200,);
        expect(res.body,).toEqual({ success: true, data: { hi: true, }, },);
    },);

    it('honors reply() meta and status', async () => {
        const app = appFor([defineRoute({
            method: 'post', path: '/things', auth: 'public', summary: 't',
            handler: () => reply({ id: 1, }, { status: 201, meta: { page: 1, limit: 10, total: 1, totalPages: 1, }, },),
        },),],);
        const res = await request(app,).post('/things',);
        expect(res.status,).toBe(201,);
        expect(res.body.meta.total,).toBe(1,);
    },);

    it('rejects invalid input with VALIDATION_ERROR and field details', async () => {
        const app = appFor([defineRoute({
            method: 'post', path: '/things', auth: 'public', summary: 't',
            input: { body: z.object({ name: z.string().min(1,), },), },
            handler: ({ body, },) => body,
        },),],);
        const res = await request(app,).post('/things',).send({},);
        expect(res.status,).toBe(400,);
        expect(res.body.error.code,).toBe('VALIDATION_ERROR',);
        expect(res.body.error.details.errors[0].field,).toBe('name',);
    },);

    it('funnels thrown AppErrors into the shared envelope', async () => {
        const app = appFor([defineRoute({
            method: 'get', path: '/missing', auth: 'public', summary: 't',
            handler: () => { throw new NotFoundError('Post',); },
        },),],);
        const res = await request(app,).get('/missing',);
        expect(res.status,).toBe(404,);
        expect(res.body,).toEqual({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Post not found', },
        },);
    },);

    it('parses and coerces query params through the schema', async () => {
        const app = appFor([defineRoute({
            method: 'get', path: '/list', auth: 'public', summary: 't',
            input: { query: z.object({ page: z.coerce.number().int().default(1,), },), },
            handler: ({ query, },) => ({ page: query.page, }),
        },),],);
        const res = await request(app,).get('/list?page=3',);
        expect(res.body.data.page,).toBe(3,);
    },);

    it('registers modules in the manifest with mountPath + absolutePath', () => {
        registerModule('test-module', [
            defineRoute({
                method: 'get', path: '/', auth: 'public', summary: 'root',
                handler: () => null,
            },),
            defineRoute({
                method: 'get', path: '/x', auth: 'public', summary: 'example',
                handler: () => null,
            },),
        ], { mountPath: '/api/v1/test-module', },);
        const entry = manifest().find((m,) => m.module === 'test-module',);
        expect(entry?.mountPath,).toBe('/api/v1/test-module',);
        // A '/' route contributes no trailing slash to the absolute path.
        expect(entry?.routes[0],).toEqual({
            method: 'GET', path: '/', absolutePath: '/api/v1/test-module',
            auth: 'public', summary: 'root',
        },);
        // Non-root paths append verbatim.
        expect(entry?.routes[1],).toEqual({
            method: 'GET', path: '/x', absolutePath: '/api/v1/test-module/x',
            auth: 'public', summary: 'example',
        },);
    },);

    it('replaces a module entry on re-registration (idempotent)', () => {
        registerModule('dupe-module', [defineRoute({
            method: 'get', path: '/old', auth: 'public', summary: 'first',
            handler: () => null,
        },),], { mountPath: '/api/v1/dupe-module', },);
        registerModule('dupe-module', [defineRoute({
            method: 'get', path: '/new', auth: 'public', summary: 'second',
            handler: () => null,
        },),], { mountPath: '/api/v1/dupe-module', },);
        const matches = manifest().filter((m,) => m.module === 'dupe-module',);
        expect(matches,).toHaveLength(1,);
        expect(matches[0].routes,).toHaveLength(1,);
        expect(matches[0].routes[0].path,).toBe('/new',);
        expect(matches[0].routes[0].summary,).toBe('second',);
    },);

    it('lets a raw handler own the response without re-shaping', async () => {
        const app = appFor([defineRoute({
            method: 'get', path: '/raw', auth: 'public', summary: 't', raw: true,
            handler: ({ res, },) => { res.status(204,).end(); },
        },),],);
        const res = await request(app,).get('/raw',);
        expect(res.status,).toBe(204,);
        expect(res.text,).toBe('',);
        expect(res.body,).toEqual({},);
    },);

    it('defensively skips re-shaping when a non-raw handler already responded', async () => {
        const app = appFor([defineRoute({
            method: 'get', path: '/early', auth: 'public', summary: 't',
            handler: ({ res, },) => {
                res.status(202,).json({ ok: true, },);
                return { ignored: true, };
            },
        },),],);
        const res = await request(app,).get('/early',);
        expect(res.status,).toBe(202,);
        expect(res.body,).toEqual({ ok: true, },);
    },);

    it('parses and coerces path params through the schema', async () => {
        const app = appFor([defineRoute({
            method: 'get', path: '/items/:id', auth: 'public', summary: 't',
            input: { params: z.object({ id: z.coerce.number().int(), },), },
            handler: ({ params, },) => ({ id: params.id, }),
        },),],);
        const res = await request(app,).get('/items/42',);
        expect(res.body.data.id,).toBe(42,);
    },);

    it('funnels async rejections into the shared envelope', async () => {
        const app = appFor([defineRoute({
            method: 'get', path: '/async-missing', auth: 'public', summary: 't',
            handler: async () => { throw new NotFoundError('Thing',); },
        },),],);
        const res = await request(app,).get('/async-missing',);
        expect(res.status,).toBe(404,);
        expect(res.body,).toEqual({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Thing not found', },
        },);
    },);

    it('stacks pre middlewares AFTER auth middlewares on an admin route', () => {
        // Admin auth needs a DB-backed user/api-key, so a live request
        // would reject before the handler — we can't observe ordering
        // through a 200. Instead introspect the Express layer stack the
        // router built: auth middlewares come first, then pre, then the
        // wrapped handler. We assert the pre sits at exactly
        // authMiddlewaresFor('admin').length (immediately after auth).
        const preMw: import('express').RequestHandler = (_req, _res, next,) => next();
        const router = buildRouter([defineRoute({
            method: 'get', path: '/guarded', auth: 'admin', summary: 't',
            pre: [preMw,],
            handler: () => null,
        },),],);
        const layer = router.stack.find(
            (l: any,) => l.route && l.route.path === '/guarded',
        ) as any;
        const handles = layer.route.stack.map((s: any,) => s.handle,);
        const authCount = authMiddlewaresFor('admin',).length;
        // pre is positioned right after the auth middlewares…
        expect(handles[authCount],).toBe(preMw,);
        // …and the wrapped handler is the very last entry.
        expect(handles,).toHaveLength(authCount + 2,);
    },);

    it('runs pre middlewares before the handler', async () => {
        const app = appFor([defineRoute({
            method: 'get', path: '/pre', auth: 'public', summary: 't',
            pre: [(req, _res, next,) => { (req as any).preRan = true; next(); },],
            handler: (ctx,) => ({ preRan: (ctx.req as any).preRan === true, }),
        }),],);
        const res = await request(app,).get('/pre',);
        expect(res.status,).toBe(200,);
        expect(res.body.data.preRan,).toBe(true,);
    },);

    it('treats a non-raw undefined return as a 500 INTERNAL_ERROR', async () => {
        const app = appFor([defineRoute({
            method: 'get', path: '/forgot-raw', auth: 'public', summary: 't',
            handler: () => { /* writes nothing, returns undefined */ },
        },),],);
        const res = await request(app,).get('/forgot-raw',);
        expect(res.status,).toBe(500,);
        expect(res.body.success,).toBe(false,);
        expect(res.body.error.code,).toBe('INTERNAL_ERROR',);
    },);
},);
