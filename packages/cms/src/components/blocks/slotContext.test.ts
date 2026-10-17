/** Web side of template slots: the resolver + the per-block helpers. */
import { describe, expect, it, vi, } from 'vitest';

// Solid's JSX event delegation touches `window.document` at module load; the
// test env is node (no DOM), so give it the minimum it reads.
vi.hoisted(() => {
    const g = globalThis as Record<string, unknown>;
    g.document ??= { addEventListener() {}, removeEventListener() {}, };
    g.window ??= { document: g.document, location: { pathname: '/', }, };
},);

const getOne = vi.fn();
const list = vi.fn();
vi.mock('../../services/cmsClient', () => ({
    cms: { entities: { getOne: (...a: unknown[]) => getOne(...a,), list: (...a: unknown[]) => list(...a,), }, },
}),);

// Renderers pulled in by the helpers' modules — not under test here (they reach the router).
vi.mock('../gallery/GalleryView', () => ({ default: () => null, }),);
vi.mock('./BlockRenderer', () => ({ BlockRenderer: () => null, }),);
vi.mock('../content/PostVisibilityBadge', () => ({ default: () => null, }),);
vi.mock('../content/PostTypeBadge', () => ({ default: () => null, }),);
vi.mock('../../stores/auth', () => ({ useUser: () => ({ user: null, }), }),);

const { slotRecordIds, slotRecordsFor, } = await import('./slotContext');
const { galleryBlockQuery, gallerySettingsOf, } = await import('./types/GalleryBlock');
const { slotPostSettings, } = await import('./posts/PostListRenderer');

const ctx = {
    slots: [
        { id: 'photos', entityType: 'gallery_item', array: true, },
        { id: 'lead', entityType: 'post', array: false, },
    ],
    bindings: {
        photos: { mode: 'query' as const, query: { limit: 4, }, },
        lead: { mode: 'list' as const, refs: ['b', 'a',], },
    },
};

describe('slotRecordsFor', () => {
    it('array slot → the entity block resolver (query)', async () => {
        list.mockResolvedValue({ data: [{ id: 'g1', }, { id: 'g2', },], },);
        const r = await slotRecordsFor(ctx, 'photos', 'gallery_item',);
        expect(r.ok && slotRecordIds(r.records,),).toEqual(['g1', 'g2',],);
        expect(list.mock.calls[0][0],).toBe('gallery_item',);
    },);
    it('non-array slot → one record', async () => {
        getOne.mockImplementation((_t: string, ref: string,) => Promise.resolve({ id: ref, },),);
        const r = await slotRecordsFor(ctx, 'lead', 'post',);
        expect(r.ok && slotRecordIds(r.records,),).toEqual(['b',],);
    },);
    it('missing / incompatible / unfilled', async () => {
        expect(await slotRecordsFor(ctx, 'x', 'post',),).toEqual({ ok: false, reason: 'missing', },);
        expect(await slotRecordsFor(ctx, 'photos', 'post',),).toEqual({ ok: false, reason: 'incompatible', },);
        expect(await slotRecordsFor({ slots: ctx.slots, bindings: {}, }, 'lead', 'post',),).toEqual({ ok: false, reason: 'unfilled', },);
    },);
},);

describe('block helpers', () => {
    it('Gallery keeps source slot and queries the slot ids in order', () => {
        const s = gallerySettingsOf({ source: 'slot', slotId: 'photos', },);
        expect(s.source,).toBe('slot',);
        expect(galleryBlockQuery(s, ['b', 'a',],),).toEqual({ ids: ['b', 'a',], limit: 2, },);
        expect(galleryBlockQuery(s, [],),).toBeNull();
    },);
    it('Posts slot → pinned ids, no query, no empty message', () => {
        expect(slotPostSettings({ source: 'slot', slotId: 'lead', count: 9, }, ['p2', 'p1',],),).toMatchObject({
            pinnedPostIds: ['p2', 'p1',], queryEnabled: false, showEmptyMessage: false,
        },);
    },);
},);
