import { beforeEach, describe, expect, it, vi, } from 'vitest';

const NOW = Math.floor(Date.now() / 1000,);
const SUB = (over: Record<string, any> = {},) => ({
    id: 'sub_1', status: 'active', created: NOW - 86400, trial_end: null,
    metadata: { type: 'recurring_donation', campaignId: 'c1', donorEmail: 'Dana@X.co', userId: '', recurringInterval: 'monthly', },
    items: { data: [{
        id: 'si_1', current_period_start: NOW - 86400, current_period_end: NOW + 20 * 86400,
        price: { unit_amount: 1500, currency: 'usd', product: 'prod_1', recurring: { interval: 'month', interval_count: 1, }, },
    },], },
    ...over,
});
let current: any = SUB();
const retrieve = vi.fn(async () => current);
const update = vi.fn(async () => current);
const cancel = vi.fn(async () => ({ ...current, status: 'canceled', }));
vi.mock('./payment/stripe', () => ({
    getStripeClient: () => ({ subscriptions: { retrieve, update, cancel, }, }),
}),);
vi.mock('../db', () => ({
    query: async (sql: string,) => {
        if (/DISTINCT stripe_subscription_id/.test(sql,)) return { rows: [{ stripe_subscription_id: 'sub_1', },], };
        if (/FROM campaigns/.test(sql,)) return { rows: [{ id: 'c1', title: 'Spring', slug: 'spring', },], };
        return { rows: [], };
    },
}),);
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), }, }),);

const svc = await import('./recurringDonations');
const DONOR = { id: 'u1', email: 'dana@x.co', };

beforeEach(() => {
    current = SUB();
    retrieve.mockClear();
    update.mockClear();
    cancel.mockClear();
},);

describe('recurring donations — donor self-service', () => {
    it('lists the donor’s schedule with campaign, amount and frequency', async () => {
        const [r,] = await svc.listForDonor(DONOR,);
        expect(r,).toMatchObject({ id: 'sub_1', campaignTitle: 'Spring', amountCents: 1500, interval: 'monthly', status: 'active', },);
        expect(r.nextPaymentAt,).toBe(new Date((NOW + 20 * 86400) * 1000,).toISOString(),);
    },);

    it('refuses someone else’s subscription with a 404', async () => {
        await expect(svc.update({ id: 'u2', email: 'other@x.co', }, 'sub_1', { amountCents: 2000, },),).rejects.toThrow(/not found/i,);
        await expect(svc.cancel({ id: 'u2', email: 'other@x.co', }, 'sub_1',),).rejects.toThrow(/not found/i,);
        expect(update,).not.toHaveBeenCalled();
        expect(cancel,).not.toHaveBeenCalled();
    },);

    it('refuses a non-donation subscription (a membership)', async () => {
        current = SUB({ metadata: { userId: 'u1', planId: 'p1', }, },);
        await expect(svc.cancel(DONOR, 'sub_1',),).rejects.toThrow(/not found/i,);
    },);

    it('changes amount + frequency from the next charge, never charging today', async () => {
        await svc.update(DONOR, 'sub_1', { amountCents: 2500, interval: 'quarterly', },);
        const params = update.mock.calls[0][1] as any;
        expect(params.proration_behavior,).toBe('none',);
        expect(params.trial_end,).toBe(NOW + 20 * 86400,); // keeps the date they were due
        expect(params.items[0],).toMatchObject({
            id: 'si_1',
            price_data: { product: 'prod_1', unit_amount: 2500, recurring: { interval: 'month', interval_count: 3, }, },
        },);
        expect(params.metadata.recurringInterval,).toBe('quarterly',);
    },);

    it('does nothing when nothing changed; rejects under $1', async () => {
        await svc.update(DONOR, 'sub_1', { amountCents: 1500, interval: 'monthly', },);
        expect(update,).not.toHaveBeenCalled();
        await expect(svc.update(DONOR, 'sub_1', { amountCents: 50, },),).rejects.toThrow(/minimum/i,);
    },);

    it('cancels immediately', async () => {
        const r = await svc.cancel(DONOR, 'sub_1',);
        expect(cancel,).toHaveBeenCalledWith('sub_1',);
        expect(r.status,).toBe('canceled',);
        expect(r.nextPaymentAt,).toBeNull();
    },);
},);
