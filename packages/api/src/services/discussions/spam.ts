/**
 * Abuse limits for writing: Redis counters (shared across cluster workers,
 * like the API limiter) and a link count. Fails OPEN when Redis is down — a
 * limiter is a safety net, not access control.
 */
import { RateLimitError, } from '../../core/errors';
import { getRedis, } from '../cache';

/** Throws RateLimitError once `max` hits land on `key` inside `windowSeconds`. */
export async function rateLimit(key: string, max: number, windowSeconds: number,): Promise<void> {
    let n = 0;
    try {
        const r = getRedis();
        const k = `discussions:rl:${key}`;
        n = await r.incr(k,);
        if (n === 1) await r.expire(k, windowSeconds,);
    } catch {
        return;
    }
    if (n > max) throw new RateLimitError();
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
