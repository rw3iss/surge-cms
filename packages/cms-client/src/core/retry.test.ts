import { describe, expect, it, vi, } from 'vitest';
import { withRetry, } from './retry';
import { DEFAULT_RETRY, } from './types';
import { NetworkError, RateLimitedError, } from './errors';

const policy = { ...DEFAULT_RETRY, backoffMs: 1, maxBackoffMs: 2, };

describe('withRetry', () => {
    it('retries a GET on NetworkError then succeeds', async () => {
        const attempt = vi.fn()
            .mockRejectedValueOnce(new NetworkError(),)
            .mockResolvedValueOnce('ok',);
        const out = await withRetry(attempt, { method: 'GET', retryEnabled: true, policy, },);
        expect(out,).toBe('ok',);
        expect(attempt,).toHaveBeenCalledTimes(2,);
    },);
    it('does NOT retry a POST by default', async () => {
        const attempt = vi.fn().mockRejectedValue(new NetworkError(),);
        await expect(withRetry(attempt, { method: 'POST', retryEnabled: false, policy, },),).rejects.toBeInstanceOf(NetworkError,);
        expect(attempt,).toHaveBeenCalledTimes(1,);
    },);
    it('retries a POST when retryEnabled', async () => {
        const attempt = vi.fn().mockRejectedValueOnce(new NetworkError(),).mockResolvedValueOnce('ok',);
        const out = await withRetry(attempt, { method: 'POST', retryEnabled: true, policy, },);
        expect(out,).toBe('ok',);
    },);
    it('gives up after `attempts` and rethrows the last error', async () => {
        const attempt = vi.fn().mockRejectedValue(new NetworkError('down',),);
        await expect(withRetry(attempt, { method: 'GET', retryEnabled: true, policy: { ...policy, attempts: 2, }, },),)
            .rejects.toThrow('down',);
        expect(attempt,).toHaveBeenCalledTimes(2,);
    },);
    it('retries on a retryable status error (RateLimited 429)', async () => {
        const attempt = vi.fn()
            .mockRejectedValueOnce(new RateLimitedError('slow', { status: 429, },),)
            .mockResolvedValueOnce('ok',);
        const out = await withRetry(attempt, { method: 'GET', retryEnabled: true, policy, },);
        expect(out,).toBe('ok',);
    },);
    it('does not retry a non-retryable error (404)', async () => {
        const e = Object.assign(new Error('nf',), { status: 404, },);
        const attempt = vi.fn().mockRejectedValue(e,);
        await expect(withRetry(attempt, { method: 'GET', retryEnabled: true, policy, },),).rejects.toBe(e,);
        expect(attempt,).toHaveBeenCalledTimes(1,);
    },);
},);
