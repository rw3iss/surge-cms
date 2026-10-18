/** P1/P2 — access resolved once per distinct target, batched when the target can. */
import { describe, expect, it, vi, } from 'vitest';

const h = vi.hoisted(() => ({ single: 0, many: 0, }),);
vi.mock('./targets', () => ({
    findTarget: vi.fn(async (type: string,) => {
        if (type === 'post') return { access: async (id: string,) => { h.single++; return { canRead: id !== 'p-locked', }; }, };
        if (type === 'forum_thread') {
            return { access: vi.fn(), accessMany: async (ids: string[],) => { h.many++; return new Map(ids.map((id,) => [id, { canRead: id === 't1', },]),); }, };
        }
        return null;
    },),
}),);

import { filterReadable, } from './readable';

describe('filterReadable', () => {
    it('keeps readable rows in order, one access per distinct target, batched where possible', async () => {
        const rows = [
            { t: 'post', id: 'p1', }, { t: 'forum_thread', id: 't1', }, { t: 'post', id: 'p1', },
            { t: 'post', id: 'p-locked', }, { t: 'forum_thread', id: 't2', }, { t: 'gone', id: 'x', },
        ];
        const out = await filterReadable(rows, {}, (r,) => ({ type: r.t, id: r.id, }),);
        expect(out.map((r,) => `${r.t}:${r.id}`),).toEqual(['post:p1', 'forum_thread:t1', 'post:p1',],);
        expect(h.single,).toBe(2,); // p1 + p-locked, not 3
        expect(h.many,).toBe(1,);
    },);
},);
