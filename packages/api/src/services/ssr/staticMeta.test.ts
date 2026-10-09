import { describe, expect, it, vi, } from 'vitest';

const rows: Record<string, unknown[]> = {};
vi.mock('../../db', () => ({
    query: vi.fn(async (sql: string,) => {
        if (sql.includes('FROM shop_products')) return { rows: rows.product ?? [], };
        if (sql.includes('FROM events')) return { rows: rows.event ?? [], };
        if (sql.includes('FROM forms')) throw new Error('relation "forms" does not exist');
        return { rows: [], };
    },),
}),);

import { resolveStaticMeta, } from './staticMeta';

const ctx = (path: string,) => ({
    path, url: `https://site.test${path}`, siteUrl: 'https://site.test', siteName: 'Surge', siteDescription: 'News', logo: 'https://cdn/logo.png',
});

describe('resolveStaticMeta', () => {
    it('gives /subscribe its own indexable title, description and JSON-LD', async () => {
        const m = (await resolveStaticMeta(ctx('/subscribe',),))!;
        expect(m.title,).toBe('Membership',);
        expect(m.description,).toContain('Surge',);
        expect(m.noindex,).toBeFalsy();
        expect(m.canonical,).toBe('https://site.test/subscribe',);
        expect(m.image,).toBe('https://cdn/logo.png',);
    },);

    it('marks account screens and private pages noindex', async () => {
        expect((await resolveStaticMeta(ctx('/login',),))!.noindex,).toBe(true,);
        expect((await resolveStaticMeta(ctx('/tickets/ABC',),))!.noindex,).toBe(true,);
        expect((await resolveStaticMeta(ctx('/shop/cart',),))!.noindex,).toBe(true,);
    },);

    it('reads a product: title, image, Product JSON-LD with price', async () => {
        rows.product = [{ id: 'p', title: 'Tee', description: '<p>Soft <b>cotton</b></p>', meta_title: null, meta_description: null, image: 'https://cdn/tee.jpg', price_cents: 2500, },];
        const m = (await resolveStaticMeta(ctx('/shop/tee',),))!;
        expect(m.title,).toBe('Tee',);
        expect(m.description,).toBe('Soft cotton',);
        expect(m.type,).toBe('product',);
        expect(m.image,).toBe('https://cdn/tee.jpg',);
        expect(JSON.stringify(m.jsonLd,),).toContain('"price":"25.00"',);
    },);

    it('reads an event with Markdown description stripped', async () => {
        rows.event = [{ title: 'Gala', description: '**Big** night', starts_at: '2026-11-01T20:00:00Z', ends_at: null, location: 'Hall', featured_image: null, url: null, },];
        const m = (await resolveStaticMeta(ctx('/events/gala',),))!;
        expect(m.description,).toBe('Big night',);
        expect(JSON.stringify(m.jsonLd,),).toContain('"@type":"Event"',);
    },);

    it('returns null for a missing record or a missing feature table', async () => {
        rows.product = [];
        expect(await resolveStaticMeta(ctx('/shop/nope',),),).toBeNull();
        expect(await resolveStaticMeta(ctx('/forms/x',),),).toBeNull();
        expect(await resolveStaticMeta(ctx('/unknown',),),).toBeNull();
    },);
},);
