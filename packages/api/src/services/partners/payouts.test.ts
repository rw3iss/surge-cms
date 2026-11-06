import { beforeEach, describe, expect, it, vi, } from 'vitest';

/** A tiny in-memory model of affiliate_earnings + affiliate_payouts, driven by the SQL the payout code sends. */
const db = vi.hoisted(() => {
    interface Earning { id: string; amount: number; currency: string; payout_id: string | null; status: string; }
    interface Payout { id: string; status: string; amount: number; currency: string; created_at: Date; error?: string; transfer?: string; }
    const s = { earnings: [] as Earning[], payouts: [] as Payout[], seq: 0, };
    const payable = () => s.earnings.filter((e,) => e.status === 'earned' && !e.payout_id,);
    async function run(sql: string, p: unknown[] = [],): Promise<{ rows: unknown[]; rowCount: number; }> {
        const rows = (r: unknown[],) => ({ rows: r, rowCount: r.length, });
        if (/SELECT currency FROM \w+_earnings/.test(sql,)) return rows(payable().slice(0, 1,).map((e,) => ({ currency: e.currency, })),);
        if (/INSERT INTO affiliate_payouts/.test(sql,)) {
            const x: Payout = { id: `po${++s.seq}`, status: 'pending', amount: 0, currency: String(p[1],), created_at: new Date(), };
            s.payouts.push(x,);
            return rows([{ id: x.id, created_at: x.created_at, },],);
        }
        if (/SET payout_id = \$2/.test(sql,)) {
            const claimed = payable().filter((e,) => e.currency === p[2],);
            claimed.forEach((e,) => { e.payout_id = String(p[1],); },);
            return rows(claimed.map((e,) => ({ amount_cents: e.amount, })),);
        }
        if (/SET payout_id = NULL/.test(sql,)) {
            s.earnings.filter((e,) => e.payout_id === p[0],).forEach((e,) => { e.payout_id = null; },);
            return rows([],);
        }
        if (/DELETE FROM affiliate_payouts/.test(sql,)) { s.payouts = s.payouts.filter((x,) => x.id !== p[0],); return rows([],); }
        if (/UPDATE affiliate_payouts SET amount_cents/.test(sql,)) { s.payouts.find((x,) => x.id === p[0],)!.amount = Number(p[1],); return rows([],); }
        if (/UPDATE affiliate_payouts SET status = 'paid'/.test(sql,)) {
            const x = s.payouts.find((y,) => y.id === p[0],)!; x.status = 'paid'; x.transfer = String(p[1],); return rows([],);
        }
        if (/UPDATE \w+_earnings SET status = 'paid'/.test(sql,)) {
            s.earnings.filter((e,) => e.payout_id === p[0],).forEach((e,) => { e.status = 'paid'; },);
            return rows([],);
        }
        if (/UPDATE affiliate_payouts SET status = 'failed'/.test(sql,)) {
            const x = s.payouts.find((y,) => y.id === p[0],)!; x.status = 'failed'; x.error = String(p[1],); return rows([],);
        }
        if (/UPDATE affiliate_payouts SET error/.test(sql,)) { s.payouts.find((y,) => y.id === p[0],)!.error = String(p[1],); return rows([],); }
        if (/status = 'pending' AND amount_cents > 0/.test(sql,)) {
            return rows(s.payouts.filter((x,) => x.status === 'pending' && x.amount > 0,)
                .map((x,) => ({ id: x.id, amount_cents: x.amount, currency: x.currency, created_at: x.created_at, })),);
        }
        throw new Error(`unexpected SQL: ${sql}`,);
    }
    return { s, run, };
},);

const stripe = vi.hoisted(() => ({
    create: vi.fn(),
    list: vi.fn(async () => ({ data: [] as unknown[], }),),
}),);

vi.mock('../../db', () => ({
    query: (sql: string, p?: unknown[],) => db.run(sql, p,),
    transaction: async (fn: (c: { query: typeof db.run; },) => unknown,) => fn({ query: db.run, },),
}),);
vi.mock('../audit', () => ({ logAudit: vi.fn(async () => {},), }),);
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), }, }),);
vi.mock('./stripeConnect', () => ({
    accountRow: vi.fn(async () => ({ user_id: 'u1', stripe_account_id: 'acct_1', details_submitted: true, payouts_enabled: true, }),),
    stripeForPartners: () => ({ transfers: { create: stripe.create, list: stripe.list, }, }),
}),);

import { isAmbiguousTransferError, payOutSource, } from './payouts';

const stripeErr = (type: string, statusCode?: number,) => Object.assign(new Error(type,), { type, statusCode, },);

beforeEach(() => {
    db.s.earnings = [
        { id: 'e1', amount: 1500, currency: 'usd', payout_id: null, status: 'earned', },
        { id: 'e2', amount: 500, currency: 'usd', payout_id: null, status: 'earned', },
    ];
    db.s.payouts = [];
    stripe.create.mockReset();
    stripe.list.mockReset();
    stripe.list.mockResolvedValue({ data: [], },);
},);

describe('isAmbiguousTransferError', () => {
    it('network / 5xx / unknown errors may have created the transfer', () => {
        expect(isAmbiguousTransferError(stripeErr('StripeConnectionError',),),).toBe(true,);
        expect(isAmbiguousTransferError(stripeErr('StripeAPIError', 500,),),).toBe(true,);
        expect(isAmbiguousTransferError(new Error('socket hang up',),),).toBe(true,);
    },);
    it('a Stripe 4xx is a refusal', () => {
        expect(isAmbiguousTransferError(stripeErr('StripeInvalidRequestError', 400,),),).toBe(false,);
        expect(isAmbiguousTransferError(stripeErr('StripeRateLimitError', 429,),),).toBe(false,);
    },);
},);

describe('payOutSource', () => {
    it('pays the payable balance in one transfer and marks every row paid', async () => {
        stripe.create.mockResolvedValue({ id: 'tr_1', },);
        const r = await payOutSource('u1', 'affiliate', 'manual', 'admin',);
        expect(r,).toMatchObject({ paid: true, amountCents: 2000, },);
        expect(stripe.create,).toHaveBeenCalledTimes(1,);
        expect(db.s.earnings.every((e,) => e.status === 'paid',),).toBe(true,);
        expect(db.s.payouts[0],).toMatchObject({ status: 'paid', transfer: 'tr_1', },);
    },);

    it('a definite refusal fails the payout and releases the earnings', async () => {
        stripe.create.mockRejectedValue(stripeErr('StripeInvalidRequestError', 400,),);
        const r = await payOutSource('u1', 'affiliate', 'manual', 'admin',);
        expect(r.paid,).toBe(false,);
        expect(db.s.payouts[0].status,).toBe('failed',);
        expect(db.s.earnings.every((e,) => e.payout_id === null && e.status === 'earned',),).toBe(true,);
    },);

    it('an unclear failure keeps the claim; the next run finds the transfer instead of paying again', async () => {
        stripe.create.mockRejectedValueOnce(stripeErr('StripeConnectionError',),);
        const first = await payOutSource('u1', 'affiliate', 'manual', 'admin',);
        expect(first.paid,).toBe(false,);
        expect(db.s.payouts[0].status,).toBe('pending',);
        expect(db.s.earnings.every((e,) => e.payout_id === db.s.payouts[0].id,),).toBe(true,);

        // Too soon: the first call may still be in flight elsewhere.
        expect((await payOutSource('u1', 'affiliate', 'manual', 'admin',)).message,).toMatch(/in progress/,);

        db.s.payouts[0].created_at = new Date(Date.now() - 10 * 60_000,);
        stripe.list.mockResolvedValueOnce({ data: [{ id: 'tr_existing', },], },);
        const second = await payOutSource('u1', 'affiliate', 'manual', 'admin',);
        expect(second,).toMatchObject({ paid: true, amountCents: 2000, },);
        expect(stripe.create,).toHaveBeenCalledTimes(1,); // never created a second transfer
        expect(db.s.payouts[0],).toMatchObject({ status: 'paid', transfer: 'tr_existing', },);
    },);

    it('a resumed payout with no transfer at Stripe retries with the SAME idempotency key', async () => {
        stripe.create.mockRejectedValueOnce(stripeErr('StripeAPIError', 503,),);
        await payOutSource('u1', 'affiliate', 'manual', 'admin',);
        db.s.payouts[0].created_at = new Date(Date.now() - 10 * 60_000,);
        stripe.create.mockResolvedValueOnce({ id: 'tr_2', },);
        const r = await payOutSource('u1', 'affiliate', 'auto', null,);
        expect(r.paid,).toBe(true,);
        const keys = stripe.create.mock.calls.map((c,) => (c[1] as { idempotencyKey: string; }).idempotencyKey,);
        expect(keys[0],).toBe(keys[1],);
        expect(db.s.payouts.length,).toBe(1,);
    },);

    it('nothing payable → no payout row is left behind', async () => {
        db.s.earnings = [];
        const r = await payOutSource('u1', 'contribution', 'manual', 'admin',);
        expect(r.paid,).toBe(false,);
        expect(db.s.payouts,).toEqual([],);
    },);
},);
