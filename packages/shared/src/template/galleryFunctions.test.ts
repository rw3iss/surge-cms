import { describe, expect, it, } from 'vitest';
import { galleryItemRadius, } from '../types/gallery';
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
