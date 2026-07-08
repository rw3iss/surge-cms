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
},);
