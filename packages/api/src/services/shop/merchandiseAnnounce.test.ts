/**
 * Which body a merchandise announcement sends, and what its template can see.
 *
 * The rule under test is the one that was silently broken: an operator could
 * author a template for the `shop_new_merchandise` purpose and the announcement
 * would send the built-in layout anyway, because it never read the blocks.
 */
import { describe, expect, it, } from 'vitest';
import {
    buildAnnouncementContext,
    buildProductGridHtml,
    type PendingProduct,
    resolveAnnouncementBody,
} from './merchandiseAnnounce';

function product(over: Partial<PendingProduct> & { id: string; },): PendingProduct {
    return {
        title: 'Tee', slug: 'tee', priceCents: 2500,
        imageUrl: 'https://cdn.example/tee.jpg',
        createdAt: '2026-09-01T00:00:00.000Z',
        ...over,
    };
}

const PRODUCTS = [
    product({ id: 'a', title: 'Alpha Tee', slug: 'alpha-tee', priceCents: 2500, },),
    product({ id: 'b', title: 'Bravo Cap', slug: 'bravo-cap', priceCents: 1800, imageUrl: null, },),
];

describe('resolveAnnouncementBody', () => {
    it('uses the built-in layout when the operator has written no template', () => {
        const r = resolveAnnouncementBody(PRODUCTS, { currency: 'USD', },);
        expect(r.usedCustomTemplate,).toBe(false,);
        // The built-in body is the product grid plus a shop button.
        expect(r.blocks.length,).toBeGreaterThan(0,);
        expect(JSON.stringify(r.blocks,),).toContain('Alpha Tee',);
    },);

    it('uses the operator template when one exists, verbatim', () => {
        const custom = [{ blockType: 'rich_text', position: 0, settings: { content: 'Mine', }, },];
        const r = resolveAnnouncementBody(PRODUCTS, { currency: 'USD', customBlocks: custom, },);
        expect(r.usedCustomTemplate,).toBe(true,);
        expect(r.blocks,).toEqual(custom,);
        // The built-in grid must NOT be appended to a custom body — the
        // operator's layout is the whole layout.
        expect(JSON.stringify(r.blocks,),).not.toContain('Alpha Tee',);
    },);

    it('treats an empty block list as "no template", not as an empty email', () => {
        // An empty array is what the settings row holds before anyone edits it.
        const r = resolveAnnouncementBody(PRODUCTS, { currency: 'USD', customBlocks: [], },);
        expect(r.usedCustomTemplate,).toBe(false,);
        expect(JSON.stringify(r.blocks,),).toContain('Alpha Tee',);
    },);

    it('supplies the products either way, so a custom template can render them', () => {
        const withCustom = resolveAnnouncementBody(PRODUCTS, {
            currency: 'USD',
            customBlocks: [{ blockType: 'html', position: 0, settings: { content: '{{productsHtml}}', }, },],
        },);
        const builtIn = resolveAnnouncementBody(PRODUCTS, { currency: 'USD', },);
        expect((withCustom.context.products as unknown[]).length,).toBe(2,);
        expect((builtIn.context.products as unknown[]).length,).toBe(2,);
    },);
},);

describe('buildAnnouncementContext', () => {
    it('exposes a ready-to-use shape so a template needs no arithmetic or base URL', () => {
        const ctx = buildAnnouncementContext(PRODUCTS, 'USD',);
        const first = (ctx.products as Array<Record<string, unknown>>)[0];
        expect(first.title,).toBe('Alpha Tee',);
        expect(first.price,).toBe('$25.00',);
        expect(first.priceCents,).toBe(2500,);
        expect(String(first.url,),).toContain('/shop/alpha-tee',);
        expect(ctx.productCount,).toBe(2,);
        expect(String((ctx.shop as Record<string, unknown>).url,),).toContain('/shop',);
    },);

    it('gives a product with no image an empty string, not undefined', () => {
        // `{{p.imageUrl}}` in an <img src> must not render the word "undefined".
        const ctx = buildAnnouncementContext(PRODUCTS, 'USD',);
        expect((ctx.products as Array<Record<string, unknown>>)[1].imageUrl,).toBe('',);
    },);

    it('carries the built-in grid as productsHtml for use inside a custom body', () => {
        const ctx = buildAnnouncementContext(PRODUCTS, 'USD',);
        expect(ctx.productsHtml,).toBe(buildProductGridHtml(PRODUCTS, 'USD',),);
        expect(String(ctx.productsHtml,),).toContain('Alpha Tee',);
    },);
},);

describe('buildProductGridHtml', () => {
    it('pads an odd count so the last row keeps its two-up shape', () => {
        const html = buildProductGridHtml([PRODUCTS[0],], 'USD',);
        expect(html,).toContain('<td width="50%"></td>',);
    },);

    it('escapes product text', () => {
        const html = buildProductGridHtml(
            [product({ id: 'x', title: '<script>alert(1)</script>', },),],
            'USD',
        );
        expect(html,).not.toContain('<script>',);
        expect(html,).toContain('&lt;script&gt;',);
    },);

    it('formats the price in the shop currency', () => {
        expect(buildProductGridHtml(PRODUCTS, 'GBP',),).toContain('£25.00',);
        expect(buildProductGridHtml(PRODUCTS, 'EUR',),).toContain('€25.00',);
    },);

    it('omits the price line when a product has no priced variant', () => {
        const html = buildProductGridHtml([product({ id: 'y', priceCents: null, },),], 'USD',);
        expect(html,).not.toContain('$',);
    },);
},);
