import { beforeEach, describe, expect, it, vi, } from 'vitest';

let campaign: Record<string, unknown> | null = null;
const updates: unknown[][] = [];
vi.mock('../db', () => ({
    query: async (sql: string, params: unknown[] = [],) => {
        if (/FROM campaigns WHERE id/.test(sql,)) return { rows: campaign ? [campaign,] : [], };
        if (/UPDATE campaigns SET stripe_product_id/.test(sql,)) updates.push(params,);
        return { rows: [], };
    },
}),);
const createRecurringDonation = vi.fn(async () => ({ subscriptionId: 'sub_1', clientSecret: 'pi_x_secret_y', productId: 'prod_new', }));
const createPaymentIntent = vi.fn(async () => ({ id: 'pi_1', clientSecret: 'cs', status: 'requires_payment_method', }));
vi.mock('./payment', () => ({
    getPaymentProvider: () => ({ createRecurringDonation, createPaymentIntent, }),
}),);
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), }, }),);

const { donate, } = await import('./payments');
const BASE = { amountCents: 1500, campaignId: '11111111-1111-1111-1111-111111111111', donorEmail: 'd@x.co', };

beforeEach(() => {
    updates.length = 0;
    createRecurringDonation.mockClear();
    campaign = { id: BASE.campaignId, title: 'Spring', allow_recurring_donations: true, stripe_product_id: null, };
},);

describe('recurring donations', () => {
    it('refuses when the campaign does not allow them', async () => {
        campaign = { ...campaign!, allow_recurring_donations: false, };
        await expect(donate({ ...BASE, recurringInterval: 'monthly', }, undefined,),).rejects.toThrow(/does not accept recurring/,);
        expect(createRecurringDonation,).not.toHaveBeenCalled();
    },);

    it('maps the frequency to Stripe and remembers the campaign product', async () => {
        const res = await donate({ ...BASE, recurringInterval: 'quarterly', }, undefined,);
        expect(res,).toMatchObject({ clientSecret: 'pi_x_secret_y', subscriptionId: 'sub_1', },);
        expect(createRecurringDonation.mock.calls[0][0],).toMatchObject({
            amountCents: 1500, interval: 'month', intervalCount: 3,
            metadata: { type: 'recurring_donation', recurringInterval: 'quarterly', campaignId: BASE.campaignId, donorEmail: 'd@x.co', },
        },);
        expect(updates,).toEqual([['prod_new', BASE.campaignId,],],);
    },);

    it('one-time donations are unchanged', async () => {
        const res = await donate(BASE, undefined,);
        expect(res.paymentIntentId,).toBe('pi_1',);
        expect(createRecurringDonation,).not.toHaveBeenCalled();
    },);
},);
