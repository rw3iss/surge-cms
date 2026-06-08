import { describe, expect, it, vi, } from 'vitest';
import type {
    PostListResponse, MediaUploadResponse, CampaignPublicListResponse,
    CampaignAdminListResponse, FormSubmissionsExportResponse,
} from '@rw/cms-shared';
import { createClient, } from '../index';

function jsonResponse(data: unknown, status = 200,): Response {
    return new Response(JSON.stringify({ success: status < 400, data, },), {
        status, headers: { 'content-type': 'application/json', },
    },);
}

function textResponse(body: string,): Response {
    return new Response(body, { status: 200, headers: { 'content-type': 'text/csv', }, },);
}

/** Read the URL of the most recent fetch call. */
function lastUrl(fetchImpl: ReturnType<typeof vi.fn>,): string {
    const call = fetchImpl.mock.calls[fetchImpl.mock.calls.length - 1];
    return String(call[0],);
}

describe('content modules', () => {
    it('posts.list() hits GET /api/v1/posts', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ id: 'p1', },],),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: PostListResponse = await cms.posts.list();
        expect(out,).toEqual([{ id: 'p1', },],);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toContain('http://api/api/v1/posts',);
        expect((init as RequestInit).method,).toBe('GET',);
    },);

    it('media.upload() sends FormData with no JSON Content-Type', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'm1', }, 201,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const file = new Blob(['hello',], { type: 'text/plain', },);
        const out: MediaUploadResponse = await cms.media.upload(file, { alt: 'an image', },);
        expect(out,).toEqual({ id: 'm1', },);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toContain('http://api/api/v1/media',);
        const body = (init as RequestInit).body;
        expect(body,).toBeInstanceOf(FormData,);
        expect((body as FormData).get('file',),).toBeInstanceOf(Blob,);
        expect((body as FormData).get('alt',),).toBe('an image',);
        const headers = new Headers((init as RequestInit).headers,);
        expect(headers.get('content-type',),).toBeNull();
    },);

    it('campaigns.listPublic() omits all=true; campaigns.list({}) sends all=true', async () => {
        // fresh Response per call — a Response body can only be read once.
        const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse([],),),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);

        const pub: CampaignPublicListResponse = await cms.campaigns.listPublic();
        expect(pub,).toEqual([],);
        expect(lastUrl(fetchImpl,),).not.toContain('all=true',);

        const admin: CampaignAdminListResponse = await cms.campaigns.list({},);
        expect(admin,).toEqual([],);
        expect(lastUrl(fetchImpl,),).toContain('all=true',);
    },);

    it('forms.exportSubmissions() returns the raw CSV string', async () => {
        const csv = 'id,answer\n1,yes\n';
        const fetchImpl = vi.fn().mockResolvedValue(textResponse(csv,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out: FormSubmissionsExportResponse = await cms.forms.exportSubmissions('form-1',);
        expect(out,).toBe(csv,);
        expect(lastUrl(fetchImpl,),).toContain('http://api/api/v1/forms/form-1/submissions/export',);
    },);

    it('pages.getBySlug() interpolates the slug into the path', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'pg1', slug: 'about', },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        await cms.pages.getBySlug('about',);
        expect(lastUrl(fetchImpl,),).toContain('http://api/api/v1/pages/slug/about',);
    },);
},);
