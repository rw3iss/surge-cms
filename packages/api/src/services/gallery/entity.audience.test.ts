/** The gallery_item provider honours the `email` audience hint (audit P4). */
import { describe, expect, it, vi, } from 'vitest';

const list = vi.fn(async () => ({ items: [], total: 0, }));
const providers = new Map<string, { list: (q: unknown, o: unknown,) => Promise<unknown>; }>();
vi.mock('./items', () => ({ list: (...a: unknown[]) => list(...(a as [])), get: vi.fn(), }),);
vi.mock('../../db', () => ({ query: vi.fn(), }),);
vi.mock('../../entities/virtualFilters', () => ({ registerVirtualFilter: vi.fn(), }),);
vi.mock('../../entities/dataProviders', () => ({
    registerEntityDataProvider: (k: string, p: never,) => providers.set(k, p,),
}),);

await import('./entity');

describe('gallery_item provider audience', () => {
    it('maps email / admin / default to the gallery list audience', async () => {
        const p = providers.get('gallery_item',)!;
        await p.list({}, { audience: 'email', },);
        await p.list({}, { admin: true, },);
        await p.list({}, {},);
        expect(list.mock.calls.map((c,) => (c as unknown[])[1]),).toEqual([{ audience: 'email', }, { audience: 'admin', }, {},],);
    },);
},);
