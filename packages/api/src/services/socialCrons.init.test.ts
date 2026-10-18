/** S11 — social crons are registered once (primary boot) and self-gate on the connection. */
import { describe, expect, it, vi, } from 'vitest';

const h = vi.hoisted(() => ({ registered: [] as string[], refreshed: 0, }),);
vi.mock('../db', () => ({ query: vi.fn(async () => ({ rows: [], }),), }),);
vi.mock('./cron', () => ({ cronRegistry: { register: (d: { name: string; },) => h.registered.push(d.name,), }, }),);
vi.mock('./oauth', () => ({
    getOAuthProvider: () => ({ refreshToken: async () => { h.refreshed++; return null; }, }),
    isOAuthProvider: () => true,
}),);
vi.mock('./cache', () => ({ cache: { invalidateSocialCache: vi.fn(), }, }),);

import { initSocialCrons, SOCIAL_CRONS, } from './socialCrons';

describe('social crons', () => {
    it('registers every job at init, whatever is connected', async () => {
        await initSocialCrons();
        expect(h.registered,).toEqual(expect.arrayContaining(['social-sync', 'instagram-token-refresh',],),);
    },);
    it('the Instagram refresh is a no-op while Instagram is not connected', async () => {
        const job = SOCIAL_CRONS().find((d,) => d.name === 'instagram-token-refresh',)!;
        await expect(job.handler(),).resolves.toBeUndefined();
        expect(h.refreshed,).toBe(0,);
    },);
},);
