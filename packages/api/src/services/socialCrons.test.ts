/** social-sync: syncs only auto-sync providers, isolates failures, clears the feed cache. */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const synced: string[] = [];
let rows: { provider: string; }[] = [];
const invalidate = vi.fn();
vi.mock('../db', () => ({ query: async (sql: string,) => (sql.includes('auto_publish = true',) ? { rows, } : { rows: [], }), }),);
vi.mock('./cache', () => ({ cache: { invalidateSocialCache: (...a: unknown[]) => invalidate(...a,), }, }),);
vi.mock('./cron', () => ({ cronRegistry: { register: vi.fn(), registerAndStart: vi.fn(), unregister: vi.fn(), }, }),);
vi.mock('./oauth', () => ({ getOAuthProvider: vi.fn(), isOAuthProvider: vi.fn(), }),);
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), }, }),);
vi.mock('./social.js', () => ({
    syncSocialPosts: async (p: string,) => {
        if (p === 'instagram') throw new Error('token expired',);
        synced.push(p,);
        return p === 'youtube' ? 2 : 0;
    },
}),);

const { SOCIAL_SYNC_CRON, } = await import('./socialCrons');

beforeEach(() => {
    synced.length = 0;
    invalidate.mockClear();
},);

describe('social-sync cron', () => {
    it('keeps going when one provider fails, and clears the feed cache when something arrived', async () => {
        rows = [{ provider: 'instagram', }, { provider: 'youtube', },];
        await SOCIAL_SYNC_CRON.handler();
        expect(synced,).toEqual(['youtube',],);
        expect(invalidate,).toHaveBeenCalledOnce();
    },);

    it('does not touch the cache when nothing new arrived', async () => {
        rows = [{ provider: 'facebook', },];
        await SOCIAL_SYNC_CRON.handler();
        expect(invalidate,).not.toHaveBeenCalled();
    },);
},);
