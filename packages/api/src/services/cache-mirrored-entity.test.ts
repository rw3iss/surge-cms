/**
 * Core types are cached TWICE, and both copies must be dropped together.
 *
 * `post`, `page`, `campaign`, `form` and `user` are seeded as core entity
 * types adopting their existing tables, so one row is readable through the
 * bespoke module (`posts:*`) AND through the generic entity service
 * (`entity:post:list:*`). Core CRUD still runs in the bespoke modules, which
 * only ever knew about their own keys — so publishing a post left the entity
 * cache holding the previous article, and an `entity` block bound to "newest
 * published post" kept rendering it.
 *
 * Nothing fails when this regresses. The page is simply wrong, which is why it
 * is worth a test rather than a comment.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const del = vi.fn().mockResolvedValue(undefined,);
const keys = vi.fn().mockResolvedValue([],);

vi.mock('ioredis', () => ({
    default: class {
        on() { return this; }
        get = vi.fn().mockResolvedValue(null,);
        set = vi.fn().mockResolvedValue('OK',);
        setex = vi.fn().mockResolvedValue('OK',);
        del = (...a: unknown[]) => del(...a,);
        keys = (p: string,) => keys(p,);
    },
}),);
vi.mock('../config', () => ({
    config: { redis: { url: 'redis://localhost:6379', cacheTtl: 300, }, },
}),);
vi.mock('../utils/logger', () => ({ logger: { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), }, }),);

import * as cache from './cache';

/** Every pattern passed to redis.keys() during one invalidation. */
function patterns(): string[] {
    return keys.mock.calls.map(c => String(c[0],));
}

beforeEach(() => { del.mockClear(); keys.mockClear(); },);

describe('core invalidators drop the mirrored entity cache', () => {
    const cases: Array<[string, (id?: string,) => Promise<void>, string,]> = [
        ['post', cache.invalidatePostCache, 'entity:post:*',],
        ['page', cache.invalidatePageCache, 'entity:page:*',],
        ['campaign', cache.invalidateCampaignCache, 'entity:campaign:*',],
        ['form', cache.invalidateFormCache, 'entity:form:*',],
        ['user', cache.invalidateUserCache, 'entity:user:*',],
    ];

    it.each(cases,)('%s', async (_name, invalidate, expected,) => {
        await invalidate('some-id',);
        expect(patterns(),).toContain(expected,);
    },);

    it('drops the entity cache even with no id (a list-level write)', async () => {
        // A bulk publish or a reorder passes no id. That still changes what a
        // query returns, so the entity cache must go.
        await cache.invalidatePostCache();
        expect(patterns(),).toContain('entity:post:*',);
    },);

    it('still drops the bespoke keys it always did', async () => {
        // The mirrored bust is an ADDITION; removing the original invalidation
        // would trade one stale cache for another.
        await cache.invalidatePostCache('id',);
        expect(patterns(),).toContain('posts:*',);
    },);

    it('does not drop an unrelated type\'s entity cache', async () => {
        // A prefix-wide `entity:*` would work too, and would be wrong: writing
        // a post would throw away every custom type's cache on a busy site.
        await cache.invalidatePostCache('id',);
        expect(patterns(),).not.toContain('entity:*',);
        expect(patterns(),).not.toContain('entity:page:*',);
    },);
},);
