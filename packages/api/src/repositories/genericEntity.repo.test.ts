import { beforeEach, describe, expect, it, vi, } from 'vitest';
import type { EntityTypeDef, } from '@sitesurge/types';

const queryMock = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => queryMock(...a) }),);

import { list, } from './genericEntity.repo';

const TYPE = {
    key: 'product',
    tableName: 'shop_products',
    hasStatus: true,
    hasSlug: true,
    fields: [],
} as unknown as EntityTypeDef;

/** The row SELECT is the 2nd call; the 1st is the COUNT. */
const rowSql = () => String(queryMock.mock.calls[1][0],).replace(/\s+/g, ' ',);

describe('genericEntity.repo list ordering', () => {
    beforeEach(() => {
        queryMock.mockReset();
        queryMock
            .mockResolvedValueOnce({ rows: [{ count: 0, },], },)
            .mockResolvedValueOnce({ rows: [], },);
    },);

    it('uses createdAt DESC when nothing is specified', async () => {
        await list(TYPE, {},);
        expect(rowSql(),).toContain('ORDER BY created_at DESC',);
    },);

    it('uses defaultOrderBy when the caller asked for no sort', async () => {
        await list(TYPE, {}, { defaultOrderBy: 'ORDER BY position ASC NULLS LAST, updated_at DESC', },);
        expect(rowSql(),).toContain('ORDER BY position ASC NULLS LAST, updated_at DESC',);
        expect(rowSql(),).not.toContain('created_at',);
    },);

    it('an explicit sortBy overrides defaultOrderBy', async () => {
        await list(TYPE, { sortBy: 'slug', sortOrder: 'asc', }, { defaultOrderBy: 'ORDER BY position ASC', },);
        expect(rowSql(),).toContain('ORDER BY slug ASC',);
        expect(rowSql(),).not.toContain('position',);
    },);
},);
