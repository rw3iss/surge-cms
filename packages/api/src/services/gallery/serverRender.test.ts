/**
 * Server gallery resolution: the audience each renderer resolves with, and the
 * block pre-pass that feeds the synchronous emitters.
 */
import { GALLERY_ITEM_KIND, GALLERY_LIST_KIND, UNRESOLVED, } from '@sitesurge/types';
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const calls: { q: unknown; opts: unknown; }[] = [];
let enabled = true;

vi.mock('../settings', () => ({ isFeatureEnabledServer: async () => enabled, }),);
vi.mock('./items', () => ({
    list: async (q: unknown, opts: unknown,) => {
        calls.push({ q, opts, },);
        return { items: [{ id: 'i1', },], total: 1, page: 1, limit: 12, };
    },
    get: async (id: string, opts: unknown,) => {
        calls.push({ q: { id, }, opts, },);
        return { id, };
    },
}),);

const r = await import('./serverRender');
const memo = <T,>(_k: string, fn: () => Promise<T>,) => fn();

beforeEach(() => {
    calls.length = 0;
    enabled = true;
},);

describe('resolveGalleryFunction', () => {
    it('ignores other names', async () => {
        expect(await r.resolveGalleryFunction('post', [], {}, memo, 'site',),).toBe(UNRESOLVED,);
    },);
    it('SSR resolves as the anonymous site viewer', async () => {
        const ref = await r.resolveGalleryFunction('gallery', [4,], { tag: 'x', }, memo, 'site',) as { kind: string; data: unknown; };
        expect(ref.kind,).toBe(GALLERY_LIST_KIND,);
        expect(calls[0],).toEqual({ q: { limit: 4, tag: 'x', }, opts: { audience: 'site', viewer: null, }, },);
    },);
    it('email resolves public media only (email audience)', async () => {
        const ref = await r.resolveGalleryFunction('gallery', [ID,], {}, memo, 'email',) as { kind: string; };
        expect(ref.kind,).toBe(GALLERY_ITEM_KIND,);
        expect(calls[0]!.opts,).toEqual({ audience: 'email', },);
    },);
    it('feature off → empty list, no query', async () => {
        enabled = false;
        const ref = await r.resolveGalleryFunction('gallery', [], {}, memo, 'site',) as { data: unknown[]; };
        expect(ref.data,).toEqual([],);
        expect(calls,).toHaveLength(0,);
    },);
},);

describe('preResolveGalleryBlocks', () => {
    it('stashes items on gallery blocks only, without mutating the input', async () => {
        const blocks = [
            { type: 'rich_text', settings: {}, },
            { type: 'gallery', settings: { source: 'items', itemIds: [ID,], }, },
        ];
        const out = await r.preResolveGalleryBlocks(blocks, 'email',);
        expect(out[0],).toBe(blocks[0],);
        expect(r.resolvedItemsOf(out[1]!.settings,),).toEqual([{ id: 'i1', },],);
        expect(blocks[1]!.settings,).not.toHaveProperty(r.GALLERY_RESOLVED_KEY,);
        expect(calls[0],).toEqual({ q: { ids: [ID,], limit: 1, }, opts: { audience: 'email', }, },);
    },);
    it('a query source passes its query through', async () => {
        await r.preResolveGalleryBlocks([{ blockType: 'gallery', settings: { source: 'query', query: { type: 'video', limit: 3, }, }, },], 'site',);
        expect(calls[0]!.q,).toEqual({ type: 'video', limit: 3, },);
    },);
},);
