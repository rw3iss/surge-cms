import { describe, expect, it, } from 'vitest';
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
    it('refuses CSS that could escape a declaration', () => {
        expect(galleryDisplayFrom({ gap: '1px;}body{x', radius: '4px"', },).desktop?.gap,).toBe('12px',);
    },);
},);
