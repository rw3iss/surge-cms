import type { GalleryItem, } from '@sitesurge/types';
import { describe, expect, it, } from 'vitest';
import {
    basedOnOf, buildPublishBody, displayTitle, draftFromItems, EMPTY_OPTIONS, inheritedOverride, isDraftDirty, moveItem, patchOf, persistableDraft, rowsIn,
    type DraftItem,
} from './galleryDraft';

const item = (id: string, o: Partial<GalleryItem> = {},): GalleryItem => ({
    id, collectionId: null, access: { enabled: false, roles: [], tierIds: [], }, mediaId: `m-${id}`, media: null, mediaType: null, title: id, caption: '', titleOverride: null, captionOverride: null, tags: [], sortOrder: 0,
    visibility: 'inherit', minTierId: null, comments: 'inherit', anonymousComments: 'inherit', url: `/gallery/${id}`, hiddenInGallery: false, isFeatured: false,
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

    it('a drafted move of a saved item is dirty (C5)', () => {
        const d = draftFromItems(saved,);
        expect(isDraftDirty([{ ...d[0], collectionId: 'c9', }, d[1],], saved,),).toBe(true,);
    },);

    it('basedOnOf: the newest updatedAt + the count (C4)', () => {
        expect(basedOnOf([item('a', { updatedAt: '2026-10-01T00:00:00.000Z', },), item('b', { updatedAt: '2026-10-02T00:00:00.000Z', },),],),)
            .toEqual({ updatedAt: '2026-10-02T00:00:00.000Z', count: 2, },);
        expect(basedOnOf([],),).toEqual({ updatedAt: null, count: 0, },);
    },);

    it('refuses a staged file that was not uploaded', () => {
        expect(() => buildPublishBody([{ key: 'f:1', media: null, file: new File(['x',], 'a.png',), options: EMPTY_OPTIONS, },],),).toThrow(/a\.png/,);
    },);

    it('drops staged files from the persisted draft', () => {
        const p = persistableDraft([{ key: 'f:1', media: null, file: new File(['x',], 'a.png',), options: EMPTY_OPTIONS, }, ...draftFromItems(saved,),],);
        expect(p.map((x,) => x.key,),).toEqual(['a', 'b',],);
    },);

    it('carries the collection: drafted for saved AND new rows, sent on publish (C5)', () => {
        const d = draftFromItems([item('a', { collectionId: 'c1', },), item('b',),],);
        expect(d.map((r,) => r.collectionId,),).toEqual(['c1', null,],);
        const body = buildPublishBody([...d, { key: 'm:z', mediaId: 'z', collectionId: 'c2', media: null, options: EMPTY_OPTIONS, }, { key: 'm:y', mediaId: 'y', media: null, options: EMPTY_OPTIONS, },],);
        expect(body.items[0],).toMatchObject({ id: 'a', collectionId: 'c1', },);
        expect(body.items[1],).toMatchObject({ id: 'b', collectionId: null, },);
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

    it('carries "Hide from gallery": restored from the item, dirty when flipped, sent on publish', () => {
        const saved3 = [item('a', { hiddenInGallery: true, },),];
        const d = draftFromItems(saved3,);
        expect(d[0].options.hiddenInGallery,).toBe(true,);
        expect(isDraftDirty(d, saved3,),).toBe(false,);
        expect(buildPublishBody(d,).items[0].hiddenInGallery,).toBe(true,);
        const flipped = [{ ...d[0], options: { ...d[0].options, hiddenInGallery: false, }, },];
        expect(isDraftDirty(flipped, saved3,),).toBe(true,);
        expect(buildPublishBody(flipped,).items[0].hiddenInGallery,).toBe(false,);
        // A new row publishes it too; a draft stored before the field existed publishes "not hidden".
        expect(buildPublishBody([{ key: 'm:z', mediaId: 'z', media: null, options: { ...EMPTY_OPTIONS, hiddenInGallery: true, }, },],).items[0].hiddenInGallery,).toBe(true,);
        expect(patchOf({ ...EMPTY_OPTIONS, hiddenInGallery: undefined, } as never,).hiddenInGallery,).toBe(false,);
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

describe('is featured', () => {
    it('round-trips through the draft into the publish body', () => {
        const draft = draftFromItems([item('a', { isFeatured: true, },), item('b',),],);
        expect(draft.map((d,) => d.options.isFeatured,),).toEqual([true, false,],);
        expect(buildPublishBody(draft,).items.map((i,) => (i as { isFeatured?: boolean; }).isFeatured,),).toEqual([true, false,],);
    },);
},);
