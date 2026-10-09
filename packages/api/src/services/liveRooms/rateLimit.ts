/**
 * Sliding-window rate limiter for live chat + reactions. In-memory, per
 * process: a user on two workers gets two budgets, which is acceptable for
 * a chat flood guard (it is not access control).
 */
export interface RateRule {
    max: number;
    windowMs: number;
}

export class RateLimiter {
    private hits = new Map<string, number[]>();
    private readonly longest: number;

    constructor(private readonly rules: RateRule[],) {
        this.longest = Math.max(...rules.map((r,) => r.windowMs),);
    }

    /** Record a hit for `key` when every rule allows it. Returns false when limited. */
    take(key: string, now = Date.now(),): boolean {
        const list = (this.hits.get(key,) ?? []).filter((t,) => now - t < this.longest);
        for (const r of this.rules) {
            const inWindow = list.filter((t,) => now - t < r.windowMs).length;
            if (inWindow >= r.max) {
                this.hits.set(key, list,);
                return false;
            }
        }
        list.push(now,);
        this.hits.set(key, list,);
        return true;
    }

    /** Drop keys with no hits inside the longest window (call periodically). */
    prune(now = Date.now(),): void {
        for (const [k, list,] of this.hits) {
            if (!list.some((t,) => now - t < this.longest)) this.hits.delete(k,);
        }
    }
}

/** Chat: 1 message per second and 20 per minute, per user. */
export const chatLimiter = (): RateLimiter => new RateLimiter([{ max: 1, windowMs: 1000, }, { max: 20, windowMs: 60_000, },],);
/** Reactions: 4 per second and 60 per minute, per user / anonymous connection. */
export const reactionLimiter = (): RateLimiter => new RateLimiter([{ max: 4, windowMs: 1000, }, { max: 60, windowMs: 60_000, },],);
