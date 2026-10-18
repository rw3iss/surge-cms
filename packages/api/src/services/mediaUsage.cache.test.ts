/** Display-only usage cache (audit P3 (4)): hits skip the scan, misses are cached. */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const store = new Map<string, unknown>();
const query = vi.fn();
vi.mock('./cache', () => ({
    cache: {
        get: vi.fn(async (k: string,) => store.get(k,) ?? null,),
        set: vi.fn(async (k: string, v: unknown,) => { store.set(k, v,); },),
    },
    CACHE_KEYS: { mediaUsage: (id: string,) => `media:usage:${id}`, },
}),);
vi.mock('../db', () => ({ query: (...a: unknown[]) => query(...a,), }),);
vi.mock('../entities/entityManager.js', () => ({ ready: vi.fn(), all: () => [], }),);
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), }, }),);

import { findMediaUsageCached, } from './mediaUsage';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
    store.clear();
    query.mockReset();
    query.mockResolvedValue({ rows: [], },);
},);

describe('findMediaUsageCached', () => {
    it('serves a cached id without scanning, scans only the misses', async () => {
        store.set(`media:usage:${A}`, [{ kind: 'page', id: 'p', title: 'P', field: 'x', },],);
        const out = await findMediaUsageCached([A, B,],);
        expect(out[A],).toHaveLength(1,);
        expect(out[B],).toEqual([],);
        // The media lookup query names only the missing id.
        expect(query.mock.calls[0][1],).toEqual([[B,],],);
        expect(store.get(`media:usage:${B}`,),).toEqual([],);
    },);

    it('all hits → no query at all', async () => {
        store.set(`media:usage:${A}`, [],);
        await findMediaUsageCached([A,],);
        expect(query,).not.toHaveBeenCalled();
    },);
},);
