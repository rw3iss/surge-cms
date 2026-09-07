/**
 * Products read through the ENTITY system (a carousel bound to
 * `is_featured = true`, an entity block, `{{ for products }}`) must come back in
 * the catalogue's own order — the one the operator sets by hand on the admin
 * Products page — not the generic "newest first" default, which ignored
 * `position` entirely AND reversed the result.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const listMock = vi.fn().mockResolvedValue({ items: [], total: 0, },);
vi.mock('../../repositories/genericEntity.repo', () => ({
    list: (...a: unknown[]) => listMock(...a),
    getById: vi.fn(),
    getBySlug: vi.fn(),
}),);

vi.mock('../../entities/entityManager', () => ({
    requireType: () => ({ key: 'product', tableName: 'shop_products', hasStatus: true, hasSlug: true, fields: [], }),
}),);

// The enrichment queries (media / tags / variants) are irrelevant here; an empty
// id list still triggers them, so answer with no rows.
vi.mock('../../db', () => ({ query: vi.fn().mockResolvedValue({ rows: [], },), }),);

import { productEntityProvider, } from './productEntityProvider';

/** The third argument the provider passes to the generic repo. */
const optsOf = (call: unknown[],) => call[2] as { defaultOrderBy?: string; } | undefined;
const queryOf = (call: unknown[],) => call[1] as { sortBy?: string; status?: string; };

describe('productEntityProvider list ordering', () => {
    beforeEach(() => listMock.mockClear(),);

    it('defaults to the catalogue order, matching the admin Products table', async () => {
        await productEntityProvider.list!({}, undefined,);
        const order = optsOf(listMock.mock.calls[0],)?.defaultOrderBy;
        // Same clause as POSITION_ORDER in shopProducts.repo.
        expect(order,).toBe('ORDER BY position ASC NULLS LAST, updated_at DESC',);
        // Ascending — the bug was a created_at DESC fallback, i.e. reversed.
        expect(order,).toContain('position ASC',);
        expect(order,).not.toContain('created_at',);
    },);

    it('still passes an explicit sort through, so the default only fills a gap', async () => {
        await productEntityProvider.list!({ sortBy: 'title', sortOrder: 'asc', }, undefined,);
        expect(queryOf(listMock.mock.calls[0],).sortBy,).toBe('title',);
        // The default rides along; the repo ignores it when sortBy is set.
        expect(optsOf(listMock.mock.calls[0],)?.defaultOrderBy,).toBeTruthy();
    },);

    it('keeps the active-only default for public reads', async () => {
        await productEntityProvider.list!({}, undefined,);
        expect(queryOf(listMock.mock.calls[0],).status,).toBe('active',);

        listMock.mockClear();
        await productEntityProvider.list!({}, { admin: true, },);
        expect(queryOf(listMock.mock.calls[0],).status,).toBeUndefined();
    },);
},);
