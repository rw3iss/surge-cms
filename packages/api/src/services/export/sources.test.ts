import { describe, expect, it, vi, } from 'vitest';

vi.mock('../users', () => ({
    list: async () => ({
        data: [{ id: 'u1', email: 'a@x.co', displayName: 'Ann', passwordHash: '$2b$...', resetToken: 't', twoFactorSecret: 's', role: 'member', },],
        meta: { total: 1, },
    }),
}),);
vi.mock('../campaigns', () => ({}),);
vi.mock('../entities', () => ({}),);
vi.mock('../mailingLists', () => ({}),);
vi.mock('../../entities/entityManager', () => ({}),);

const { allUsers, } = await import('./sources');

describe('export sources', () => {
    it('never exports password hashes, tokens or secrets', async () => {
        const ds = await allUsers({},);
        const keys = ds.columns.map((c,) => c.key,);
        expect(keys,).toEqual(expect.arrayContaining(['displayName', 'email', 'role',],),);
        expect(keys.some((k,) => /password|token|secret|hash/i.test(k,),),).toBe(false,);
    },);
},);
