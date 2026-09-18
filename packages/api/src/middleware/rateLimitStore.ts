/**
 * Redis-backed store for `express-rate-limit`.
 *
 * WHY: the default store keeps counters in process memory. That is correct for
 * one process and quietly wrong for several — with `CLUSTER_WORKERS=2` each
 * worker keeps its own tally, so a limit of 5,000 becomes 10,000 and the
 * setting no longer means what it says. The same applies to a second server.
 *
 * Implemented directly on the existing ioredis client rather than pulling in
 * `rate-limit-redis`: it is one INCR and one conditional EXPIRE, and the
 * connection is already there.
 *
 * FAILURE MODE IS DELIBERATE: if Redis is unreachable this ALLOWS the request
 * rather than blocking it. A rate limiter is a safety net, not an access
 * control — taking the whole site down because the counter store blinked would
 * be a far worse outcome than briefly not enforcing a 5,000-request ceiling.
 * Genuine authorisation lives in the auth middleware, which does not depend on
 * this.
 */
import type { Store, ClientRateLimitInfo, IncrementResponse, } from 'express-rate-limit';
import { getRedis, } from '../services/cache';
import { logger, } from '../utils/logger';

export class RedisRateLimitStore implements Store {
    /** Set by express-rate-limit from the limiter's `windowMs`. */
    private windowMs = 60_000;
    /** Public because express-rate-limit's `Store` interface declares it. */
    readonly prefix: string;
    /** Log a Redis failure once per process, not once per request. */
    private warned = false;

    constructor(prefix = 'rl:',) {
        this.prefix = prefix;
    }

    init(options: { windowMs: number; },): void {
        this.windowMs = options.windowMs;
    }

    private key(k: string,): string {
        return `${this.prefix}${k}`;
    }

    private onError(err: unknown,): void {
        if (this.warned) return;
        this.warned = true;
        logger.warn('Rate-limit store unavailable — allowing requests while Redis is down', {
            error: (err as Error)?.message,
        },);
    }

    async increment(key: string,): Promise<IncrementResponse> {
        const k = this.key(key,);
        try {
            const redis = getRedis();
            // One round trip. INCR returns 1 on the first hit of a window, which
            // is exactly when the TTL needs setting — doing it every time would
            // slide the window forward on every request and the limit would
            // never reset for a continuously active client.
            const results = await redis.multi().incr(k,).pttl(k,).exec();
            const totalHits = Number(results?.[0]?.[1] ?? 1);
            let ttl = Number(results?.[1]?.[1] ?? -1);

            if (ttl < 0) {
                await redis.pexpire(k, this.windowMs,);
                ttl = this.windowMs;
            }

            return { totalHits, resetTime: new Date(Date.now() + ttl,), };
        } catch (err) {
            this.onError(err,);
            // 1 hit = "well under any limit", so the request proceeds.
            return { totalHits: 1, resetTime: new Date(Date.now() + this.windowMs,), };
        }
    }

    async decrement(key: string,): Promise<void> {
        try {
            await getRedis().decr(this.key(key,),);
        } catch (err) {
            this.onError(err,);
        }
    }

    async resetKey(key: string,): Promise<void> {
        try {
            await getRedis().del(this.key(key,),);
        } catch (err) {
            this.onError(err,);
        }
    }

    async get(key: string,): Promise<ClientRateLimitInfo | undefined> {
        try {
            const redis = getRedis();
            const [hits, ttl,] = await Promise.all([
                redis.get(this.key(key,),),
                redis.pttl(this.key(key,),),
            ],);
            if (hits === null) return undefined;
            return {
                totalHits: Number(hits,),
                resetTime: new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs),),
            };
        } catch (err) {
            this.onError(err,);
            return undefined;
        }
    }
}
