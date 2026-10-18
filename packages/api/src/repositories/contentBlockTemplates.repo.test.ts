/**
 * `replaceBlocks` inserts parents before children (audit 2026-10-18 A6):
 * `parent_block_id` is a non-deferrable self-FK, so a payload listing a child
 * before its parent used to fail the whole template save.
 */
import { describe, expect, it, vi, } from 'vitest';

const queries: Array<{ sql: string; params?: unknown[]; }> = [];
vi.mock('../db', () => ({
    getPool: () => ({
        connect: async () => ({
            query: async (sql: string, params?: unknown[],) => { queries.push({ sql, params, },); return { rows: [], }; },
            release: () => {},
        }),
    }),
    query: vi.fn(),
}),);
vi.mock('../db/client', () => ({
    getPool: () => ({
        connect: async () => ({
            query: async (sql: string, params?: unknown[],) => { queries.push({ sql, params, },); return { rows: [], }; },
            release: () => {},
        }),
    }),
    query: vi.fn(),
    transaction: vi.fn(),
}),);

import { replaceBlocks, } from './contentBlockTemplates.repo';

describe('replaceBlocks', () => {
    it('orders a three-level tree given in reverse so every parent lands first', async () => {
        queries.length = 0;
        await replaceBlocks('tpl', [
            { id: 'c', parentBlockId: 'b', blockType: 'html', position: 0, },
            { id: 'b', parentBlockId: 'a', blockType: 'group_item', position: 0, },
            { id: 'a', parentBlockId: null, blockType: 'group', position: 0, },
            { blockType: 'html', position: 1, },
        ],);
        const inserted = queries.filter((q,) => q.sql.includes('INSERT',),).map((q,) => q.params?.[0],);
        expect(inserted.slice(0, 3,),).toEqual(['a', 'b', 'c',],);
        // The id-less block is kept (given an id), not dropped.
        expect(inserted.length,).toBe(4,);
        expect(typeof inserted[3],).toBe('string',);
        expect(queries.at(-1,)?.sql,).toBe('COMMIT',);
    },);
},);
