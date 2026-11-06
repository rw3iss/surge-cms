/**
 * Refund → commission reversal maths (pure; `earnings.reverseCommission` does
 * the I/O).
 *
 * A refund reverses the commission in proportion:
 *
 *   target reversed = round(commission × refunded / charged)   (full refund = all of it)
 *
 * Stripe reports the CUMULATIVE `amount_refunded`, so the target is a
 * high-water mark: only `target − already reversed` is reversed now, and a
 * repeated or out-of-date webhook reverses nothing. "Already reversed" is read
 * from the rows themselves — what was cut from the unpaid commission plus the
 * `reversal` rows — so no counter can drift from the ledger.
 *
 *   - Commission not paid (and not in a payout), no reversal rows yet → cut
 *     its amount in place; at zero it becomes `reversed`.
 *   - Otherwise (paid out, in a payout, or already reversed by rows) → a new
 *     negative `reversal` row that nets against the next payout.
 */

/** The commission as first recorded (`affiliateShareCents` = round(merch × share% / 100)). */
export function commissionOriginalCents(row: { merchSubtotalCents: number; sharePercent: number; amountCents: number; },): number {
    if (row.merchSubtotalCents > 0 && row.sharePercent > 0) {
        return Math.max(0, Math.round(row.merchSubtotalCents * row.sharePercent / 100,),);
    }
    return Math.max(0, row.amountCents,);
}

/** How much of `originalCents` a refund of `refundedCents` (of `chargedCents`) reverses in total. */
export function reversalTargetCents(originalCents: number, refundedCents: number, chargedCents: number,): number {
    if (originalCents <= 0) return 0;
    if (chargedCents <= 0 || refundedCents >= chargedCents) return originalCents;
    if (refundedCents <= 0) return 0;
    return Math.min(originalCents, Math.max(0, Math.round(originalCents * refundedCents / chargedCents,),),);
}

export type ReversalPlan =
    | { action: 'none'; }
    | { action: 'reduce'; amountCents: number; reversed: boolean; }
    | { action: 'insert'; amountCents: number; };

export function planReversal(o: {
    originalCents: number;
    /** The commission row now. */
    amountCents: number;
    status: 'earned' | 'paid' | 'reversed' | string;
    inPayout: boolean;
    /** Sum of the existing `reversal` rows (negative or 0). */
    reversalRowsCents: number;
    reversalRowCount: number;
    targetCents: number;
},): ReversalPlan {
    if (o.status === 'reversed') return { action: 'none', };
    const already = Math.max(0, o.originalCents - o.amountCents,) + Math.max(0, -o.reversalRowsCents,);
    const delta = Math.min(o.targetCents, o.originalCents,) - already;
    if (delta <= 0) return { action: 'none', };
    if (o.status === 'earned' && !o.inPayout && o.reversalRowCount === 0) {
        const left = Math.max(0, o.amountCents - delta,);
        return { action: 'reduce', amountCents: left, reversed: left === 0, };
    }
    return { action: 'insert', amountCents: -delta, };
}
