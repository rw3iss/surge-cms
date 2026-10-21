import { describe, expect, it, } from 'vitest';
import { DEFAULT_GALLERY_BLOCK_SETTINGS, galleryItemRadius, galleryMasonryColumns, galleryMasonryItemHeight, } from '../types/gallery';
import { itemRadiusCss, } from '../utils/blockStyleCss';
import { galleryCallFor, galleryDisplayFrom, } from './galleryFunctions';

const ID = '0f0e0d0c-0b0a-4908-8706-050403020100';

describe('galleryCallFor', () => {
    it('ignores other functions', () => {
        expect(galleryCallFor('post', [],),).toBeNull();
    },);
    it('one id = a single item', () => {
        expect(galleryCallFor('gallery', [ID,],),).toEqual({ query: { ids: [ID,], }, single: true, },);
    },);
    it('positional type + limit, named query keys win', () => {
        expect(galleryCallFor('gallery', ['video', 4,], { sort: 'newest', tag: 'events', },),).toEqual({
            query: { type: 'video', limit: 4, sort: 'newest', tag: 'events', }, single: false,
        },);
    },);
    it('defaults a list to 12 and drops bad sort values', () => {
        expect(galleryCallFor('gallery', [], { sort: 'bogus', },)?.query,).toEqual({ limit: 12, },);
    },);
},);

describe('galleryDisplayFrom', () => {
    it('maps layout knobs per breakpoint, numbers to px', () => {
        const d = galleryDisplayFrom({ layout: 'row', itemsPerPage: '3', gap: 8, mobileLayout: 'column', mobileColumns: 1, autoplay: 'true', interval: 4, },);
        expect(d.desktop,).toMatchObject({ layout: 'row', itemsPerPage: 3, gap: '8px', },);
        expect(d.mobile,).toMatchObject({ layout: 'column', columns: 1, },);
        expect(d.autoplay,).toBe(true,);
        expect(d.autoplayInterval,).toBe(4,);
    },);
    it('accepts the masonry layout on both breakpoints', () => {
        const d = galleryDisplayFrom({ layout: 'masonry', columns: 3, mobileLayout: 'masonry', mobileColumns: 2, },);
        expect(d.desktop,).toMatchObject({ layout: 'masonry', columns: 3, },);
        expect(d.mobile,).toMatchObject({ layout: 'masonry', columns: 2, },);
    },);
    it('refuses CSS that could escape a declaration', () => {
        expect(galleryDisplayFrom({ gap: '1px;}body{x', radius: '4px"', },).desktop?.gap,).toBe('12px',);
    },);
    it('item radius: itemRadius (or the legacy radius), 0 kept, bare number = px, unset = site', () => {
        expect(galleryDisplayFrom({ itemRadius: '0', },).itemRadius,).toBe('0px',);
        expect(galleryDisplayFrom({ itemRadius: 12, },).itemRadius,).toBe('12px',);
        expect(galleryDisplayFrom({ radius: '1rem', },).itemRadius,).toBe('1rem',);
        expect(galleryDisplayFrom({},).itemRadius,).toBeUndefined();
        expect(galleryDisplayFrom({ itemRadius: '4px"', },).itemRadius,).toBeUndefined();
    },);
},);

describe('galleryItemRadius / itemRadiusCss', () => {
    it('prefers itemRadius, falls back to the legacy radius, keeps 0', () => {
        expect(galleryItemRadius({ itemRadius: '0', radius: '9px', },),).toBe('0px',);
        expect(galleryItemRadius({ radius: '9px', },),).toBe('9px',);
        expect(galleryItemRadius({ itemRadius: '', },),).toBeUndefined();
        expect(itemRadiusCss(0,),).toBe('0px',);
        expect(itemRadiusCss('8px 0',),).toBe('8px 0',);
        expect(itemRadiusCss('1px;}x{',),).toBeUndefined();
    },);
},);

describe('gallery(featured=…)', () => {
    it('maps featured=true / false; absent leaves it unset', () => {
        expect(galleryCallFor('gallery', [], { featured: true, },)!.query.featured,).toBe(true,);
        expect(galleryCallFor('gallery', [], { featured: 'false', },)!.query.featured,).toBe(false,);
        expect(galleryCallFor('gallery', [], {},)!.query.featured,).toBeUndefined();
    },);
},);

describe('gallery(dir=…) + CSS lengths', () => {
    it('maps dir=desc / asc, ignores anything else', () => {
        expect(galleryCallFor('gallery', [], { sort: 'title', dir: 'desc', },)!.query.dir,).toBe('desc',);
        expect(galleryCallFor('gallery', [], { dir: 'sideways', },)!.query.dir,).toBeUndefined();
    },);
    it('refuses unsafe CSS lengths (url(, comments, escapes) with the shared rule', () => {
        expect(galleryDisplayFrom({ gap: 'url(x)', },).desktop?.gap,).toBe(DEFAULT_GALLERY_BLOCK_SETTINGS.desktop?.gap,);
        expect(galleryDisplayFrom({ itemWidth: '1px/**/', },).desktop?.itemWidth,).toBeUndefined();
        expect(galleryDisplayFrom({ itemWidth: '240', },).desktop?.itemWidth,).toBe('240px',);
    },);
},);

describe('galleryMasonryItemHeight', () => {
    const item = { title: 'T', caption: 'C', media: { width: 200, height: 100, }, };
    it('media at the column width + the text outside the picture (none for an overlay)', () => {
        expect(galleryMasonryItemHeight(item, 200,),).toBe(100,);
        expect(galleryMasonryItemHeight(item, 200, { showTitles: true, showCaptions: true, extra: 10, },),).toBe(152,);
        expect(galleryMasonryItemHeight(item, 200, { showTitles: true, overlay: true, },),).toBe(100,);
    },);
    it('a titled item sends the next one to the other column', () => {
        const items = [{ ...item, }, { media: { width: 200, height: 100, }, }, { media: { width: 200, height: 100, }, },];
        const h = (i: typeof items[number],) => galleryMasonryItemHeight(i, 200, { showTitles: true, showCaptions: true, },);
        expect(galleryMasonryColumns(items, 2, h,),).toEqual([[0,], [1, 2,],],);
    },);
},);
