/**
 * Abuse limits for writing: Redis counters (shared across cluster workers,
 * like the API limiter) and a link count. Fails OPEN when Redis is down — a
 * limiter is a safety net, not access control.
 */
import { RateLimitError, } from '../../core/errors';
import { getRedis, } from '../cache';

/**
 * INCR + "set the TTL when the key has none" in ONE atomic script. A separate
 * `EXPIRE` after `INCR` could fail (blip, restart) and leave a counter with no
 * TTL — a user rate-limited forever. Checking `TTL < 0` (not `n === 1`) also
 * heals any such key left by the old code. Works on every Redis/Valkey version.
 */
const INCR_WITH_TTL = `local n = redis.call('INCR', KEYS[1])
if redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return n`;

/** Count one hit on `key`; returns the hit count in the window (0 when Redis is down). */
export async function hit(key: string, windowSeconds: number,): Promise<number> {
    try {
        const n = await getRedis().eval(INCR_WITH_TTL, 1, `discussions:rl:${key}`, String(windowSeconds,),);
        return Number(n,) || 0;
    } catch {
        return 0; // fail open
    }
}

/** True while `key` has had at most `max` hits inside `windowSeconds` (counts this one). */
export async function allow(key: string, max: number, windowSeconds: number,): Promise<boolean> {
    return (await hit(key, windowSeconds,)) <= max;
}

/** Throws RateLimitError once `max` hits land on `key` inside `windowSeconds`. */
export async function rateLimit(key: string, max: number, windowSeconds: number,): Promise<void> {
    if (!(await allow(key, max, windowSeconds,))) throw new RateLimitError();
}

export const countLinks = (body: string,): number => (body.match(/https?:\/\//gi,) ?? []).length;

/** Limits per author kind: members post freely-ish, guests far less. */
export async function checkWriteRate(viewerId: string | null | undefined, ip: string | null | undefined,): Promise<void> {
    if (viewerId) {
        await rateLimit(`u:${viewerId}:m`, 10, 60,);
        await rateLimit(`u:${viewerId}:h`, 120, 3600,);
    } else {
        await rateLimit(`ip:${ip ?? 'unknown'}:m`, 3, 600,);
        await rateLimit(`ip:${ip ?? 'unknown'}:d`, 20, 86_400,);
    }
}
