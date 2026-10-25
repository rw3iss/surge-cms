import { beforeEach, describe, expect, it, vi, } from 'vitest';

const q = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => q(...a), }),);
vi.mock('./payment', () => ({ getPaymentProvider: () => ({}), }),);
vi.mock('./payment/webhook', () => ({}),);
const change = vi.fn();
vi.mock('./membership', () => ({ change: (...a: unknown[]) => change(...a), }),);

import { subscribe, } from './payments';

beforeEach(() => { q.mockReset(); change.mockReset(); },);

describe('legacy POST /payments/subscribe (S1)', () => {
    it('goes through membership.change, so approval / hidden-level / minimum rules apply', async () => {
        q.mockImplementation(async (sql: string,) => sql.includes('FROM subscription_plans',) ? { rows: [{ is_free: false, stripe_price_id: 'price_1', },], } : { rows: [], },);
        change.mockRejectedValue(new Error('Club requires an application — choose Apply and an admin will review it.',),);
        await expect(subscribe('u1', 'club',),).rejects.toThrow(/requires an application/,);
        expect(change,).toHaveBeenCalledWith('u1', 'club',);
    },);

    it('keeps the old response shape', async () => {
        q.mockImplementation(async (sql: string,) => sql.includes('FROM subscription_plans',) ? { rows: [{ is_free: false, stripe_price_id: 'price_1', },], } : { rows: [], },);
        change.mockResolvedValue({ result: 'payment_required', clientSecret: 'cs_1', subscriptionId: 'sub_1', },);
        expect(await subscribe('u1', 'basic',),).toEqual({ subscriptionId: 'sub_1', status: 'incomplete', clientSecret: 'cs_1', },);
    },);

    it('refuses a free plan before anything changes', async () => {
        q.mockImplementation(async (sql: string,) => sql.includes('FROM subscription_plans',) ? { rows: [{ is_free: true, stripe_price_id: null, },], } : { rows: [], },);
        await expect(subscribe('u1', 'free',),).rejects.toThrow(/not configured/,);
        expect(change,).not.toHaveBeenCalled();
    },);
},);
