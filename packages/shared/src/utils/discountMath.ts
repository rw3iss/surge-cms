/**
 * Discount-code maths — ONE definition for checkout (server), the order
 * record and anything that previews a code. Pure; all amounts in cents.
 *
 *   - A code always applies to MERCHANDISE; `appliesToTickets` also covers
 *     event-ticket lines.
 *   - percent: round(eligible × percent / 100); fixed: min(amount, eligible).
 *   - Affiliate share = (commission − buyer discount)% of the MERCHANDISE
 *     subtotal before the discount: the buyer discount is paid out of the
 *     affiliate's commission, so the shop's total cost is the commission.
 */
import { formatCurrency, } from './format';

export interface DiscountRule {
    kind: 'percent' | 'fixed';
    percent: number;
    amountCents: number;
    appliesToTickets: boolean;
}

export interface DiscountLine {
    key: string;
    subtotalCents: number;
    /** An event-ticket line (eligible only when `appliesToTickets`). */
    ticket: boolean;
}

export function eligibleLines(lines: DiscountLine[], rule: Pick<DiscountRule, 'appliesToTickets'>,): DiscountLine[] {
    return lines.filter((l,) => !l.ticket || rule.appliesToTickets,);
}

export function merchandiseSubtotal(lines: DiscountLine[],): number {
    return lines.filter((l,) => !l.ticket,).reduce((s, l,) => s + Math.max(0, l.subtotalCents,), 0,);
}

/** The discount (cents) the rule gives on these lines. */
export function discountCentsFor(rule: DiscountRule, lines: DiscountLine[],): number {
    const base = eligibleLines(lines, rule,).reduce((s, l,) => s + Math.max(0, l.subtotalCents,), 0,);
    if (base <= 0) return 0;
    const raw = rule.kind === 'fixed'
        ? Math.max(0, Math.round(rule.amountCents,),)
        : Math.round(base * Math.min(100, Math.max(0, rule.percent,),) / 100,);
    return Math.min(base, raw,);
}

/**
 * Spread a discount over the eligible lines in proportion to their subtotals
 * (for tax on discounted amounts). The parts always sum to `total`; rounding
 * leftovers go to the largest lines.
 */
export function distributeDiscount(lines: DiscountLine[], rule: Pick<DiscountRule, 'appliesToTickets'>, total: number,): Map<string, number> {
    const out = new Map<string, number>(lines.map((l,) => [l.key, 0,]),);
    const elig = eligibleLines(lines, rule,).filter((l,) => l.subtotalCents > 0,);
    const base = elig.reduce((s, l,) => s + l.subtotalCents, 0,);
    if (total <= 0 || base <= 0) return out;
    let given = 0;
    for (const l of elig) {
        const part = Math.floor(total * l.subtotalCents / base,);
        out.set(l.key, part,);
        given += part;
    }
    const bySize = [...elig,].sort((a, b,) => b.subtotalCents - a.subtotalCents,);
    for (let i = 0; given < total; i = (i + 1) % bySize.length) {
        const l = bySize[i];
        if (out.get(l.key,)! < l.subtotalCents) {
            out.set(l.key, out.get(l.key,)! + 1,);
            given++;
        }
    }
    return out;
}

/** The affiliate's share (cents): (commission − buyer discount)% of the merchandise subtotal. */
export function affiliateShareCents(merchSubtotalCents: number, commissionPercent: number, buyerDiscountPercent: number,): number {
    const share = Math.max(0, Math.min(100, commissionPercent,) - Math.max(0, buyerDiscountPercent,),);
    return Math.max(0, Math.round(Math.max(0, merchSubtotalCents,) * share / 100,),);
}

/** Percent with up to 2 decimals, trailing zeros dropped ("12.5"). */
export function formatPercent(p: number,): string {
    return String(Math.round(p * 100,) / 100,);
}

/** "10% off merchandise and tickets" / "$5.00 off merchandise". */
export function discountSummary(rule: DiscountRule, currency = 'usd',): string {
    const what = rule.appliesToTickets ? 'merchandise and tickets' : 'merchandise';
    if (rule.kind === 'fixed') return `${formatCurrency(rule.amountCents, currency.toUpperCase(),)} off ${what}`;
    return rule.percent > 0 ? `${formatPercent(rule.percent,)}% off ${what}` : 'No discount';
}
