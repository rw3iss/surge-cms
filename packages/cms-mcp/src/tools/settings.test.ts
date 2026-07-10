import { afterEach, describe, expect, it, vi, } from 'vitest';
import { settingsTools, } from './settings';
import type { ToolContext, ToolDef, } from '../tool';

function tool(name: string,): ToolDef {
    const t = settingsTools.find((x,) => x.name === name,);
    if (!t) throw new Error(`no tool ${name}`,);
    return t;
}

function mockCtx() {
    const settings = {
        getPublic: vi.fn(),
        getAll: vi.fn(),
        update: vi.fn().mockImplementation(async (body: unknown,) => ({ message: 'ok', echoed: body, }),),
        setKey: vi.fn(),
        deleteKey: vi.fn(),
        uninstallFeature: vi.fn().mockResolvedValue({ message: 'gone', droppedTables: ['x',], },),
    };
    const ctx = {
        cms: { settings, },
        readonly: false,
        config: { baseUrl: 'http://x', apiKeyPreview: 'ssk_…', },
    } as unknown as ToolContext;
    return { ctx, settings, };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (t: ToolDef, args: any, ctx: ToolContext,) => t.handler(args, ctx,);

afterEach(() => {
    vi.restoreAllMocks();
},);

describe('list_features', () => {
    it('maps getPublic().features to [{key, enabled}]', async () => {
        const { ctx, settings, } = mockCtx();
        settings.getPublic.mockResolvedValue({
            features: { posts: { enabled: true, }, shop: { enabled: false, }, },
        },);
        const res = await call(tool('list_features',), {}, ctx,);
        expect(res,).toEqual([
            { key: 'posts', enabled: true, },
            { key: 'shop', enabled: false, },
        ],);
    },);
},);

describe('update_settings', () => {
    it('passes only config fields (no features) to settings.update', async () => {
        const { ctx, settings, } = mockCtx();
        await call(tool('update_settings',), { siteName: 'New', contactEmail: 'a@b.c', }, ctx,);
        const [body,] = settings.update.mock.calls[0];
        expect(body,).toEqual({ siteName: 'New', contactEmail: 'a@b.c', },);
        expect(body,).not.toHaveProperty('features',);
    },);
},);

describe('get_setting', () => {
    it('returns the picked key row', async () => {
        const { ctx, settings, } = mockCtx();
        settings.getAll.mockResolvedValue({
            site_header: { value: { x: 1, }, updatedAt: 't', },
        },);
        const res = await call(tool('get_setting',), { key: 'site_header', }, ctx,) as Record<string, unknown>;
        expect(res.found,).toBe(true,);
        expect(res.key,).toBe('site_header',);
        expect(res.value,).toEqual({ x: 1, },);
    },);

    it('reports not found with the available keys', async () => {
        const { ctx, settings, } = mockCtx();
        settings.getAll.mockResolvedValue({ a: { value: 1, }, },);
        const res = await call(tool('get_setting',), { key: 'missing', }, ctx,) as Record<string, unknown>;
        expect(res.found,).toBe(false,);
        expect(res.keys,).toEqual(['a',],);
    },);
},);

describe('set_feature', () => {
    it('calls settings.update with { features: {x:true}, ...cascade }', async () => {
        const { ctx, settings, } = mockCtx();
        await call(tool('set_feature',), { feature: 'mailing_lists', enabled: true, enableDependencies: true, }, ctx,);
        const [body,] = settings.update.mock.calls[0];
        expect(body,).toEqual({ features: { mailing_lists: true, }, enableDependencies: true, },);
    },);
},);

describe('uninstall_feature', () => {
    it('calls settings.uninstallFeature(feature)', async () => {
        const { ctx, settings, } = mockCtx();
        await call(tool('uninstall_feature',), { feature: 'shop', }, ctx,);
        expect(settings.uninstallFeature,).toHaveBeenCalledWith('shop',);
    },);
},);
