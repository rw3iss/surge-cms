import { describe, expect, it, vi, } from 'vitest';
import { CmsClientCore, } from './client';

function envelope(data: unknown, status = 200,) {
    return new Response(JSON.stringify({ success: status < 400, data, },), { status, headers: { 'content-type': 'application/json', }, },);
}
function pagedEnvelope(data: unknown, meta: Record<string, number>, status = 200,) {
    return new Response(JSON.stringify({ success: status < 400, data, meta, },), { status, headers: { 'content-type': 'application/json', }, },);
}
function errorEnvelope(code: string, message: string, status: number,) {
    return new Response(JSON.stringify({ success: false, error: { code, message, }, },), { status, headers: { 'content-type': 'application/json', }, },);
}

describe('CmsClientCore', () => {
    it('caches a GET — second send is served from cache (one fetch)', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(envelope([{ id: 'p', },],),);
        const core = new CmsClientCore({ baseUrl: 'http://api', fetch: fetchImpl, auth: { store: null, }, },);
        await core.send({ module: 'posts', method: 'GET', path: '/posts', query: { page: 1, }, },);
        await core.send({ module: 'posts', method: 'GET', path: '/posts', query: { page: 1, }, },);
        expect(fetchImpl,).toHaveBeenCalledOnce();
    },);

    it('sendPaged returns { data, meta } from the envelope', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            pagedEnvelope([{ id: 'p1', }, { id: 'p2', },], { page: 2, limit: 10, total: 42, totalPages: 5, },),
        );
        const core = new CmsClientCore({ baseUrl: 'http://api', fetch: fetchImpl, auth: { store: null, }, },);
        const out = await core.sendPaged<{ id: string; }>({ module: 'posts', method: 'GET', path: '/posts', query: { page: 2, }, },);
        expect(out.data,).toEqual([{ id: 'p1', }, { id: 'p2', },],);
        expect(out.meta,).toEqual({ page: 2, limit: 10, total: 42, totalPages: 5, },);
    },);

    it('sendPaged caches the { data, meta } object (second read served from cache)', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            pagedEnvelope([{ id: 'p', },], { total: 1, totalPages: 1, },),
        );
        const core = new CmsClientCore({ baseUrl: 'http://api', fetch: fetchImpl, auth: { store: null, }, },);
        const a = await core.sendPaged<{ id: string; }>({ module: 'posts', method: 'GET', path: '/posts', },);
        const b = await core.sendPaged<{ id: string; }>({ module: 'posts', method: 'GET', path: '/posts', },);
        expect(fetchImpl,).toHaveBeenCalledOnce();
        expect(b.meta,).toEqual(a.meta,);
        expect(b.data,).toEqual([{ id: 'p', },],);
    },);

    it('an entity GET still returns the entity directly (no meta wrapping)', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(envelope({ id: 'pg1', slug: 'about', },),);
        const core = new CmsClientCore({ baseUrl: 'http://api', fetch: fetchImpl, auth: { store: null, }, },);
        const out = await core.send({ module: 'pages', method: 'GET', path: '/pages/pg1', },);
        expect(out,).toEqual({ id: 'pg1', slug: 'about', },);
    },);

    it('a mutation invalidates the list cache', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(envelope([{ id: '1', },],),)   // first GET
            .mockResolvedValueOnce(envelope({ id: '2', }, 201,),) // POST
            .mockResolvedValueOnce(envelope([{ id: '1', }, { id: '2', },],),); // GET after invalidation
        const core = new CmsClientCore({ baseUrl: 'http://api', fetch: fetchImpl, auth: { store: null, }, },);
        await core.send({ module: 'posts', method: 'GET', path: '/posts', },);
        await core.send({ module: 'posts', method: 'POST', path: '/posts', body: { t: 'x', }, invalidates: ['posts',], } as never,);
        await core.send({ module: 'posts', method: 'GET', path: '/posts', },);
        expect(fetchImpl,).toHaveBeenCalledTimes(3,);
    },);

    it('emits on the error bus and rejects with the typed error', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(errorEnvelope('NOT_FOUND', 'nope', 404,),);
        const core = new CmsClientCore({ baseUrl: 'http://api', fetch: fetchImpl, auth: { store: null, }, },);
        const onErr = vi.fn(); core.onError(onErr,);
        await expect(core.send({ module: 'posts', method: 'GET', path: '/posts/x', },),).rejects.toThrow('nope',);
        expect(onErr,).toHaveBeenCalled();
    },);

    it('refreshes once on an expired bearer token then retries', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(errorEnvelope('UNAUTHORIZED', 'Token expired', 401,),) // first protected GET
            .mockResolvedValueOnce(envelope({ user: { id: 'u', }, accessToken: 'A2', refreshToken: 'R2', expiresAt: 'l', },),) // refresh
            .mockResolvedValueOnce(envelope({ id: 'me', },),); // retry
        const core = new CmsClientCore({
            baseUrl: 'http://api', fetch: fetchImpl,
            auth: { mode: 'bearer', tokens: { accessToken: 'A', refreshToken: 'R', }, store: null, },
        },);
        const out = await core.send({ module: 'users', method: 'GET', path: '/users/me', options: { cache: false, }, },);
        expect(out,).toEqual({ id: 'me', },);
        expect(fetchImpl,).toHaveBeenCalledTimes(3,);
    },);

    /**
     * Cookie-mode fetch mock keyed by URL.
     *
     * Counting raw calls doesn't work here: the first non-GET triggers a
     * one-off `GET /health/live` to obtain the CSRF cookie, so the refresh
     * POST costs two entries the first time. Routing by URL makes the
     * assertions say what they mean.
     */
    function cookieFetch(opts: { protectedResponses: unknown[]; refreshResponses: unknown[]; },) {
        const calls: string[] = [];
        const impl = vi.fn(async (url: string,) => {
            calls.push(url,);
            if (url.includes('/health/live',)) return envelope({ ok: true, },);
            if (url.includes('/auth/refresh',)) {
                return opts.refreshResponses.shift() ?? errorEnvelope('UNAUTHORIZED', 'No session', 401,);
            }
            return opts.protectedResponses.shift() ?? errorEnvelope('UNAUTHORIZED', 'Authentication required', 401,);
        },);
        return {
            impl,
            refreshCount: () => calls.filter((u,) => u.includes('/auth/refresh',)).length,
            protectedCount: () => calls.filter((u,) => u.includes('/users/me',)).length,
        };
    }

    const meCall = (core: CmsClientCore,) =>
        core.send({ module: 'users', method: 'GET', path: '/users/me', options: { cache: false, }, },);

    it('refreshes on "Authentication required", not just on "Token expired"', async () => {
        // The case that broke "remember me": in cookie mode the access COOKIE
        // dies at the same moment as the JWT inside it, so the browser sends
        // NO credential and the server says "Authentication required". Gating
        // the refresh on the word "expired" meant the 30-day refresh cookie
        // was never used and the session ended after an hour.
        const f = cookieFetch({
            protectedResponses: [
                errorEnvelope('UNAUTHORIZED', 'Authentication required', 401,),
                envelope({ id: 'me', },),
            ],
            refreshResponses: [envelope({ user: { id: 'u', }, accessToken: 'A2', refreshToken: 'R2', expiresAt: 'l', },),],
        },);
        const core = new CmsClientCore({
            baseUrl: 'http://api', fetch: f.impl as never, auth: { mode: 'cookie', store: null, },
        },);
        await expect(meCall(core,),).resolves.toEqual({ id: 'me', },);
        expect(f.refreshCount(),).toBe(1,);
        expect(f.protectedCount(),).toBe(2,); // original + retry
    },);

    it('gives up after one failed refresh, so an anonymous visitor retries once', async () => {
        // Without the latch, every 401 on a public page fires another doomed
        // POST /auth/refresh.
        const f = cookieFetch({ protectedResponses: [], refreshResponses: [], },);
        const core = new CmsClientCore({
            baseUrl: 'http://api', fetch: f.impl as never, auth: { mode: 'cookie', store: null, },
        },);
        await expect(meCall(core,),).rejects.toThrow('Authentication required',);
        await expect(meCall(core,),).rejects.toThrow('Authentication required',);
        await expect(meCall(core,),).rejects.toThrow('Authentication required',);
        expect(f.refreshCount(),).toBe(1,); // only the first 401 tried
        expect(f.protectedCount(),).toBe(3,);
    },);

    it('re-arms the refresh after a call succeeds', async () => {
        // A visitor who signs in must get the auto-refresh back; the latch
        // means "we have no session right now", not "never try again".
        const f = cookieFetch({
            protectedResponses: [
                errorEnvelope('UNAUTHORIZED', 'Authentication required', 401,), // 401 → refresh fails → latch
                envelope({ id: 'ok', },), //                                       success → re-arm
                errorEnvelope('UNAUTHORIZED', 'Authentication required', 401,), // 401 → refresh works
                envelope({ id: 'me', },),
            ],
            refreshResponses: [
                errorEnvelope('UNAUTHORIZED', 'No session', 401,),
                envelope({ user: { id: 'u', }, accessToken: 'A', refreshToken: 'R', expiresAt: 'l', },),
            ],
        },);
        const core = new CmsClientCore({
            baseUrl: 'http://api', fetch: f.impl as never, auth: { mode: 'cookie', store: null, },
        },);
        await expect(meCall(core,),).rejects.toThrow();
        await expect(meCall(core,),).resolves.toEqual({ id: 'ok', },);
        await expect(meCall(core,),).resolves.toEqual({ id: 'me', },);
        expect(f.refreshCount(),).toBe(2,);
    },);
},);
