import type { GalleryItem, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import {
    buildPublishBody, displayTitle, draftFromItems, EMPTY_OPTIONS, inheritedOverride, isDraftDirty, moveItem, patchOf, persistableDraft, rowsIn,
    type DraftItem,
} from './galleryDraft';

const item = (id: string, o: Partial<GalleryItem> = {},): GalleryItem => ({
    id, collectionId: null, access: { enabled: false, roles: [], tierIds: [], }, mediaId: `m-${id}`, media: null, title: id, caption: '', titleOverride: null, captionOverride: null, tags: [], sortOrder: 0,
    visibility: 'inherit', minTierId: null, comments: 'inherit', anonymousComments: 'inherit', url: `/gallery/${id}`,
    commentCount: 0, publishedAt: '', createdAt: '', updatedAt: '', ...o,
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

    it('carries the collection: saved rows mirror it, only NEW rows send it on publish', () => {
        const d = draftFromItems([item('a', { collectionId: 'c1', },), item('b',),],);
        expect(d.map((r,) => r.collectionId,),).toEqual(['c1', null,],);
        const body = buildPublishBody([...d, { key: 'm:z', mediaId: 'z', collectionId: 'c2', media: null, options: EMPTY_OPTIONS, }, { key: 'm:y', mediaId: 'y', media: null, options: EMPTY_OPTIONS, },],);
        expect(body.items[0],).not.toHaveProperty('collectionId',);
        expect(body.items[2],).toMatchObject({ mediaId: 'z', collectionId: 'c2', },);
        expect(body.items[3],).toMatchObject({ mediaId: 'y', collectionId: null, },);
        expect(rowsIn(d, 'c1',).map((r,) => r.key,),).toEqual(['a',],);
        expect(rowsIn(d, null,).map((r,) => r.key,),).toEqual(['b',],);
    },);

    it('sends the access rule and detects a change to it', () => {
        const saved2 = [item('a', { access: { enabled: true, roles: ['ambassador',], tierIds: [], }, },),];
        const d = draftFromItems(saved2,);
        expect(isDraftDirty(d, saved2,),).toBe(false,);
        expect(buildPublishBody(d,).items[0].access,).toEqual({ enabled: true, roles: ['ambassador',], tierIds: [], },);
        const edited = [{ ...d[0], options: { ...d[0].options, access: { enabled: true, roles: ['ambassador', 'sponsor',], tierIds: [], }, }, },];
        expect(isDraftDirty(edited, saved2,),).toBe(true,);
        // A draft stored before access existed still publishes an (empty) rule.
        const legacy = { ...EMPTY_OPTIONS, access: undefined, } as never;
        expect(patchOf(legacy,).access,).toEqual({ enabled: false, roles: [], tierIds: [], },);
    },);
},);

describe('upload titles', () => {
    const staged = (over: Partial<DraftItem> = {},): DraftItem => ({
        key: 'f:9', media: null, file: new File(['x',], 'IMG_2034.jpeg',), options: { ...EMPTY_OPTIONS, }, ...over,
    });

    it('a staged row shows its upload title, else the file name without extension', () => {
        expect(displayTitle(staged({ uploadTitle: 'Sunset', },),),).toBe('Sunset',);
        expect(displayTitle(staged(),),).toBe('IMG 2034',);
    },);

    it('an override equal to the media title is dropped so the item inherits it', () => {
        expect(inheritedOverride({ ...EMPTY_OPTIONS, titleOverride: ' Sunset ', }, 'Sunset',),).toBe('',);
        expect(inheritedOverride({ ...EMPTY_OPTIONS, titleOverride: 'Other', }, 'Sunset',),).toBe('Other',);
    },);

    it('the upload title is never persisted to the stored draft', () => {
        const p = persistableDraft([{ ...staged({ uploadTitle: 'T', }), file: undefined, mediaId: 'm', },],);
        expect('uploadTitle' in p[0]!,).toBe(false,);
    },);
},);
