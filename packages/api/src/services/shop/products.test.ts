import { beforeEach, describe, expect, it, vi, } from 'vitest';

// ── Mocks ──
const getMock = vi.fn();
const setMock = vi.fn();
const delPatternMock = vi.fn();
vi.mock('../cache', () => ({
    cache: {
        get: (...a: unknown[]) => getMock(...a),
        set: (...a: unknown[]) => setMock(...a),
        delPattern: (...a: unknown[]) => delPatternMock(...a),
        del: vi.fn(),
    },
}),);

vi.mock('../audit', () => ({ logAudit: vi.fn(), }),);

// transaction(cb) runs the callback with a fake client that records SQL.
const txnQueries: { sql: string; params?: unknown[]; }[] = [];
const fakeClient = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
        txnQueries.push({ sql, params, },);
        return { rows: [{ id: 'opt-1', },], };
    }),
};
vi.mock('../../db', () => ({
    transaction: async (cb: (c: unknown,) => Promise<unknown>,) => cb(fakeClient,),
}),);

const findPublicProductsMock = vi.fn().mockResolvedValue({ data: [], total: 0, });
const findAllProductsMock = vi.fn().mockResolvedValue({ data: [], total: 0, },);
const createProductMock = vi.fn().mockResolvedValue({ id: 'p1', title: 'Shirt', },);
const findProductDetailByIdMock = vi.fn().mockResolvedValue({ id: 'p1', title: 'Shirt', variants: [], },);

// Use the real replaceProductStructure so the default-variant + variant
// INSERT logic is exercised against the fake client.
vi.mock('../../repositories/shop/shopProducts.repo', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('../../repositories/shop/shopProducts.repo',);
    return {
        ...actual,
        findPublicProducts: (...a: unknown[]) => findPublicProductsMock(...a),
        findAllProducts: (...a: unknown[]) => findAllProductsMock(...a),
        createProduct: (...a: unknown[]) => createProductMock(...a),
        findProductDetailById: (...a: unknown[]) => findProductDetailByIdMock(...a),
    };
},);

vi.mock('../../repositories/shop/shopCatalog.repo', () => ({
    setProductCategories: vi.fn(),
    setProductCollections: vi.fn(),
    setProductTags: vi.fn(),
}),);

import * as products from './products';

const ctx = { userId: 'u1', ipAddress: '', userAgent: '', };

describe('shop products service', () => {
    beforeEach(() => {
        getMock.mockReset();
        setMock.mockReset();
        delPatternMock.mockReset();
        txnQueries.length = 0;
        fakeClient.query.mockClear();
        findPublicProductsMock.mockClear();
        findAllProductsMock.mockClear();
        createProductMock.mockClear();
    });

    it('public list resolves active-only via the public repo (never the admin repo)', async () => {
        getMock.mockResolvedValue(null,);
        await products.listPublicCached({}, { page: 1, limit: 20, },);
        expect(findPublicProductsMock,).toHaveBeenCalledTimes(1,);
        expect(findAllProductsMock,).not.toHaveBeenCalled();
        // cache-safe: populated for anonymous readers
        expect(getMock,).toHaveBeenCalledTimes(1,);
        expect(setMock,).toHaveBeenCalledTimes(1,);
    },);

    it('create with options+variants persists options and the supplied variants', async () => {
        await products.create({
            title: 'Shirt', slug: 'shirt',
            options: [{ name: 'Size', values: [{ value: 'S', }, { value: 'M', },], },],
            variants: [
                { priceCents: 1000, option1: 'S', },
                { priceCents: 1000, option1: 'M', },
            ],
        }, ctx,);
        const optionInserts = txnQueries.filter((q,) => q.sql.includes('INSERT INTO shop_product_options'),);
        const variantInserts = txnQueries.filter((q,) => q.sql.includes('INSERT INTO shop_variants'),);
        expect(optionInserts.length,).toBe(1,);
        expect(variantInserts.length,).toBe(2,);
        expect(delPatternMock,).toHaveBeenCalled(); // cache invalidated
    },);

    it('create with NO options synthesizes a single default variant', async () => {
        await products.create({ title: 'Simple', slug: 'simple', }, ctx,);
        const optionInserts = txnQueries.filter((q,) => q.sql.includes('INSERT INTO shop_product_options'),);
        const variantInserts = txnQueries.filter((q,) => q.sql.includes('INSERT INTO shop_variants'),);
        expect(optionInserts.length,).toBe(0,);
        expect(variantInserts.length,).toBe(1,);
        // is_default (last param) true for the synthesized default variant
        const params = variantInserts[0].params as unknown[];
        expect(params[params.length - 1],).toBe(true,);
    },);

    it('taxonomy-only update does NOT touch variants/options (no structure wipe)', async () => {
        // Regression: previously a taxonomy-only update passed `{}` as the
        // structure, so replaceProductStructure deleted every variant and
        // synthesized a default — silently destroying the catalog.
        await products.update('p1', { categoryIds: ['c1',], }, ctx,);
        const variantWrites = txnQueries.filter((q,) =>
            q.sql.includes('shop_variants') || q.sql.includes('shop_product_options')
        );
        expect(variantWrites.length,).toBe(0,);
    },);

    it('update WITH variants re-syncs the structure', async () => {
        await products.update('p1', {
            variants: [{ priceCents: 500, }, { priceCents: 700, },],
        }, ctx,);
        const variantInserts = txnQueries.filter((q,) => q.sql.includes('INSERT INTO shop_variants'),);
        expect(variantInserts.length,).toBe(2,);
    },);
},);
