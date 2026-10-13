import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../db', () => ({
    query: vi.fn(async (sql: string,) => {
        if (sql.includes('FROM roles',)) return { rows: [{ key: 'member', base_role: null, }, { key: 'subscriber', base_role: 'member', }, { key: 'ambassador', base_role: 'member', },], };
        if (sql.includes('extra_roles',)) return { rows: [{ extra_roles: ['ambassador',], },], };
        return { rows: [{ plan_id: 'p1', },], };
    },),
}),);

import { enrich, } from './subjects';

describe('additional roles', () => {
    it('come after the primary role\'s chain (its grants decide first), without duplicates', async () => {
        const s = await enrich({ id: 'u1', role: 'subscriber', },);
        expect(s.roleChain,).toEqual(['subscriber', 'member', 'ambassador',],);
    },);
},);
