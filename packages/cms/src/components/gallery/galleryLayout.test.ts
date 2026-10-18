import { describe, expect, it, } from 'vitest';
import { DEFAULT_GALLERY_APPEARANCE, galleryMasonryColumns, } from '@sitesurge/types';
import {
    activePage, aspectRatio, entityQueryToGalleryQuery, galleryQueryToEntityQuery, gridTemplateColumns, masonryPlan, masonryTileAspect, maxStart, mediaAspectOf, nextStart, pageStarts, pageStyle, prevStart, ratioOf, resolveLayout, tileFrame,
} from './galleryLayout';

describe('resolveLayout', () => {
    it('mobile values win per key on mobile only', () => {
        const d = { layout: 'row' as const, itemsPerPage: 4, gap: '20px', };
        const m = { itemsPerPage: 1, };
        expect(resolveLayout(d, m, false,),).toMatchObject({ layout: 'row', itemsPerPage: 4, gap: '20px', },);
        expect(resolveLayout(d, m, true,),).toMatchObject({ layout: 'row', itemsPerPage: 1, gap: '20px', },);
    },);
    it('defaults: grid, square, cover, carousel = 1 per page', () => {
        expect(resolveLayout(undefined, undefined, false,),).toMatchObject({ layout: 'grid', aspect: 'square', fit: 'cover', columns: null, },);
        expect(resolveLayout({ layout: 'carousel', }, undefined, false,).itemsPerPage,).toBe(1,);
    },);
},);

describe('paging', () => {
    it('snaps to the last full page before wrapping', () => {
        // 11 items, 3 per page, step 3 → starts 0,3,6,8
        expect(maxStart(11, 3,),).toBe(8,);
        expect(nextStart(6, 3, 11, 3, true,),).toBe(8,);
        expect(nextStart(8, 3, 11, 3, true,),).toBe(0,);
        expect(nextStart(8, 3, 11, 3, false,),).toBe(8,);
        expect(prevStart(0, 3, 11, 3, true,),).toBe(8,);
        expect(pageStarts(11, 3, 3,),).toEqual([0, 3, 6, 8,],);
        expect(activePage([0, 3, 6, 8,], 7,),).toBe(2,);
    },);
    it('fewer items than a page = one page', () => {
        expect(pageStarts(2, 4, 1,),).toEqual([0,],);
    },);
},);

describe('aspect + page style', () => {
    it('maps aspects', () => {
        expect(aspectRatio('16:9',),).toBe('16 / 9',);
        expect(aspectRatio('original',),).toBeUndefined();
    },);
    it('site tokens by default, custom values when chosen', () => {
        expect(pageStyle(DEFAULT_GALLERY_APPEARANCE,)['padding-inline'],).toBe('var(--site-gutter, 16px)',);
        const s = pageStyle({ ...DEFAULT_GALLERY_APPEARANCE, gutter: 'custom', customGutter: '40px', maxWidth: 'custom', customMaxWidth: '', },);
        expect(s['padding-inline'],).toBe('40px',);
        expect(s['max-width'],).toBeUndefined();
    },);
},);

describe('entity query ↔ gallery query', () => {
    it('maps virtual filters, search and limit', () => {
        expect(entityQueryToGalleryQuery({ search: ' cats ', filter: { type: { op: 'eq', value: 'video', }, tag: ['a', 'b',], sort: 'newest', }, }, 8,),)
            .toEqual({ type: 'video', sort: 'newest', tag: 'a,b', search: 'cats', limit: 8, },);
    },);
    it('round-trips', () => {
        const q = { type: 'image' as const, tag: 'x', sort: 'random' as const, limit: 5, };
        expect(entityQueryToGalleryQuery(galleryQueryToEntityQuery(q,),),).toEqual(q,);
    },);
},);

describe('gridTemplateColumns', () => {
    it('unchanged without an item width', () => {
        expect(gridTemplateColumns(3, null,),).toBe('repeat(3, minmax(0, 1fr))',);
        expect(gridTemplateColumns(null, null, 180,),).toBe('repeat(auto-fill, minmax(min(180px, 100%), 1fr))',);
    },);
    it('an item width caps each column so the grid can be aligned', () => {
        expect(gridTemplateColumns(3, '200px',),).toBe('repeat(3, minmax(0, 200px))',);
        // auto-FIT: empty tracks collapse, so a short row can be centred.
        expect(gridTemplateColumns(null, '200px',),).toBe('repeat(auto-fit, min(200px, 100%))',);
    },);
},);

describe('tileFrame (Fit = contain hugs the media)', () => {
    it('cover, or no box, keeps the box', () => {
        expect(tileFrame('cover', '16 / 9', '300px', 0.5625,),).toEqual({ kind: 'box', },);
        expect(tileFrame('contain', undefined, null, 0.5625,),).toEqual({ kind: 'box', },);
    },);
    it('contain + height: as wide as the height allows', () => {
        expect(tileFrame('contain', '16 / 9', '300px', 0.5625,),).toEqual({ kind: 'hug', width: 'min(100%, calc(300px * 0.5625))', aspectRatio: '0.5625', },);
    },);
    it('contain + aspect only: a share of the width', () => {
        expect(tileFrame('contain', '1 / 1', null, 0.5,),).toEqual({ kind: 'hug', width: '50%', aspectRatio: '0.5', },);
        expect(tileFrame('contain', '1 / 1', null, 2,),).toMatchObject({ width: '100%', },);
    },);
    it('contain, unknown aspect: natural inside the height limit', () => {
        expect(tileFrame('contain', '16 / 9', '300px', null,),).toEqual({ kind: 'natural', maxHeight: '300px', },);
    },);
    it('ratioOf / mediaAspectOf', () => {
        expect(ratioOf('16 / 9',),).toBeCloseTo(1.7778, 3,);
        expect(ratioOf(undefined,),).toBeNull();
        expect(mediaAspectOf({ width: 1080, height: 1920, },),).toBe(0.5625,);
        expect(mediaAspectOf({ width: null, height: 10, },),).toBeNull();
    },);
},);

describe('masonry', () => {
    it('masonryPlan: a column count → stacks; else a CSS column flow at item width / thumb size', () => {
        expect(masonryPlan(3, null,),).toEqual({ kind: 'stacks', columns: 3, },);
        expect(masonryPlan(2, '240px',),).toEqual({ kind: 'stacks', columns: 2, },);
        expect(masonryPlan(null, '240px',),).toEqual({ kind: 'flow', columnWidth: '240px', },);
        expect(masonryPlan(null, null, 180,),).toEqual({ kind: 'flow', columnWidth: '180px', },);
    },);
    it('masonryTileAspect: the media aspect, unknown → natural', () => {
        expect(masonryTileAspect({ width: 800, height: 600, },),).toBe('800 / 600',);
        expect(masonryTileAspect({ width: null, height: 600, },),).toBeUndefined();
        expect(masonryTileAspect(null,),).toBeUndefined();
    },);
    it('mobile masonry columns fall back to desktop per key', () => {
        expect(resolveLayout({ layout: 'masonry', columns: 4, }, { columns: 2, }, true,),).toMatchObject({ layout: 'masonry', columns: 2, },);
        expect(resolveLayout({ layout: 'masonry', columns: 4, }, {}, true,),).toMatchObject({ layout: 'masonry', columns: 4, },);
    },);
    it('galleryMasonryColumns: each item to the shortest column (ties → leftmost), unknown aspect = square', () => {
        const m = (w: number, h: number,) => ({ media: { width: w, height: h, }, });
        // heights: a 2, b 0.5 → col1, c 0.5 → col1 (0.5<2), d 1 (unknown) → col1 (1<2), e → col0? col1 = 2 = col0 → leftmost.
        const cols = galleryMasonryColumns([m(1, 2,), m(2, 1,), m(2, 1,), m(0, 0,), m(1, 1,),], 2,);
        expect(cols,).toEqual([[0, 4,], [1, 2, 3,],],);
        expect(galleryMasonryColumns([m(1, 1,),], 3,),).toEqual([[0,], [], [],],);
    },);
},);
