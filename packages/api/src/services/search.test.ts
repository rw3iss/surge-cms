import { beforeEach, describe, expect, it, vi, } from 'vitest';

// The search service is registry-driven; this test asserts the generic
// `searchEntity` path produces the same mapped item + meta shape the route
// relies on, and that the parallel COUNT feeds `total`.
const queryMock = vi.fn();
vi.mock('../db', () => ({
    query: (...args: unknown[]) => queryMock(...args),
}),);

import { adminSearch, publicSearch, } from './search';

beforeEach(() => queryMock.mockReset(),);

describe('publicSearch registry', () => {
    it('maps a posts row to the public item shape and totals the COUNT', async () => {
        // type: 'posts' → one page query then one COUNT query.
        queryMock
            .mockResolvedValueOnce({
                rows: [{
                    id: 'p1',
                    slug: 'hello',
                    title: 'Hello',
                    excerpt: 'ex',
                    featured_image: '/img.jpg',
                    published_at: '2026-01-01',
                    relevance: 0.5,
                },],
            },)
            .mockResolvedValueOnce({ rows: [{ count: '1', },], },);

        const { results, total, } = await publicSearch({ q: 'hello', type: 'posts', page: 1, limit: 20, },);

        expect(results,).toEqual({
            posts: [{
                id: 'p1',
                type: 'post',
                slug: 'hello',
                title: 'Hello',
                excerpt: 'ex',
                featuredImage: '/img.jpg',
                publishedAt: '2026-01-01',
                relevance: 0.5,
            },],
        },);
        expect(total,).toBe(1,);

        // FTS mode binds the raw query (not %q%) as $1, plus limit/offset.
        expect(queryMock.mock.calls[0][1],).toEqual(['hello', 20, 0,],);
        // COUNT reuses the single search param only.
        expect(queryMock.mock.calls[1][1],).toEqual(['hello',],);
    },);
},);

describe('adminSearch registry', () => {
    it('returns raw rows and binds %q% for ILIKE mode', async () => {
        queryMock
            .mockResolvedValueOnce({ rows: [{ id: 'u1', email: 'a@b.c', },], },)
            .mockResolvedValueOnce({ rows: [{ count: '3', },], },);

        const { results, total, } = await adminSearch({ q: 'ab', type: 'users', page: 2, limit: 50, },);

        expect(results,).toEqual({ users: [{ id: 'u1', email: 'a@b.c', },], },);
        expect(total,).toBe(3,);
        // ILIKE mode wraps the query; offset = (page-1)*limit = 50.
        expect(queryMock.mock.calls[0][1],).toEqual(['%ab%', 50, 50,],);
    },);
},);
