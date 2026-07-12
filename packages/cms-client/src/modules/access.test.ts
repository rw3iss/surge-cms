import { describe, expect, it, vi, } from 'vitest';
import type {
    ApiKeyCreateResponse, ConnectionReorderResponse, FontUploadResponse,
    HealthLiveResponse, AuthMeResponse, AuthRegisterResponse, UtilsUrlPreviewResponse,
} from '@sitesurge/types';
import { createClient, } from '../index';

function jsonResponse(data: unknown, status = 200,): Response {
    return new Response(JSON.stringify({ success: status < 400, data, },), {
        status, headers: { 'content-type': 'application/json', },
    },);
}

describe('access modules', () => {
    it('auth.login() delegates to the core AuthManager and stores the token', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(jsonResponse({
                user: { id: 'u1', }, accessToken: 'tok-A', refreshToken: 'tok-R', expiresAt: 'later',
            },),)
            .mockResolvedValueOnce(jsonResponse({ user: { id: 'u1', }, },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);

        const login = await cms.auth.login({ email: 'a@b.c', password: 'pw', },);
        expect(login.accessToken,).toBe('tok-A',);
        const [loginUrl, loginInit,] = fetchImpl.mock.calls[0];
        expect(String(loginUrl,),).toBe('http://api/api/v1/auth/login',);
        expect((loginInit as RequestInit).method,).toBe('POST',);

        // A subsequent authenticated call carries the stored Bearer token.
        const me: AuthMeResponse = await cms.auth.me();
        expect(me.user.id,).toBe('u1',);
        const [meUrl, meInit,] = fetchImpl.mock.calls[1];
        expect(String(meUrl,),).toBe('http://api/api/v1/auth/me',);
        const headers = new Headers((meInit as RequestInit).headers,);
        expect(headers.get('authorization',),).toBe('Bearer tok-A',);
    },);

    it('auth.register() POSTs /auth/register with the body (no auto-login)', async () => {
        const created: AuthRegisterResponse = { userId: 'u9', email: 'new@b.c', };
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(created, 200,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: AuthRegisterResponse = await cms.auth.register({ name: 'New', email: 'new@b.c', password: 'password1', },);
        expect(out.userId,).toBe('u9',);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/auth/register',);
        expect((init as RequestInit).method,).toBe('POST',);
        expect(JSON.parse((init as RequestInit).body as string,),).toEqual({ name: 'New', email: 'new@b.c', password: 'password1', },);
    },);

    it('utils.urlPreview() POSTs /utils/url-preview with the url body', async () => {
        const preview: UtilsUrlPreviewResponse = { title: 'Example', description: 'A page', image: 'https://x/i.png', };
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(preview,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: UtilsUrlPreviewResponse = await cms.utils.urlPreview({ url: 'https://example.com', },);
        expect(out.title,).toBe('Example',);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/utils/url-preview',);
        expect((init as RequestInit).method,).toBe('POST',);
        expect(JSON.parse((init as RequestInit).body as string,),).toEqual({ url: 'https://example.com', },);
    },);

    it('auth.me() is never cached (each call hits the network)', async () => {
        const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ user: { id: 'u1', }, },),),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        await cms.auth.me();
        await cms.auth.me();
        expect(fetchImpl,).toHaveBeenCalledTimes(2,);
    },);

    it('apiKeys.create() POSTs /api-keys with the body', async () => {
        const created: ApiKeyCreateResponse = {
            apiKey: { id: 'k1', name: 'CI', keyPrefix: 'ssk_12345678', scopes: ['read',], createdBy: null, lastUsedAt: null, revokedAt: null, createdAt: 'now', },
            key: 'ssk_plaintext',
        };
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(created, 201,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: ApiKeyCreateResponse = await cms.apiKeys.create({ name: 'CI', scopes: ['read',], },);
        expect(out.key,).toBe('ssk_plaintext',);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/api-keys',);
        expect((init as RequestInit).method,).toBe('POST',);
        expect(JSON.parse((init as RequestInit).body as string,),).toEqual({ name: 'CI', scopes: ['read',], },);
    },);

    it('connections.reorder() PUTs the direction body to the provider route', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'moved', },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: ConnectionReorderResponse = await cms.connections.reorder('youtube', { direction: 'up', },);
        expect(out,).toEqual({ message: 'moved', },);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/connections/youtube/reorder',);
        expect((init as RequestInit).method,).toBe('PUT',);
        expect(JSON.parse((init as RequestInit).body as string,),).toEqual({ direction: 'up', },);
    },);

    it('fonts.upload() sends multipart FormData with the file field', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'f1', }, 201,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const file = new Blob(['woff2-bytes',], { type: 'font/woff2', },);
        const out: FontUploadResponse = await cms.fonts.upload(file, { familyName: 'Inter', },);
        expect(out.id,).toBe('f1',);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/fonts',);
        const body = (init as RequestInit).body;
        expect(body,).toBeInstanceOf(FormData,);
        expect((body as FormData).get('file',),).toBeInstanceOf(Blob,);
        expect((body as FormData).get('familyName',),).toBe('Inter',);
        const headers = new Headers((init as RequestInit).headers,);
        expect(headers.get('content-type',),).toBeNull();
    },);

    it('health.live() GETs /health/live', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ live: true, },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: HealthLiveResponse = await cms.health.live();
        expect(out.live,).toBe(true,);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/health/live',);
        expect((init as RequestInit).method,).toBe('GET',);
    },);
},);
