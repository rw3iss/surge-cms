import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const verifyMock = vi.fn();
vi.mock('../services/apiKeys', async (importOriginal,) => {
    const real = await importOriginal<typeof import('../services/apiKeys')>();
    return { ...real, verify: (...a: unknown[]) => verifyMock(...a,), };
},);

import { errorHandler, } from '../middleware/error';
import { defineRoute, } from './defineRoute';
import { buildRouter, } from './registry';

function appWithAdminRoutes() {
    const app = express();
    app.use(express.json(),);
    app.use(buildRouter([
        defineRoute({
            method: 'get', path: '/things', auth: 'admin', summary: 't',
            handler: ({ apiKey, },) => ({ via: apiKey ? 'key' : 'jwt', },),
        },),
        defineRoute({
            method: 'post', path: '/things', auth: 'admin', summary: 't',
            handler: () => ({ ok: true, },),
        },),
    ],),);
    app.use(errorHandler,);
    return app;
}

function appWithOptionalRoute() {
    const app = express();
    app.use(express.json(),);
    app.use(buildRouter([
        defineRoute({
            method: 'get', path: '/things', auth: 'optional', summary: 't',
            handler: ({ user, apiKey, },) => ({
                via: apiKey ? 'key' : (user ? 'jwt' : 'anon'),
                hasKey: Boolean(apiKey,),
                hasUser: Boolean(user,),
            },),
        },),
    ],),);
    app.use(errorHandler,);
    return app;
}

describe('adminOrApiKey', () => {
    beforeEach(() => verifyMock.mockReset(),);

    it('accepts a valid read-scope key on GET', async () => {
        verifyMock.mockResolvedValue({ id: 'k1', name: 'bot', scopes: ['read',], },);
        const res = await request(appWithAdminRoutes(),).get('/things',)
            .set('Authorization', 'Bearer ssk_valid',);
        expect(res.status,).toBe(200,);
        expect(res.body.data.via,).toBe('key',);
    },);

    it('rejects a read-scope key on POST with FORBIDDEN', async () => {
        verifyMock.mockResolvedValue({ id: 'k1', name: 'bot', scopes: ['read',], },);
        const res = await request(appWithAdminRoutes(),).post('/things',)
            .set('Authorization', 'Bearer ssk_valid',);
        expect(res.status,).toBe(403,);
        expect(res.body.error.code,).toBe('FORBIDDEN',);
    },);

    it('accepts a write-scope key on POST', async () => {
        verifyMock.mockResolvedValue({ id: 'k1', name: 'bot', scopes: ['write',], },);
        const res = await request(appWithAdminRoutes(),).post('/things',)
            .set('Authorization', 'Bearer ssk_valid',);
        expect(res.status,).toBe(200,);
    },);

    it('rejects an unknown/revoked key with 401', async () => {
        verifyMock.mockResolvedValue(null,);
        const res = await request(appWithAdminRoutes(),).get('/things',)
            .set('Authorization', 'Bearer ssk_revoked',);
        expect(res.status,).toBe(401,);
        expect(verifyMock,).toHaveBeenCalledWith('ssk_revoked',);
    },);

    it('falls through to JWT auth for non-ssk bearers (401 invalid token, not key error)', async () => {
        const res = await request(appWithAdminRoutes(),).get('/things',)
            .set('Authorization', 'Bearer not-a-key-jwt',);
        expect(res.status,).toBe(401,);
        expect(verifyMock,).not.toHaveBeenCalled();
    },);

    it('rejects anonymous requests', async () => {
        const res = await request(appWithAdminRoutes(),).get('/things',);
        expect(res.status,).toBe(401,);
    },);
},);

describe('optionalOrApiKey', () => {
    beforeEach(() => verifyMock.mockReset(),);

    it('authenticates a valid key on an optional route (ctx.apiKey set)', async () => {
        verifyMock.mockResolvedValue({ id: 'k1', name: 'bot', scopes: ['read',], },);
        const res = await request(appWithOptionalRoute(),).get('/things',)
            .set('Authorization', 'Bearer ssk_valid',);
        expect(res.status,).toBe(200,);
        expect(res.body.data.via,).toBe('key',);
        expect(res.body.data.hasKey,).toBe(true,);
    },);

    it('rejects an invalid key on an optional route with 401', async () => {
        verifyMock.mockResolvedValue(null,);
        const res = await request(appWithOptionalRoute(),).get('/things',)
            .set('Authorization', 'Bearer ssk_revoked',);
        expect(res.status,).toBe(401,);
        expect(verifyMock,).toHaveBeenCalledWith('ssk_revoked',);
    },);

    it('runs the handler anonymously when no auth is present', async () => {
        const res = await request(appWithOptionalRoute(),).get('/things',);
        expect(res.status,).toBe(200,);
        expect(res.body.data.via,).toBe('anon',);
        expect(res.body.data.hasUser,).toBe(false,);
        expect(res.body.data.hasKey,).toBe(false,);
        expect(verifyMock,).not.toHaveBeenCalled();
    },);
},);
