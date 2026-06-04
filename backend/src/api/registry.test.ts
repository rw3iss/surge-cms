import express from 'express';
import request from 'supertest';
import { describe, expect, it, } from 'vitest';
import { z, } from 'zod';
import { NotFoundError, } from '../core/errors';
import { errorHandler, } from '../middleware/error';
import { defineRoute, reply, } from './defineRoute';
import { buildRouter, manifest, registerModule, } from './registry';

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
        },),],);
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
            handler: ({ query, },) => ({ page: query.page, },),
        },),],);
        const res = await request(app,).get('/list?page=3',);
        expect(res.body.data.page,).toBe(3,);
    },);

    it('registers modules in the manifest', () => {
        registerModule('test-module', [defineRoute({
            method: 'get', path: '/x', auth: 'public', summary: 'example',
            handler: () => null,
        },),],);
        const entry = manifest().find((m,) => m.module === 'test-module',);
        expect(entry?.routes[0],).toEqual({
            method: 'GET', path: '/x', auth: 'public', summary: 'example',
        },);
    },);
},);
