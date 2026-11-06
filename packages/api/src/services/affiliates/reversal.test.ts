import { describe, expect, it, } from 'vitest';
import { commissionOriginalCents, planReversal, reversalTargetCents, } from './reversal';

/** Applies a plan to an in-memory commission + reversal rows (what earnings.reverseCommission writes). */
function ledger(amountCents: number, status = 'earned', inPayout = false,) {
    const s = { amount: amountCents, status, inPayout, reversals: [] as number[], };
    const original = amountCents;
    return {
        s,
        refund(refunded: number, charged: number,) {
            const plan = planReversal({
                originalCents: original, amountCents: s.amount, status: s.status, inPayout: s.inPayout,
                reversalRowsCents: s.reversals.reduce((a, b,) => a + b, 0,), reversalRowCount: s.reversals.length,
                targetCents: reversalTargetCents(original, refunded, charged,),
            },);
            if (plan.action === 'reduce') plan.reversed ? (s.status = 'reversed') : (s.amount = plan.amountCents);
            if (plan.action === 'insert') s.reversals.push(plan.amountCents,);
            return plan;
        },
        /** What the affiliate nets from this order. */
        net() {
            return (s.status === 'reversed' ? 0 : s.amount) + s.reversals.reduce((a, b,) => a + b, 0,);
        },
    };
}

describe('reversalTargetCents', () => {
    it('is proportional, rounded, and complete on a full refund', () => {
        expect(reversalTargetCents(1000, 2500, 10_000,),).toBe(250,);
        expect(reversalTargetCents(333, 1, 3,),).toBe(111,);
        expect(reversalTargetCents(1000, 10_000, 10_000,),).toBe(1000,);
        expect(reversalTargetCents(1000, 12_000, 10_000,),).toBe(1000,);
        expect(reversalTargetCents(1000, 0, 10_000,),).toBe(0,);
        expect(reversalTargetCents(1000, 5, 0,),).toBe(1000,);
    });
});

describe('commissionOriginalCents', () => {
    it('rebuilds the recorded commission from subtotal × share', () => {
        expect(commissionOriginalCents({ merchSubtotalCents: 10_000, sharePercent: 7.5, amountCents: 400, },),).toBe(750,);
        expect(commissionOriginalCents({ merchSubtotalCents: 0, sharePercent: 0, amountCents: 400, },),).toBe(400,);
    });
});

describe('planReversal (cumulative partial refunds)', () => {
    it('unpaid: cuts in place, repeats are no-ops, a later full refund completes it', () => {
        const l = ledger(1000,);
        expect(l.refund(2500, 10_000,),).toEqual({ action: 'reduce', amountCents: 750, reversed: false, },);
        expect(l.refund(2500, 10_000,),).toEqual({ action: 'none', },); // webhook retry
        expect(l.refund(1000, 10_000,),).toEqual({ action: 'none', },); // stale event, lower cumulative
        expect(l.refund(5000, 10_000,),).toEqual({ action: 'reduce', amountCents: 500, reversed: false, },);
        expect(l.net(),).toBe(500,);
        expect(l.refund(10_000, 10_000,),).toEqual({ action: 'reduce', amountCents: 0, reversed: true, },);
        expect(l.net(),).toBe(0,);
        expect(l.refund(10_000, 10_000,),).toEqual({ action: 'none', },);
    });

    it('paid: adds reversal rows for each increase, never over-reverses', () => {
        const l = ledger(1000, 'paid',);
        expect(l.refund(2500, 10_000,),).toEqual({ action: 'insert', amountCents: -250, },);
        expect(l.refund(2500, 10_000,),).toEqual({ action: 'none', },);
        expect(l.refund(6000, 10_000,),).toEqual({ action: 'insert', amountCents: -350, },);
        expect(l.refund(10_000, 10_000,),).toEqual({ action: 'insert', amountCents: -400, },);
        expect(l.net(),).toBe(0,);
        expect(l.refund(10_000, 10_000,),).toEqual({ action: 'none', },);
    });

    it('cut while unpaid, then paid out: later refunds add rows for the remainder only', () => {
        const l = ledger(1000,);
        l.refund(3000, 10_000,); // 700 left, paid out
        l.s.status = 'paid';
        expect(l.refund(10_000, 10_000,),).toEqual({ action: 'insert', amountCents: -700, },);
        expect(l.net(),).toBe(0,);
    });

    it('in a payout: a row rather than editing the claimed commission', () => {
        const l = ledger(1000, 'earned', true,);
        expect(l.refund(5000, 10_000,),).toEqual({ action: 'insert', amountCents: -500, },);
    });

    it('a full refund of an untouched unpaid commission marks it reversed', () => {
        expect(ledger(1000,).refund(10_000, 10_000,),).toEqual({ action: 'reduce', amountCents: 0, reversed: true, },);
    });
});
