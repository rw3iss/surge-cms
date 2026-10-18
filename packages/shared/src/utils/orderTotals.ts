/**
 * The labelled lines of an order's totals — ONE definition for every surface
 * that prints them (admin order page, storefront confirmation, profile order
 * history, the order emails, the PDF receipt). They used to be four copies and
 * already disagreed: the storefront dropped Discount (so its lines did not add
 * up) and the admin omitted the "= total" on the first-item shipping line.
 */
import { formatCurrency, } from './format';

export interface OrderTotalsInput {
    subtotalCents: number;
    shippingCents: number;
    taxCents: number;
    discountCents?: number | null;
    totalCents: number;
    currency?: string | null;
    shippingMethod?: string | null;
    items?: Array<{ quantity: number; isDigital?: boolean | null; }>;
}

/** The shop's additional-item shipping rule (Shop → Shipping). */
export interface OrderTotalsShipping {
    useAdditionalItemRate?: boolean;
    additionalItemCents?: number;
}

export interface OrderTotalsLine {
    key: 'subtotal' | 'shipping' | 'shipping_first' | 'shipping_additional' | 'tax' | 'discount' | 'total';
    label: string;
    cents: number;
    /** Ready-to-print value (currency formatted; discount negative; sub-lines "n × x = y"). */
    value: string;
    /** A breakdown under the shipping line — render smaller / muted. */
    sub?: boolean;
    /** The grand total — render bold. */
    grand?: boolean;
}

/**
 * Split an authoritative shipping total into a first-item line + an
 * additional-items line, when the additional-item rate is in use. The first
 * line absorbs any remainder so the two always sum to `shippingCents`. Null
 * when the tier is off, shipping is zero, or there is ≤1 shippable unit.
 */
export function shippingBreakdown(
    shippingCents: number,
    shippableUnits: number,
    shipping: OrderTotalsShipping | null | undefined,
): { firstItemCents: number; additionalUnits: number; additionalItemCents: number; } | null {
    if (!shipping?.useAdditionalItemRate || shippingCents <= 0 || shippableUnits <= 1) return null;
    const additionalItemCents = shipping.additionalItemCents ?? 0;
    const additionalUnits = shippableUnits - 1;
    const firstItemCents = Math.max(0, shippingCents - additionalItemCents * additionalUnits,);
    return { firstItemCents, additionalUnits, additionalItemCents, };
}

/** The order's totals as labelled rows, in display order. */
export function orderTotalsLines(order: OrderTotalsInput, shipping?: OrderTotalsShipping | null,): OrderTotalsLine[] {
    const cur = (order.currency || 'usd').toUpperCase();
    // An unknown / blank currency code must not break a receipt or an email.
    const fmt = (c: number,) => {
        try {
            return formatCurrency(c, cur,);
        } catch {
            return `${((c || 0) / 100).toFixed(2,)} ${cur}`.trim();
        }
    };
    const units = (order.items ?? []).filter((i,) => !i.isDigital,).reduce((s, i,) => s + (i.quantity || 0), 0,);
    const bd = shippingBreakdown(order.shippingCents, units, shipping,);

    const lines: OrderTotalsLine[] = [
        { key: 'subtotal', label: 'Subtotal', cents: order.subtotalCents, value: fmt(order.subtotalCents,), },
        {
            key: 'shipping',
            label: order.shippingMethod ? `Shipping (${order.shippingMethod})` : 'Shipping',
            cents: order.shippingCents,
            value: fmt(order.shippingCents,),
        },
    ];
    if (bd) {
        lines.push(
            {
                key: 'shipping_first', label: 'First item shipping', cents: bd.firstItemCents, sub: true,
                value: `1 × ${fmt(bd.firstItemCents,)} = ${fmt(bd.firstItemCents,)}`,
            },
            {
                key: 'shipping_additional', label: 'Additional items shipping', cents: bd.additionalItemCents * bd.additionalUnits, sub: true,
                value: `${bd.additionalUnits} × ${fmt(bd.additionalItemCents,)} = ${fmt(bd.additionalItemCents * bd.additionalUnits,)}`,
            },
        );
    }
    lines.push({ key: 'tax', label: 'Tax', cents: order.taxCents, value: fmt(order.taxCents,), },);
    const discount = order.discountCents ?? 0;
    if (discount > 0) lines.push({ key: 'discount', label: 'Discount', cents: -discount, value: `-${fmt(discount,)}`, },);
    lines.push({ key: 'total', label: 'Total', cents: order.totalCents, value: fmt(order.totalCents,), grand: true, },);
    return lines;
}
