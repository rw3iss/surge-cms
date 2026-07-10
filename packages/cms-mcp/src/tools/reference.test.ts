import { afterEach, describe, expect, it, vi, } from 'vitest';
import { referenceTools, } from './reference';
import type { ToolContext, ToolDef, } from '../tool';

function tool(name: string,): ToolDef {
    const t = referenceTools.find((x,) => x.name === name,);
    if (!t) throw new Error(`no tool ${name}`,);
    return t;
}

function mockCtx() {
    const forms = { list: vi.fn(), };
    const campaigns = { list: vi.fn(), };
    const social = { listPosts: vi.fn(), };
    const search = { adminSearch: vi.fn(), };
    const utils = { urlPreview: vi.fn(), };
    const ctx = {
        cms: { forms, campaigns, social, search, utils, },
        readonly: false,
        config: { baseUrl: 'http://x', apiKeyPreview: 'ssk_…', },
    } as unknown as ToolContext;
    return { ctx, forms, campaigns, social, search, utils, };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (t: ToolDef, args: any, ctx: ToolContext,) => t.handler(args, ctx,);

afterEach(() => {
    vi.restoreAllMocks();
},);

describe('list_forms', () => {
    it('maps the paginated result to {id, slug, title, status}', async () => {
        const { ctx, forms, } = mockCtx();
        forms.list.mockResolvedValue({
            data: [{ id: 'f1', slug: 'contact', title: 'Contact', status: 'published', extra: 'x', },],
            meta: { page: 1, limit: 20, total: 1, totalPages: 1, },
        },);
        const res = await call(tool('list_forms',), {}, ctx,) as { data: unknown[]; meta: unknown; };
        expect(res.data,).toEqual([{ id: 'f1', slug: 'contact', title: 'Contact', status: 'published', },],);
        expect(res.meta,).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1, },);
    },);
},);

describe('list_social_posts', () => {
    it('maps stored posts to the id/platform/externalId projection', async () => {
        const { ctx, social, } = mockCtx();
        social.listPosts.mockResolvedValue({
            data: [{ id: 's1', platform: 'youtube', externalId: 'yt1', content: 'hi', mediaUrl: 'http://x/v', publishedAt: 't', rawData: {}, },],
            meta: { page: 1, limit: 20, total: 1, totalPages: 1, },
        },);
        const res = await call(tool('list_social_posts',), { platform: 'youtube', }, ctx,) as { data: Record<string, unknown>[]; };
        expect(res.data[0],).toEqual({ id: 's1', platform: 'youtube', externalId: 'yt1', content: 'hi', mediaUrl: 'http://x/v', publishedAt: 't', },);
    },);
},);

describe('url_preview', () => {
    it('calls utils.urlPreview with { url }', async () => {
        const { ctx, utils, } = mockCtx();
        utils.urlPreview.mockResolvedValue({ title: 'T', },);
        await call(tool('url_preview',), { url: 'https://example.com', }, ctx,);
        expect(utils.urlPreview,).toHaveBeenCalledWith({ url: 'https://example.com', },);
    },);
},);

describe('search_site', () => {
    it('calls search.adminSearch with q and rest params', async () => {
        const { ctx, search, } = mockCtx();
        search.adminSearch.mockResolvedValue({ posts: [], },);
        await call(tool('search_site',), { q: 'hello', page: 2, }, ctx,);
        expect(search.adminSearch,).toHaveBeenCalledWith('hello', { page: 2, },);
    },);
},);
