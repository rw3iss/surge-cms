/**
 * The entity-list cache key.
 *
 * An entity block, a carousel slide and the admin picker can each build the
 * SAME query with its keys in a different order. `JSON.stringify` preserves
 * insertion order, so each one used to get its own cache entry and miss the
 * others' — a correctness-neutral bug that just quietly stopped the cache
 * working, which is exactly the kind that survives a long time.
 */
import { describe, expect, it, vi, } from 'vitest';

vi.mock('../db/client', () => ({ transaction: vi.fn(), }),);
vi.mock('./cache', () => ({
    cache: { get: vi.fn(), set: vi.fn(), },
    CACHE_KEYS: { entityList: () => 'k', entityRecord: () => 'k', },
}),);

import { hashQuery, } from './entities';

describe('hashQuery', () => {
    it('is insensitive to key ORDER', () => {
        expect(hashQuery({ sortBy: 'publishedAt', sortOrder: 'desc', limit: 5, },),)
            .toBe(hashQuery({ limit: 5, sortOrder: 'desc', sortBy: 'publishedAt', },),);
    },);

    it('is insensitive to key order INSIDE a filter clause', () => {
        expect(hashQuery({ filter: { status: { op: 'eq', value: 'active', }, }, },),)
            .toBe(hashQuery({ filter: { status: { value: 'active', op: 'eq', }, }, },),);
    },);

    it('is insensitive to the order the filter FIELDS were added', () => {
        expect(hashQuery({ filter: { a: 1, b: 2, }, },),).toBe(hashQuery({ filter: { b: 2, a: 1, }, },),);
    },);

    // The other half of the contract: two DIFFERENT queries must never collide,
    // or a block would render another block's records.
    it('separates different sort fields', () => {
        expect(hashQuery({ sortBy: 'publishedAt', },),).not.toBe(hashQuery({ sortBy: 'createdAt', },),);
    },);

    it('separates the two sort DIRECTIONS', () => {
        // "newest 3 posts" vs "oldest 3 posts" — same field, opposite answers.
        expect(hashQuery({ sortBy: 'publishedAt', sortOrder: 'asc', },),)
            .not.toBe(hashQuery({ sortBy: 'publishedAt', sortOrder: 'desc', },),);
    },);

    it('separates different filter values', () => {
        expect(hashQuery({ filter: { status: 'active', }, },),)
            .not.toBe(hashQuery({ filter: { status: 'draft', }, },),);
    },);

    it('keeps ARRAY order significant', () => {
        // `in` carries a list; sorting it would be a different query only by
        // accident, but flattening it would merge genuinely distinct ones.
        expect(hashQuery({ filter: { id: { op: 'in', value: [1, 2,], }, }, },),)
            .not.toBe(hashQuery({ filter: { id: { op: 'in', value: [1, 2, 3,], }, }, },),);
    },);
},);
