import { describe, expect, it, } from 'vitest';
import { availableSystemPages, getSystemPage, isSystemPageKey, pagePublicPath, SYSTEM_PAGES, } from './systemPages';

describe('SYSTEM_PAGES', () => {
    it('has unique keys and paths', () => {
        expect(new Set(SYSTEM_PAGES.map((p,) => p.key),).size,).toBe(SYSTEM_PAGES.length,);
        expect(new Set(SYSTEM_PAGES.map((p,) => p.path),).size,).toBe(SYSTEM_PAGES.length,);
    },);
    it('validates keys', () => {
        expect(isSystemPageKey('shop',),).toBe(true,);
        expect(isSystemPageKey('nope',),).toBe(false,);
        expect(getSystemPage('home',)?.path,).toBe('/',);
    },);
    it('offers core pages always and feature pages only when on', () => {
        const keys = availableSystemPages((f,) => f === 'shop',).map((p,) => p.key,);
        expect(keys,).toContain('home',);
        expect(keys,).toContain('shop',);
        expect(keys,).not.toContain('events',);
    },);
    it('serves a system page at its route', () => {
        expect(pagePublicPath({ slug: 'my-shop', systemPage: 'shop', },),).toBe('/shop',);
        expect(pagePublicPath({ slug: 'about', systemPage: null, },),).toBe('/about',);
    },);
},);
