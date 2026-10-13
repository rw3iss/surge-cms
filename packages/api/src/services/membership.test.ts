import { beforeEach, describe, expect, it, vi, } from 'vitest';

const q = vi.fn();
vi.mock('../db', () => ({ query: (...a: unknown[]) => q(...a), }),);
const stripe = { subscriptions: { retrieve: vi.fn(), cancel: vi.fn(), }, };
vi.mock('./payment/stripe', async (orig,) => ({ ...(await orig<object>()), getStripeClient: () => stripe, }),);
const { frequency, settleOpenAttempts, } = await import('./membership');

describe('frequency', () => {
    it('reads like billing copy', () => {
        expect(frequency('month',),).toBe('monthly',);
        expect(frequency('year',),).toBe('yearly',);
        expect(frequency('week',),).toBe('weekly',);
        expect(frequency('month', 3,),).toBe('every 3 months',);
    },);
},);

describe('settleOpenAttempts', () => {
    const TIER = 'tier-a';
    const sub = (id: string, status: string, price: string,) => ({
        id, status, items: { data: [{ price: { id: price, }, },], },
        latest_invoice: { payment_intent: { client_secret: `${id}_secret`, }, },
    });
    beforeEach(() => {
        q.mockReset();
        stripe.subscriptions.retrieve.mockReset();
        stripe.subscriptions.cancel.mockReset();
    },);

    it('reuses the same level\'s unpaid attempt and cancels the rest (no new subscription per retry)', async () => {
        q.mockImplementation(async (sql: string,) => sql.includes('FROM subscriptions',) && sql.includes("status = 'incomplete'",)
            ? { rows: [
                { id: 'r1', plan_id: TIER, stripe_subscription_id: 'sub_new', },
                { id: 'r2', plan_id: TIER, stripe_subscription_id: 'sub_old', },
                { id: 'r3', plan_id: 'tier-b', stripe_subscription_id: 'sub_other', },
            ], }
            : { rows: [], },);
        stripe.subscriptions.retrieve.mockImplementation(async (id: string,) =>
            id === 'sub_other' ? sub(id, 'incomplete', 'price_b',) : sub(id, 'incomplete', 'price_a',),);
        const out = await settleOpenAttempts('u1', { tierId: TIER, priceId: 'price_a', },);
        expect(out.reuse,).toEqual({ subscriptionId: 'sub_new', clientSecret: 'sub_new_secret', },);
        expect(stripe.subscriptions.cancel.mock.calls.map((c,) => c[0],),).toEqual(['sub_old', 'sub_other',],);
        // Cancelled attempts are recorded as never-paid, not as ended memberships.
        expect(q.mock.calls.filter(([s,],) => String(s,).includes("status = 'incomplete_expired'",),).length,).toBe(2,);
    },);

    it('reports an attempt that got paid in the meantime', async () => {
        q.mockImplementation(async (sql: string,) => sql.includes("status = 'incomplete'",)
            ? { rows: [{ id: 'r1', plan_id: TIER, stripe_subscription_id: 'sub_paid', },], } : { rows: [], },);
        stripe.subscriptions.retrieve.mockResolvedValue(sub('sub_paid', 'active', 'price_a',),);
        const out = await settleOpenAttempts('u1', { tierId: TIER, priceId: 'price_a', },);
        expect(out.activated,).toBe('sub_paid',);
        expect(stripe.subscriptions.cancel,).not.toHaveBeenCalled();
    },);

    it('with no target (an approval) cancels every unpaid attempt', async () => {
        q.mockImplementation(async (sql: string,) => sql.includes("status = 'incomplete'",)
            ? { rows: [{ id: 'r1', plan_id: TIER, stripe_subscription_id: 'sub_x', },], } : { rows: [], },);
        stripe.subscriptions.retrieve.mockResolvedValue(sub('sub_x', 'incomplete', 'price_a',),);
        const out = await settleOpenAttempts('u1', null,);
        expect(out.reuse,).toBeUndefined();
        expect(stripe.subscriptions.cancel,).toHaveBeenCalledWith('sub_x',);
    },);
},);
