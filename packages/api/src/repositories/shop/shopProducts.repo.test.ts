import { beforeEach, describe, expect, it, vi, } from 'vitest';

// Mock the db module: `query` returns the count row first, then the data row.
const queryMock = vi.fn();
vi.mock('../../db', () => ({
    query: (...a: unknown[]) => queryMock(...a),
    transaction: vi.fn(),
}),);

import { findAllProducts, findPublicProducts, } from './shopProducts.repo';

const PRODUCT_ROW = {
    id: 'p1',
    title: 'Shirt',
    slug: 'shirt',
    type: 'physical',
    status: 'active',
    rating_avg: 0,
    rating_count: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    from_price_cents: 1500,
    primary_image_url: 'https://cdn.example.com/shirt.jpg',
};

describe('shopProducts.repo list rows carry fromPriceCents + primaryImageUrl', () => {
    beforeEach(() => {
        queryMock.mockReset();
        // 1st call = COUNT, 2nd call = data page.
        queryMock
            .mockResolvedValueOnce({ rows: [{ count: '1', },], })
            .mockResolvedValueOnce({ rows: [PRODUCT_ROW,], },);
    },);

    it('findPublicProducts computes + maps the extras', async () => {
        const result = await findPublicProducts({}, { page: 1, limit: 20, },);

        // The data SELECT (2nd query) carries the correlated subqueries.
        const dataSql = queryMock.mock.calls[1][0] as string;
        expect(dataSql,).toContain('MIN(v.price_cents)',);
        expect(dataSql,).toContain('AS from_price_cents',);
        expect(dataSql,).toContain('AS primary_image_url',);
        expect(dataSql,).toContain(`spm.kind = 'image'`,);

        expect(result.total,).toBe(1,);
        expect(result.data[0].fromPriceCents,).toBe(1500,);
        expect(result.data[0].primaryImageUrl,).toBe('https://cdn.example.com/shirt.jpg',);
    },);

    it('findAllProducts (admin) also maps the extras', async () => {
        const result = await findAllProducts({}, { page: 1, limit: 20, },);

        const dataSql = queryMock.mock.calls[1][0] as string;
        expect(dataSql,).toContain('AS from_price_cents',);
        expect(dataSql,).toContain('AS primary_image_url',);

        expect(result.data[0].fromPriceCents,).toBe(1500,);
        expect(result.data[0].primaryImageUrl,).toBe('https://cdn.example.com/shirt.jpg',);
    },);
},);
