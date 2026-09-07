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

/**
 * Regression: saving a product with real option values used to 409.
 *
 * The admin editor sends variants with neither an `id` nor an `externalId`, so
 * matching on external_id alone missed every existing row. The INSERT that
 * followed then collided with the still-present row on
 * `UNIQUE (product_id, option1, option2, option3)` — a 23505 surfacing as a
 * 409 on every save.
 *
 * It hid because a product whose single variant has all-NULL options never
 * triggers it: NULLs compare distinct in a unique index. Only products with
 * actual option values failed. These tests pin BOTH shapes.
 */
describe('replaceProductStructure matches existing variants by option triple', () => {
    /** Collect the statements a transaction would run against a fake client. */
    function fakeClient(existingVariants: Array<Record<string, unknown>>,) {
        const calls: Array<{ sql: string; params: unknown[]; }> = [];
        return {
            calls,
            query: vi.fn(async (sql: string, params: unknown[] = [],) => {
                calls.push({ sql, params, },);
                if (sql.includes('SELECT id, external_id, option1',)) {
                    return { rows: existingVariants, };
                }
                if (sql.includes('COUNT(*)::int AS n',)) return { rows: [{ n: existingVariants.length, },], };
                if (sql.trim().startsWith('INSERT INTO shop_variants',)) {
                    return { rows: [{ id: 'new-variant', },], };
                }
                return { rows: [], };
            },),
        };
    }

    it('UPDATEs the existing row instead of inserting a colliding one', async () => {
        const { replaceProductStructure, } = await import('./shopProducts.repo');
        const client = fakeClient([
            { id: 'v-existing', external_id: null, option1: 'Round', option2: '6 x 6', option3: '1 pc', },
        ],);

        await replaceProductStructure(
            'prod-1',
            { variants: [{ option1: 'Round', option2: '6 x 6', option3: '1 pc', priceCents: 500, },], },
            client as never,
        );

        const variantWrites = client.calls.filter((c,) => c.sql.includes('shop_variants',));
        const inserts = variantWrites.filter((c,) => c.sql.trim().startsWith('INSERT',));
        const updates = variantWrites.filter((c,) => c.sql.trim().startsWith('UPDATE',));
        // The whole point: no INSERT, so no unique violation, and the row keeps
        // its id so carts and order items still resolve.
        expect(inserts,).toHaveLength(0,);
        expect(updates,).toHaveLength(1,);
        expect(updates[0].params.at(-1,),).toBe('v-existing',);
    },);

    it('still INSERTs a genuinely new option combination', async () => {
        const { replaceProductStructure, } = await import('./shopProducts.repo');
        const client = fakeClient([
            { id: 'v-existing', external_id: null, option1: 'Round', option2: '6 x 6', option3: '1 pc', },
        ],);

        await replaceProductStructure(
            'prod-1',
            { variants: [{ option1: 'Square', option2: '6 x 6', option3: '1 pc', priceCents: 500, },], },
            client as never,
        );

        const inserts = client.calls.filter((c,) =>
            c.sql.trim().startsWith('INSERT INTO shop_variants',) && c.sql.includes('option1',));
        expect(inserts,).toHaveLength(1,);
    },);
},);
