/**
 * A page block's parent must be a block of the SAME page and never the block
 * itself or one of its descendants (audit 2026-10-21): the FK only proves the
 * parent exists somewhere, so a stale editor could nest a block under another
 * page's group, or a block under its own child (the subtree then vanished).
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const PAGE = '11111111-1111-4111-8111-111111111111';
const OTHER_PAGE = '22222222-2222-4222-8222-222222222222';
const PARENT = '33333333-3333-4333-8333-333333333333';
const SELF = '44444444-4444-4444-8444-444444444444';

let chain: { page_id: string | null; cycles: boolean | null; } = { page_id: PAGE, cycles: false, };
const query = vi.fn(async (sql: string,) => {
    if (sql.includes('WITH RECURSIVE chain')) return { rows: [chain,], };
    if (sql.startsWith('UPDATE blocks',)) return { rows: [{ id: SELF, page_id: PAGE, },], };
    return { rows: [], };
},);
vi.mock('../db', () => ({ query: (sql: string, p?: unknown[],) => query(sql, p,), }),);
vi.mock('./base.repo', () => ({
    deleteById: vi.fn(), findByIdOrThrow: vi.fn(async () => ({ id: PAGE, }),), paginatedQuery: vi.fn(), updateById: vi.fn(),
}),);

import { createBlock, updateBlock, } from './pages.repo';

beforeEach(() => { query.mockClear(); chain = { page_id: PAGE, cycles: false, }; },);

describe('page block parent validation', () => {
    it('refuses a parent on another page', async () => {
        chain = { page_id: OTHER_PAGE, cycles: false, };
        await expect(createBlock(PAGE, { type: 'html', parentBlockId: PARENT, },),).rejects.toThrow(/another page/,);
    },);
    it('refuses a missing parent', async () => {
        chain = { page_id: null, cycles: null, };
        await expect(updateBlock(PAGE, SELF, { parentBlockId: PARENT, },),).rejects.toThrow(/does not exist/,);
    },);
    it('refuses the block itself or a descendant as its parent', async () => {
        await expect(updateBlock(PAGE, SELF, { parentBlockId: SELF, },),).rejects.toThrow(/own parent/,);
        chain = { page_id: PAGE, cycles: true, };
        await expect(updateBlock(PAGE, SELF, { parentBlockId: PARENT, },),).rejects.toThrow(/own children/,);
    },);
    it('accepts a parent on the same page', async () => {
        await expect(updateBlock(PAGE, SELF, { parentBlockId: PARENT, },),).resolves.toBeTruthy();
    },);
    it('top-level blocks skip the check', async () => {
        await updateBlock(PAGE, SELF, { title: 'x', },);
        expect(query.mock.calls.some(([sql,],) => String(sql,).includes('WITH RECURSIVE',)),).toBe(false,);
    },);
},);
