/** Where a template / component is used (audit 2026-10-18 G2). */
import { describe, expect, it, vi, } from 'vitest';

const query = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => query(...a,), }),);
vi.mock('./cache', () => ({ cache: { get: vi.fn(), set: vi.fn(), }, CACHE_KEYS: {}, }),);
vi.mock('../repositories/contentBlockTemplates.repo', () => ({}),);
vi.mock('../entities/entityManager', () => ({ getType: vi.fn(), }),);

import { usages, withUsageCounts, } from './contentBlockTemplates';

describe('template usages', () => {
    it('scans every block store and groups by template', async () => {
        query.mockImplementation(async (sql: string,) => {
            if (sql.includes('FROM blocks',)) return { rows: [{ tid: 't1', owner_id: 'p1', title: 'Home', n: 2, },], };
            if (sql.includes('FROM post_content_blocks',)) return { rows: [{ tid: 't1', owner_id: 'po1', title: null, n: 1, },], };
            if (sql.includes('FROM mail_template_blocks',)) throw new Error('relation does not exist');
            return { rows: [], };
        },);
        const map = await usages(['t1', 't2',],);
        expect(map.get('t1',),).toEqual(expect.arrayContaining([
            { kind: 'page', id: 'p1', title: 'Home', blocks: 2, },
            { kind: 'post', id: 'po1', title: '(untitled)', blocks: 1, },
        ],),);
        expect(map.get('t2',),).toBeUndefined();
        // A template's own blocks never count as a use of itself.
        const tplCall = query.mock.calls.find(([sql,],) => String(sql,).includes('content_block_template_blocks',),);
        expect(tplCall?.[1],).toEqual([['t1', 't2',], true,],);
    },);

    it('attaches counts', async () => {
        query.mockResolvedValue({ rows: [{ tid: 'a', owner_id: 'x', title: 'X', n: 1, },], },);
        const out = await withUsageCounts([{ id: 'a', }, { id: 'b', },] as never,);
        expect(out.map((t,) => t.usageCount),).toEqual([4, 0,],);
    },);
},);
