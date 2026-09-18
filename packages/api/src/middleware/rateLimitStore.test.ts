/**
 * The reason this store exists is that an in-memory counter multiplies the
 * configured limit by the worker count. So the properties worth pinning are the
 * ones that would let that reappear, plus the deliberate decision to ALLOW
 * traffic when Redis is unreachable.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const redis = {
    multi: vi.fn(),
    pexpire: vi.fn(),
    decr: vi.fn(),
    del: vi.fn(),
    get: vi.fn(),
    pttl: vi.fn(),
};

vi.mock('../services/cache', () => ({ getRedis: () => redis, }),);
vi.mock('../utils/logger', () => ({
    logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn(), },
}),);

import { RedisRateLimitStore, } from './rateLimitStore';

/** `multi().incr().pttl().exec()` returning the ioredis result shape. */
function chain(hits: number, ttl: number,) {
    return { incr: () => ({ pttl: () => ({ exec: async () => [[null, hits,], [null, ttl,],], }), }), };
}

beforeEach(() => {
    for (const fn of Object.values(redis,)) (fn as ReturnType<typeof vi.fn>).mockReset?.();
},);

describe('RedisRateLimitStore', () => {
    it('counts in Redis, so every process shares ONE tally', async () => {
        const store = new RedisRateLimitStore();
        store.init({ windowMs: 900_000, },);
        redis.multi.mockReturnValue(chain(7, 500_000,),);

        const res = await store.increment('1.2.3.4',);

        // The whole point: the count came from Redis, not from this process.
        expect(res.totalHits,).toBe(7,);
        expect(redis.multi,).toHaveBeenCalled();
    },);

    it('sets the TTL only when the key has none', async () => {
        const store = new RedisRateLimitStore();
        store.init({ windowMs: 900_000, },);

        // pttl -1 => key exists with no expiry (the first hit of a window).
        redis.multi.mockReturnValue(chain(1, -1,),);
        await store.increment('k',);
        expect(redis.pexpire,).toHaveBeenCalledWith('rl:k', 900_000,);

        // A live TTL must NOT be refreshed, or a continuously active client
        // slides the window forward on every request and never resets.
        redis.pexpire.mockClear();
        redis.multi.mockReturnValue(chain(2, 400_000,),);
        await store.increment('k',);
        expect(redis.pexpire,).not.toHaveBeenCalled();
    },);

    it('prefixes keys so limiter counters cannot collide with cache entries', async () => {
        const store = new RedisRateLimitStore();
        store.init({ windowMs: 1000, },);
        redis.multi.mockReturnValue(chain(1, 500,),);
        await store.increment('9.9.9.9',);
        await store.resetKey('9.9.9.9',);
        expect(redis.del,).toHaveBeenCalledWith('rl:9.9.9.9',);
    },);

    it('ALLOWS the request when Redis is down, rather than blocking', async () => {
        // Deliberate: a rate limiter is a safety net, not access control.
        // Failing closed would take the whole site down because a counter store
        // blinked — far worse than briefly not enforcing a ceiling.
        const store = new RedisRateLimitStore();
        store.init({ windowMs: 900_000, },);
        redis.multi.mockImplementation(() => { throw new Error('ECONNREFUSED',); },);

        const res = await store.increment('1.2.3.4',);
        expect(res.totalHits,).toBe(1,);
        expect(res.resetTime.getTime(),).toBeGreaterThan(Date.now(),);
    },);

    it('never throws from decrement/resetKey/get when Redis is down', async () => {
        const store = new RedisRateLimitStore();
        store.init({ windowMs: 1000, },);
        for (const fn of [redis.decr, redis.del, redis.get, redis.pttl,]) {
            fn.mockImplementation(() => { throw new Error('down',); },);
        }
        await expect(store.decrement('k',),).resolves.toBeUndefined();
        await expect(store.resetKey('k',),).resolves.toBeUndefined();
        await expect(store.get('k',),).resolves.toBeUndefined();
    },);

    it('reports an unknown key as undefined, not zero hits', async () => {
        // express-rate-limit treats `undefined` as "no record"; returning a
        // zero-hit record instead would look like a real, empty window.
        const store = new RedisRateLimitStore();
        store.init({ windowMs: 1000, },);
        redis.get.mockResolvedValue(null,);
        redis.pttl.mockResolvedValue(-2,);
        expect(await store.get('missing',),).toBeUndefined();
    },);
},);
