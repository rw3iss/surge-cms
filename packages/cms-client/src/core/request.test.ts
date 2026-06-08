import { describe, expect, it, vi, } from 'vitest';
import { interpolatePath, buildQuery, } from './url';
import { performRequest, } from './request';
import { NotFoundError, TimeoutError, } from './errors';

function jsonResponse(status: number, body: unknown,) {
    return new Response(JSON.stringify(body,), { status, headers: { 'content-type': 'application/json', }, },);
}

describe('url helpers', () => {
    it('interpolates params', () => {
        expect(interpolatePath('/posts/:id/revisions/:v', { id: 'a', v: 3, },),).toBe('/posts/a/revisions/3',);
    },);
    it('builds query, dropping nullish, numbers as strings', () => {
        expect(buildQuery({ page: 2, q: undefined, tag: 'x', },),).toBe('?page=2&tag=x',);
    },);
});

describe('performRequest', () => {
    const base = 'http://api/api/v1';

    it('unwraps the envelope and returns data', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: { id: '1', }, },),);
        const data = await performRequest({
            fetchImpl, method: 'GET', url: `${base}/posts/1`, headers: {}, timeoutMs: 1000,
        },);
        expect(data,).toEqual({ id: '1', },);
        expect(fetchImpl,).toHaveBeenCalledOnce();
    },);

    it('throws a typed error from a failure envelope', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            jsonResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'nope', }, },),);
        await expect(performRequest({
            fetchImpl, method: 'GET', url: `${base}/posts/x`, headers: {}, timeoutMs: 1000,
        },),).rejects.toBeInstanceOf(NotFoundError,);
    },);

    it('sends JSON body with content-type', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { success: true, data: { ok: true, }, },),);
        await performRequest({
            fetchImpl, method: 'POST', url: `${base}/posts`, headers: {}, body: { title: 'T', }, timeoutMs: 1000,
        },);
        const init = fetchImpl.mock.calls[0][1];
        expect(init.headers['Content-Type'],).toBe('application/json',);
        expect(JSON.parse(init.body,),).toEqual({ title: 'T', },);
    },);

    it('passes FormData without forcing content-type', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { success: true, data: {}, },),);
        const fd = new FormData();
        await performRequest({
            fetchImpl, method: 'POST', url: `${base}/media`, headers: {}, body: fd, timeoutMs: 1000,
        },);
        const init = fetchImpl.mock.calls[0][1];
        expect(init.headers['Content-Type'],).toBeUndefined();
        expect(init.body,).toBe(fd,);
    },);

    it('raw:true returns the response text untouched', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            new Response('<rss/>', { status: 200, headers: { 'content-type': 'application/rss+xml', }, },),);
        const out = await performRequest({
            fetchImpl, method: 'GET', url: 'http://api/feed.xml', headers: {}, raw: true, timeoutMs: 1000,
        },);
        expect(out,).toBe('<rss/>',);
    },);

    it('maps an abort/timeout to TimeoutError', async () => {
        const fetchImpl = vi.fn().mockImplementation((_, init,) => new Promise((_res, rej,) => {
            init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted',), { name: 'AbortError', },)),);
        }),);
        await expect(performRequest({
            fetchImpl, method: 'GET', url: `${base}/slow`, headers: {}, timeoutMs: 5,
        },),).rejects.toBeInstanceOf(TimeoutError,);
    },);
},);
