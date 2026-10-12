import type { GalleryItem, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import { buildPublishBody, draftFromItems, EMPTY_OPTIONS, isDraftDirty, moveItem, persistableDraft, type DraftItem, } from './galleryDraft';

const item = (id: string, o: Partial<GalleryItem> = {},): GalleryItem => ({
    id, mediaId: `m-${id}`, media: null, title: id, caption: '', titleOverride: null, captionOverride: null, tags: [], sortOrder: 0,
    visibility: 'inherit', minTierId: null, comments: 'inherit', anonymousComments: 'inherit', url: `/gallery/${id}`,
    commentCount: 0, createdAt: '', updatedAt: '', ...o,
});

describe('gallery draft', () => {
    const saved = [item('a',), item('b',),];

    it('is clean when unchanged', () => {
        expect(isDraftDirty(draftFromItems(saved,), saved,),).toBe(false,);
    },);

    it('detects reorder, option edit, add and removal', () => {
        const d = draftFromItems(saved,);
        expect(isDraftDirty(moveItem(d, 0, 1,), saved,),).toBe(true,);
        expect(isDraftDirty([{ ...d[0], options: { ...d[0].options, titleOverride: 'X', }, }, d[1],], saved,),).toBe(true,);
        expect(isDraftDirty([...d, { key: 'm:z', mediaId: 'z', media: null, options: EMPTY_OPTIONS, },], saved,),).toBe(true,);
        expect(isDraftDirty([d[0], { ...d[1], removed: true, },], saved,),).toBe(true,);
    },);

    it('builds the publish body in draft order, new by mediaId/uploaded id, removals with deleteMedia', () => {
        const d: DraftItem[] = [
            { key: 'f:1', media: null, file: new File(['x',], 'a.png',), options: EMPTY_OPTIONS, },
            ...draftFromItems(saved,),
            { key: 'm:z', mediaId: 'z', media: null, options: { ...EMPTY_OPTIONS, visibility: 'tier', minTierId: 't1', }, },
        ];
        d[2] = { ...d[2], removed: true, deleteMedia: true, };
        const body = buildPublishBody(d, new Map([['f:1', 'up1',],],),);
        expect(body.items.map((i,) => i.id ?? i.mediaId,),).toEqual(['up1', 'a', 'z',],);
        expect(body.items[2],).toMatchObject({ visibility: 'tier', minTierId: 't1', titleOverride: null, },);
        expect(body.remove,).toEqual([{ id: 'b', deleteMedia: true, },],);
    },);

    it('refuses a staged file that was not uploaded', () => {
        expect(() => buildPublishBody([{ key: 'f:1', media: null, file: new File(['x',], 'a.png',), options: EMPTY_OPTIONS, },],),).toThrow(/a\.png/,);
    },);

    it('drops staged files from the persisted draft', () => {
        const p = persistableDraft([{ key: 'f:1', media: null, file: new File(['x',], 'a.png',), options: EMPTY_OPTIONS, }, ...draftFromItems(saved,),],);
        expect(p.map((x,) => x.key,),).toEqual(['a', 'b',],);
    },);
},);
