/** getPolicy() is cached in Redis (audit A4): a hit reads no settings and no SQL. */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const store = new Map<string, unknown>();
const getUsersSettings = vi.fn();
const query = vi.fn();
vi.mock('./cache', () => ({
    cache: {
        get: vi.fn(async (k: string,) => store.get(k,) ?? null,),
        set: vi.fn(async (k: string, v: unknown,) => { store.set(k, v,); },),
    },
    CACHE_KEYS: { subscriptionPolicy: 'settings:subscription-policy', },
}),);
vi.mock('./settings', () => ({ getUsersSettings: () => getUsersSettings(), }),);
vi.mock('../db', () => ({ query: (...a: unknown[]) => query(...a,), }),);
vi.mock('./membership/state', () => ({ approvedOfferFor: vi.fn(), lastFailedAttempt: vi.fn(), pendingApplicationFor: vi.fn(), }),);

import { getPolicy, } from './subscriptionAccess';

beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    getUsersSettings.mockResolvedValue({ requireSubscription: true, minimumTierId: null, requireEmailVerification: true, },);
    query.mockResolvedValue({ rows: [{ rank: 2, },], },);
},);

describe('getPolicy cache', () => {
    it('computes once, then serves the cached policy', async () => {
        const first = await getPolicy();
        expect(first,).toMatchObject({ required: true, minimumRank: 2, },);
        const second = await getPolicy();
        expect(second,).toEqual(first,);
        expect(getUsersSettings,).toHaveBeenCalledTimes(1,);
        expect(query,).toHaveBeenCalledTimes(1,);
        expect(store.has('settings:subscription-policy',),).toBe(true,);
    },);
},);
