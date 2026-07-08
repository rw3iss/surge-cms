import { describe, expect, it, vi, } from 'vitest';
import { createClient, } from '../index';

function jsonResponse(data: unknown, meta?: unknown, status = 200,): Response {
    const body: Record<string, unknown> = { success: status < 400, data, };
    if (meta) body.meta = meta;
    return new Response(JSON.stringify(body,), {
        status, headers: { 'content-type': 'application/json', },
    },);
}

describe('shop module', () => {
    it('products.list() GETs /shop/products with all=true and returns Paginated', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            jsonResponse([], { page: 1, limit: 20, total: 0, totalPages: 0, },),
        );
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out = await cms.shop.products.list();
        expect(out.data,).toEqual([],);
        expect(out.meta.total,).toBe(0,);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/products?all=true',);
        expect((init as RequestInit).method,).toBe('GET',);
    },);

    it('products.listPublic() GETs /shop/products WITHOUT all=true', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            jsonResponse([], { page: 1, limit: 20, total: 0, totalPages: 0, },),
        );
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        await cms.shop.products.listPublic();
        const [url,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/products',);
    },);

    it('products.getBySlug() GETs the slug path', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'p1', slug: 'shirt', },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        await cms.shop.products.getBySlug('shirt',);
        const [url,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/products/slug/shirt',);
    },);

    it('products.create() POSTs /shop/products with the body', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'p1', }, undefined, 201,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        await cms.shop.products.create({ title: 'Shirt', slug: 'shirt', },);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/products',);
        expect((init as RequestInit).method,).toBe('POST',);
        expect(JSON.parse((init as RequestInit).body as string,),).toEqual({ title: 'Shirt', slug: 'shirt', },);
    },);

    it('categories.getBySlug() GETs the category slug path', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ category: {}, products: [], },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        await cms.shop.categories.getBySlug('apparel',);
        const [url,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/categories/slug/apparel',);
    },);

    it('tags.list() GETs /shop/tags', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(['sale',],),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out = await cms.shop.tags.list();
        expect(out,).toEqual(['sale',],);
        const [url,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/tags',);
    },);

    it('reviews.list() GETs /shop/products/:id/reviews and returns Paginated', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            jsonResponse([], { page: 1, limit: 20, total: 0, totalPages: 0, },),
        );
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out = await cms.shop.reviews.list('p1',);
        expect(out.data,).toEqual([],);
        expect(out.meta.total,).toBe(0,);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/products/p1/reviews',);
        expect((init as RequestInit).method,).toBe('GET',);
    },);

    it('reviews.create() POSTs /shop/products/:id/reviews with the body', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'r1', }, undefined, 201,),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        await cms.shop.reviews.create('p1', { rating: 5, title: 'Great', },);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/products/p1/reviews',);
        expect((init as RequestInit).method,).toBe('POST',);
        expect(JSON.parse((init as RequestInit).body as string,),).toEqual({ rating: 5, title: 'Great', },);
    },);

    it('reviews.moderate() PUTs /shop/reviews/:id with the status', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'r1', status: 'approved', },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        await cms.shop.reviews.moderate('r1', { status: 'approved', },);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/reviews/r1',);
        expect((init as RequestInit).method,).toBe('PUT',);
        expect(JSON.parse((init as RequestInit).body as string,),).toEqual({ status: 'approved', },);
    },);

    it('checkout.create() POSTs /shop/checkout with the body', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            jsonResponse({ clientSecret: 'cs', orderId: 'o1', orderNumber: 'SS-1', totalCents: 2500, }, undefined, 201,),
        );
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out = await cms.shop.checkout.create({
            items: [{ variantId: 'v1', qty: 1, },], customerEmail: 'a@b.com',
        },);
        expect(out.orderNumber,).toBe('SS-1',);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/checkout',);
        expect((init as RequestInit).method,).toBe('POST',);
        expect(JSON.parse((init as RequestInit).body as string,),).toEqual({
            items: [{ variantId: 'v1', qty: 1, },], customerEmail: 'a@b.com',
        },);
    },);

    it('orders.list() GETs /shop/orders and returns Paginated', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            jsonResponse([], { page: 1, limit: 20, total: 0, totalPages: 0, },),
        );
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out = await cms.shop.orders.list();
        expect(out.data,).toEqual([],);
        expect(out.meta.total,).toBe(0,);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/orders',);
        expect((init as RequestInit).method,).toBe('GET',);
    },);

    it('orders.getByNumber() GETs /shop/orders/number/:orderNumber', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'o1', orderNumber: 'SS-1', },),);
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        await cms.shop.orders.getByNumber('SS-1',);
        const [url,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/orders/number/SS-1',);
    },);

    it('settings.getPublic() GETs /shop/settings', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            jsonResponse({ settings: { currency: 'usd', }, appearance: { gridColumns: 3, }, },),
        );
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        const out = await cms.shop.settings.getPublic();
        expect(out.settings.currency,).toBe('usd',);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/settings',);
        expect((init as RequestInit).method,).toBe('GET',);
    },);

    it('settings.update() PUTs /shop/settings with the body', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            jsonResponse({ settings: { currency: 'eur', }, appearance: { gridColumns: 4, }, },),
        );
        const cms = createClient({ baseUrl: 'http://api', fetch: fetchImpl as never, auth: { store: null, }, },);
        await cms.shop.settings.update({ settings: { currency: 'eur', }, appearance: { gridColumns: 4, }, },);
        const [url, init,] = fetchImpl.mock.calls[0];
        expect(String(url,),).toBe('http://api/api/v1/shop/settings',);
        expect((init as RequestInit).method,).toBe('PUT',);
        expect(JSON.parse((init as RequestInit).body as string,),).toEqual({
            settings: { currency: 'eur', }, appearance: { gridColumns: 4, },
        },);
    },);
},);
