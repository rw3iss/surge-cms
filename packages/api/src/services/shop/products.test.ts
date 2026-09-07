import { beforeEach, describe, expect, it, vi, } from 'vitest';

// ── Mocks ──
const getMock = vi.fn();
const setMock = vi.fn();
const invalidateProductMock = vi.fn();
vi.mock('../cache', () => ({
    cache: {
        get: (...a: unknown[]) => getMock(...a),
        set: (...a: unknown[]) => setMock(...a),
        invalidateShopProductCache: (...a: unknown[]) => invalidateProductMock(...a),
        invalidateShopCatalogCache: (...a: unknown[]) => invalidateProductMock(...a),
        CACHE_KEYS: {
            shopProductsPrefix: 'shop:products:',
            shopProductSlug: (slug: string,) => `shop:product:slug:${slug}`,
        },
    },
}),);

vi.mock('../audit', () => ({ logAudit: vi.fn(), }),);

// transaction(cb) runs the callback with a fake client that records SQL.
// It models `shop_variants` row count so the writer's "≥1-variant invariant"
// (SELECT COUNT(*) → synthesize a default when zero) behaves like a real DB:
// after N variant INSERTs the count is N, so no spurious default is synthesized
// for a product that already supplied variants.
const txnQueries: { sql: string; params?: unknown[]; }[] = [];
let variantRowCount = 0;
/** Variants the product already has — drives the writer's UPDATE-vs-INSERT match. */
let existingVariantRows: Record<string, unknown>[] = [];
const fakeClient = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
        txnQueries.push({ sql, params, },);
        if (/INSERT INTO shop_variants/.test(sql,)) variantRowCount++;
        if (/DELETE FROM shop_variants/.test(sql,)) variantRowCount = 0;
        if (/SELECT COUNT\(\*\)::int AS n FROM shop_variants/.test(sql,)) {
            return { rows: [{ n: variantRowCount, },], };
        }
        if (/SELECT id, external_id, option1, option2, option3 FROM shop_variants/.test(sql,)) {
            variantRowCount = existingVariantRows.length;
            return { rows: existingVariantRows, };
        }
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
        invalidateProductMock.mockReset();
        txnQueries.length = 0;
        variantRowCount = 0;
        existingVariantRows = [];
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
        expect(invalidateProductMock,).toHaveBeenCalled(); // cache invalidated
    },);

    it('create with NO options synthesizes a single default variant', async () => {
        await products.create({ title: 'Simple', slug: 'simple', }, ctx,);
        const optionInserts = txnQueries.filter((q,) => q.sql.includes('INSERT INTO shop_product_options'),);
        const variantInserts = txnQueries.filter((q,) => q.sql.includes('INSERT INTO shop_variants'),);
        expect(optionInserts.length,).toBe(0,);
        expect(variantInserts.length,).toBe(1,);
        // The default is synthesized by the repo's "≥1-variant invariant" using
        // literal SQL values — INSERT … (…, is_default, position) VALUES ($1, 0, 0, true, true, 0):
        // is_default = true, product_id the only bound param.
        const synth = variantInserts[0];
        expect(synth.sql.replace(/\s+/g, ' ',),).toContain('is_default, position',);
        expect(synth.sql.replace(/\s+/g, ' ',),).toContain('VALUES ($1, 0, 0, true, true, 0)',);
        expect((synth.params as unknown[]).length,).toBe(1,); // only product_id is bound
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

    describe('default variant', () => {
        // The default is which colour/size combination a shopper lands on. It is
        // an operator's choice, so a supplier resync (which knows nothing about
        // it) must leave it alone.
        beforeEach(() => {
            existingVariantRows = [
                { id: 'v-black', external_id: 'e1', option1: 'Solid Black', option2: 'M', },
                { id: 'v-red', external_id: 'e2', option1: 'Solid Red', option2: 'M', },
            ];
        },);

        const variantUpdates = () =>
            txnQueries.filter((q,) => q.sql.includes('UPDATE shop_variants SET',));

        it('an update that omits isDefault preserves the stored one', async () => {
            await products.update('p1', {
                variants: [
                    { priceCents: 500, option1: 'Solid Black', option2: 'M', externalId: 'e1', },
                    { priceCents: 500, option1: 'Solid Red', option2: 'M', externalId: 'e2', },
                ],
            }, ctx,);

            const updates = variantUpdates();
            expect(updates.length,).toBe(2,);
            // COALESCE keeps the column when the caller has no opinion...
            expect(updates[0].sql.replace(/\s+/g, ' ',),).toContain('is_default = COALESCE($13, is_default)',);
            // ...and the bound value is NULL, which is what makes that work.
            expect((updates[0].params as unknown[])[12],).toBeNull();
            expect((updates[1].params as unknown[])[12],).toBeNull();
        },);

        it('an explicit isDefault is written through', async () => {
            await products.update('p1', {
                variants: [
                    { priceCents: 500, option1: 'Solid Black', option2: 'M', externalId: 'e1', isDefault: false, },
                    { priceCents: 500, option1: 'Solid Red', option2: 'M', externalId: 'e2', isDefault: true, },
                ],
            }, ctx,);

            const updates = variantUpdates();
            expect((updates[0].params as unknown[])[12],).toBe(false,);
            expect((updates[1].params as unknown[])[12],).toBe(true,);
        },);

        it('a lone new variant is the default; one of several is not', async () => {
            existingVariantRows = [];
            await products.update('p1', { variants: [{ priceCents: 500, },], }, ctx,);
            const lone = txnQueries.filter((q,) => q.sql.includes('INSERT INTO shop_variants'),);
            expect((lone[0].params as unknown[])[13],).toBe(true,); // +1 for product_id

            txnQueries.length = 0;
            variantRowCount = 0;
            await products.update('p1', {
                variants: [
                    { priceCents: 500, option1: 'S', },
                    { priceCents: 500, option1: 'M', },
                ],
            }, ctx,);
            const many = txnQueries.filter((q,) => q.sql.includes('INSERT INTO shop_variants'),);
            expect((many[0].params as unknown[])[13],).toBe(false,);
            expect((many[1].params as unknown[])[13],).toBe(false,);
        },);
    },);
},);
