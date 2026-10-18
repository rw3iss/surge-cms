import { describe, expect, it, } from 'vitest';
import { bulkPatches, filterRows, } from './galleryBulk';
import { EMPTY_OPTIONS, type DraftItem, } from './galleryDraft';

const row = (key: string, o: Partial<DraftItem> = {},): DraftItem => ({
    key, id: key, media: { id: `m-${key}`, type: 'image', title: key, } as never, options: { ...EMPTY_OPTIONS, }, collectionId: null, ...o,
});

describe('filterRows', () => {
    const rows = [
        row('a', { options: { ...EMPTY_OPTIONS, titleOverride: 'Sunset', tags: ['beach',], }, },),
        row('b', { media: { id: 'm-b', type: 'video', title: 'Talk', } as never, },),
    ];
    it('matches title / tag text, case-insensitive', () => {
        expect(filterRows(rows, 'BEACH', 'all',).map((r,) => r.key,),).toEqual(['a',],);
        expect(filterRows(rows, 'sun', 'all',).map((r,) => r.key,),).toEqual(['a',],);
    });
    it('filters by type', () => {
        expect(filterRows(rows, '', 'video',).map((r,) => r.key,),).toEqual(['b',],);
        expect(filterRows(rows, '', 'image',).map((r,) => r.key,),).toEqual(['a',],);
    });
});

describe('bulkPatches', () => {
    const rows = [row('a',), row('b', { collectionId: 'c1', },), { ...row('n',), id: undefined, }, row('x', { removed: true, },),];
    const all = new Set(['a', 'b', 'n', 'x',],);
    it('move: only rows not already there, skipping removed ones', () => {
        const { patches, } = bulkPatches(rows, all, { kind: 'move', collectionId: 'c1', },);
        expect([...patches.keys(),],).toEqual(['a', 'n',],);
    });
    it('visibility: tier keeps the tier, others clear it', () => {
        const t = bulkPatches(rows, new Set(['a',],), { kind: 'visibility', visibility: 'tier', minTierId: 't1', },);
        expect(t.patches.get('a',)!.options,).toMatchObject({ visibility: 'tier', minTierId: 't1', },);
        const m = bulkPatches(rows, new Set(['a',],), { kind: 'visibility', visibility: 'members', minTierId: 't1', },);
        expect(m.patches.get('a',)!.options,).toMatchObject({ visibility: 'members', minTierId: null, },);
    });
    it('addTag: normalised, no duplicates', () => {
        const r = [row('a', { options: { ...EMPTY_OPTIONS, tags: ['beach',], }, },),];
        expect(bulkPatches(r, new Set(['a',],), { kind: 'addTag', tag: ' Beach ', },).patches.size,).toBe(0,);
        expect(bulkPatches(r, new Set(['a',],), { kind: 'addTag', tag: 'Sky', },).patches.get('a',)!.options!.tags,).toEqual(['beach', 'sky',],);
    });
    it('remove: saved rows are marked, new rows leave the draft', () => {
        const { patches, drop, } = bulkPatches(rows, new Set(['a', 'n',],), { kind: 'remove', },);
        expect(patches.get('a',),).toEqual({ removed: true, deleteMedia: false, },);
        expect(drop,).toEqual(['n',],);
    });
});
