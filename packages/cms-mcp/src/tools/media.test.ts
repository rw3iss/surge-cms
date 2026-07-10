import { afterEach, describe, expect, it, vi, } from 'vitest';
import { mediaTools, } from './media';
import type { ToolContext, ToolDef, } from '../tool';

function tool(name: string,): ToolDef {
    const t = mediaTools.find((x,) => x.name === name,);
    if (!t) throw new Error(`no tool ${name}`,);
    return t;
}

function mockCtx() {
    const media = {
        list: vi.fn(),
        getById: vi.fn(),
        upload: vi.fn().mockResolvedValue({ id: 'm1', url: 'http://x/m1.png', },),
        update: vi.fn(),
        remove: vi.fn(),
    };
    const ctx = {
        cms: { media, },
        readonly: false,
        config: { baseUrl: 'http://x', apiKeyPreview: 'ssk_…', },
    } as unknown as ToolContext;
    return { ctx, media, };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (t: ToolDef, args: any, ctx: ToolContext,) => t.handler(args, ctx,);

afterEach(() => {
    vi.restoreAllMocks();
},);

describe('upload_media', () => {
    it('throws when neither path nor url is given', async () => {
        const { ctx, } = mockCtx();
        await expect(call(tool('upload_media',), {}, ctx,),).rejects.toThrow(/exactly one/,);
    },);

    it('throws when both path and url are given', async () => {
        const { ctx, } = mockCtx();
        await expect(call(tool('upload_media',), { path: '/a.png', url: 'http://x/a.png', }, ctx,),)
            .rejects.toThrow(/exactly one/,);
    },);

    it('fetches a url into a Blob, calls media.upload, and returns id+url', async () => {
        const { ctx, media, } = mockCtx();
        const fakeBlob = new Blob([new Uint8Array([1, 2, 3,]),],);
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            blob: async () => fakeBlob,
        },);
        vi.stubGlobal('fetch', fetchMock,);

        const res = await call(tool('upload_media',), {
            url: 'https://cdn.example.com/img/hero.png', alt: 'Hero', caption: 'A hero',
        }, ctx,);

        expect(fetchMock,).toHaveBeenCalledWith('https://cdn.example.com/img/hero.png',);
        const [file, fields,] = media.upload.mock.calls[0];
        expect(file,).toBeInstanceOf(Blob,); // File extends Blob
        expect(fields,).toEqual({ alt: 'Hero', caption: 'A hero', },);
        expect(res,).toEqual({ id: 'm1', url: 'http://x/m1.png', },);
    },);
},);

describe('update_media', () => {
    it('passes only provided metadata fields', async () => {
        const { ctx, media, } = mockCtx();
        await call(tool('update_media',), { id: 'm1', alt: 'new alt', }, ctx,);
        const [id, body,] = media.update.mock.calls[0];
        expect(id,).toBe('m1',);
        expect(body,).toEqual({ alt: 'new alt', },);
    },);
},);
