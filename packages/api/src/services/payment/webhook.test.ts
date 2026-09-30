/**
 * Donation webhooks: one-time donations from payment_intent.succeeded,
 * recurring donations from invoice.payment_succeeded — and neither records a
 * payment that belongs to the other (or to a membership).
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queries: Array<{ sql: string; params: unknown[]; }> = [];
vi.mock('../../db', () => ({
    query: async (sql: string, params: unknown[] = [],) => {
        queries.push({ sql, params, },);
        if (/INSERT INTO donations/.test(sql,)) return { rows: [{ id: 'd1', campaign_id: params[0], user_id: null, amount_cents: params[4], },], };
        return { rows: [], rowCount: 0, };
    },
}),);
vi.mock('../cache', () => ({ cache: { invalidateCampaignCache: vi.fn(async () => undefined), }, }),);
vi.mock('./credentials', () => ({ allWebhookSecrets: () => [], }),);
vi.mock('./index', () => ({ getPaymentProvider: () => ({}), }),);
const subRetrieve = vi.fn();
vi.mock('./stripe', () => ({
    getStripeClient: () => ({
        subscriptions: { retrieve: subRetrieve, },
        paymentIntents: { retrieve: async () => ({ latest_charge: 'ch_1', }), },
    }),
}),);
vi.mock('../notifications', () => ({ notify: vi.fn(), }),);
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), }, }),);

const { handleWebhook, } = await import('./webhook');
const send = (event: unknown,) => handleWebhook(Buffer.from(JSON.stringify(event,),), undefined,);
const donationInserts = () => queries.filter((q,) => /INSERT INTO donations/.test(q.sql,));

const RECURRING_MD = {
    type: 'recurring_donation', campaignId: 'c1', donorEmail: 'd@x.co', donorName: 'Dana',
    visibility: 'public', recurringInterval: 'monthly', userId: '', message: '',
};

beforeEach(() => {
    queries.length = 0;
    subRetrieve.mockReset();
},);

describe('donation webhooks', () => {
    it('records a one-time donation from its PaymentIntent', async () => {
        await send({
            id: 'e1', type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_1', amount: 2500, latest_charge: 'ch_1', metadata: { donorEmail: 'a@b.co', campaignId: 'c1', }, }, },
        },);
        expect(donationInserts(),).toHaveLength(1,);
    },);

    it('ignores a PaymentIntent with no donation metadata (subscription invoice / membership)', async () => {
        await send({ id: 'e2', type: 'payment_intent.succeeded', data: { object: { id: 'pi_2', amount: 900, metadata: {}, }, }, },);
        expect(donationInserts(),).toHaveLength(0,);
    },);

    it('records each paid invoice of a recurring donation, with its frequency', async () => {
        await send({
            id: 'e3', type: 'invoice.payment_succeeded',
            data: { object: {
                id: 'in_1', amount_paid: 1500, customer_email: 'd@x.co',
                parent: { subscription_details: { subscription: 'sub_1', metadata: RECURRING_MD, }, },
                payments: { data: [{ payment: { payment_intent: 'pi_3', }, },], },
            }, },
        },);
        const ins = donationInserts();
        expect(ins,).toHaveLength(1,);
        expect(ins[0].params,).toEqual(expect.arrayContaining(['c1', 'd@x.co', 1500, 'pi_3', 'ch_1', 'monthly', 'sub_1',],),);
    },);

    it('looks the metadata up when the invoice does not carry it', async () => {
        subRetrieve.mockResolvedValue({ metadata: RECURRING_MD, },);
        await send({
            id: 'e4', type: 'invoice.payment_succeeded',
            data: { object: { id: 'in_2', amount_paid: 1500, subscription: 'sub_2', }, },
        },);
        expect(subRetrieve,).toHaveBeenCalledWith('sub_2',);
        expect(donationInserts()[0].params,).toContain('inv:in_2',);
    },);

    it('leaves a membership invoice to the membership handling', async () => {
        subRetrieve.mockResolvedValue({ metadata: { userId: 'u1', planId: 'p1', }, },);
        await send({ id: 'e5', type: 'invoice.payment_succeeded', data: { object: { id: 'in_3', amount_paid: 900, subscription: 'sub_3', }, }, },);
        expect(donationInserts(),).toHaveLength(0,);
        expect(queries.some((q,) => /FROM subscriptions WHERE stripe_subscription_id/.test(q.sql,)),).toBe(true,);
    },);
},);
