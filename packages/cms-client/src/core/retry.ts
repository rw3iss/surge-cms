import type { RetryPolicy, } from './types';
import { NetworkError, TimeoutError, } from './errors';

interface RetryContext { method: string; retryEnabled: boolean; policy: RetryPolicy; }

function isRetryable(err: unknown, policy: RetryPolicy,): boolean {
    if (err instanceof NetworkError || err instanceof TimeoutError) return true;
    const status = (err as { status?: unknown; }).status;
    return typeof status === 'number' && policy.retryStatuses.includes(status,);
}

const sleep = (ms: number,) => new Promise<void>((r,) => setTimeout(r, ms,),);

/** Run `attempt` with the retry policy. GET/HEAD retries by default; other
 *  methods only when `retryEnabled`. Exponential backoff honoring a
 *  RateLimitedError.retryAfter when present. */
export async function withRetry<T>(attempt: () => Promise<T>, ctx: RetryContext,): Promise<T> {
    const canRetry = ctx.method === 'GET' || ctx.method === 'HEAD' || ctx.retryEnabled;
    const maxAttempts = canRetry ? ctx.policy.attempts : 1;
    let lastErr: unknown;
    for (let i = 0; i < maxAttempts; i++) {
        try { return await attempt(); }
        catch (err) {
            lastErr = err;
            if (i === maxAttempts - 1 || !isRetryable(err, ctx.policy,)) throw err;
            const retryAfter = (err as { retryAfter?: number; }).retryAfter;
            const backoff = retryAfter !== undefined
                ? retryAfter * 1000
                : Math.min(ctx.policy.backoffMs * 2 ** i, ctx.policy.maxBackoffMs,);
            await sleep(backoff,);
        }
    }
    throw lastErr;
}
