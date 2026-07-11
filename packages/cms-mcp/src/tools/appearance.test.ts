import { afterEach, describe, expect, it, vi, } from 'vitest';
import { appearanceTools, } from './appearance';
import type { ToolContext, ToolDef, } from '../tool';

/** Look up a tool by name from the exported registry. */
function tool(name: string,): ToolDef {
    const t = appearanceTools.find((x,) => x.name === name,);
    if (!t) throw new Error(`no tool ${name}`,);
    return t;
}

/** Build a ToolContext whose cms.{settings,fonts}.* are mocks. */
function mockCtx() {
    const settings = {
        getAppearance: vi.fn(),
        appearance: vi.fn().mockImplementation(async (body: unknown,) => ({ message: 'ok', echoed: body, }),),
        listSwatches: vi.fn(),
        replaceSwatches: vi.fn().mockImplementation(async (body: unknown,) => body,),
        swatchUsages: vi.fn(),
    };
    const fonts = {
        list: vi.fn(),
        upload: vi.fn().mockImplementation(async (file: unknown, fields: unknown,) => ({ file, fields, }),),
        remove: vi.fn(),
    };
    const ctx = {
        cms: { settings, fonts, },
        readonly: false,
        config: { baseUrl: 'http://x', apiKeyPreview: 'ssk_…', },
    } as unknown as ToolContext;
    return { ctx, settings, fonts, };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (t: ToolDef, args: any, ctx: ToolContext,) => t.handler(args, ctx,);

afterEach(() => {
    vi.restoreAllMocks();
});

describe('update_appearance', () => {
    it('passes the fields straight through to settings.appearance', async () => {
        const { ctx, settings, } = mockCtx();
        await call(tool('update_appearance',), { primaryColor: '#e63946', fontSize: 16, }, ctx,);
        const [body,] = settings.appearance.mock.calls[0];
        expect(body,).toEqual({ primaryColor: '#e63946', fontSize: 16, },);
    },);
},);

describe('set_swatches', () => {
    it('calls replaceSwatches with the swatch array', async () => {
        const { ctx, settings, } = mockCtx();
        await call(tool('set_swatches',), { swatches: [{ id: 'brand', hex: '#e63946', name: 'Brand', },], }, ctx,);
        const [body,] = settings.replaceSwatches.mock.calls[0];
        expect(body,).toEqual([{ id: 'brand', hex: '#e63946', name: 'Brand', },],);
    },);
},);

describe('upload_font', () => {
    it('throws when neither path nor url is given', async () => {
        const { ctx, } = mockCtx();
        await expect(call(tool('upload_font',), {}, ctx,),).rejects.toThrow(/exactly one/,);
    },);

    it('throws when both path and url are given', async () => {
        const { ctx, } = mockCtx();
        await expect(call(tool('upload_font',), { path: '/a.woff2', url: 'http://x/a.woff2', }, ctx,),)
            .rejects.toThrow(/exactly one/,);
    },);

    it('fetches a url into a Blob and calls fonts.upload with fields', async () => {
        const { ctx, fonts, } = mockCtx();
        const fakeBlob = new Blob([new Uint8Array([1, 2, 3,]),],);
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            blob: async () => fakeBlob,
        },);
        vi.stubGlobal('fetch', fetchMock,);

        await call(tool('upload_font',), {
            url: 'https://cdn.example.com/fonts/Inter.woff2', familyName: 'Inter', customId: 'inter',
        }, ctx,);

        expect(fetchMock,).toHaveBeenCalledWith('https://cdn.example.com/fonts/Inter.woff2',);
        const [file, fields,] = fonts.upload.mock.calls[0];
        expect(file,).toBeInstanceOf(Blob,); // File extends Blob
        expect(fields,).toEqual({ familyName: 'Inter', customId: 'inter', },);
    },);
},);
