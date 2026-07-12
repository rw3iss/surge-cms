import { describe, expect, it, vi, } from 'vitest';
import type {
    UserBanResponse, UserAvatarUploadResponse, SearchResponse,
    DashboardSummaryResponse, MessageSubmitResponse,
} from '@sitesurge/types';
import { createClient, } from '../index';

function jsonResponse(data: unknown, status = 200,): Response {
    return new Response(JSON.stringify({ success: status < 400, data, },), {
        status, headers: { 'content-type': 'application/json', },
    },);
}

describe('engagement modules', () => {
    it('users.ban() POSTs /users/:id/ban with the reason body', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'banned', },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: UserBanResponse = await cms.users.ban('u1', { reason: 'spam', },);
        expect(out,).toEqual({ message: 'banned', },);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/users/u1/ban',);
        expect((init as RequestInit).method,).toBe('POST',);
        expect(JSON.parse((init as RequestInit).body as string,),).toEqual({ reason: 'spam', },);
    },);

    it('users.uploadAvatar() sends FormData with the avatar field', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'u1', },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const file = new Blob(['img',], { type: 'image/png', },);
        const out: UserAvatarUploadResponse = await cms.users.uploadAvatar('u1', file,);
        expect(out,).toEqual({ id: 'u1', },);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/users/u1/avatar',);
        const body = (init as RequestInit).body;
        expect(body,).toBeInstanceOf(FormData,);
        expect((body as FormData).get('avatar',),).toBeInstanceOf(Blob,);
        const headers = new Headers((init as RequestInit).headers,);
        expect(headers.get('content-type',),).toBeNull();
    },);

    it('search.query() hits GET /search and returns the keyed map', async () => {
        const map: SearchResponse = { posts: [{ id: 'p1', type: 'post', slug: 's', title: 'T', excerpt: null, featuredImage: null, publishedAt: null, relevance: 1, },], };
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(map,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: SearchResponse = await cms.search.query('hello',);
        expect(out,).toEqual(map,);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toContain('http://api/api/v1/search?q=hello',);
        expect((init as RequestInit).method,).toBe('GET',);
    },);

    it('dashboard.summary() hits GET /dashboard/summary', async () => {
        const summary = { pages: { total: 1, }, } as DashboardSummaryResponse;
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(summary,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: DashboardSummaryResponse = await cms.dashboard.summary();
        expect(out.pages.total,).toBe(1,);
        const [url,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/dashboard/summary',);
    },);

    it('messages.submit() POSTs the public contact form', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'received', }, 201,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: MessageSubmitResponse = await cms.messages.submit({ name: 'A', email: 'a@b.c', message: 'hi', },);
        expect(out,).toEqual({ message: 'received', },);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/messages',);
        expect((init as RequestInit).method,).toBe('POST',);
    },);
},);
