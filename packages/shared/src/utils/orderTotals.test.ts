import { describe, expect, it, } from 'vitest';
import { orderTotalsLines, shippingBreakdown, } from './orderTotals';

const ORDER = {
    subtotalCents: 3000, shippingCents: 1200, taxCents: 240, discountCents: 500, totalCents: 3940, currency: 'usd',
    shippingMethod: 'Standard', items: [{ quantity: 3, isDigital: false, }, { quantity: 1, isDigital: true, },],
};

describe('orderTotalsLines', () => {
    it('includes the discount so the lines add up', () => {
        const lines = orderTotalsLines(ORDER,);
        expect(lines.map((l,) => l.key,),).toEqual(['subtotal', 'shipping', 'tax', 'discount', 'total',],);
        const sum = lines.filter((l,) => !l.grand && !l.sub,).reduce((s, l,) => s + l.cents, 0,);
        expect(sum,).toBe(ORDER.totalCents,);
        expect(lines.find((l,) => l.key === 'shipping',)!.label,).toBe('Shipping (Standard)',);
        expect(lines.find((l,) => l.key === 'discount',)!.value,).toBe('-$5.00',);
    },);

    it('adds the first/additional shipping breakdown with "= total" on both', () => {
        const lines = orderTotalsLines(ORDER, { useAdditionalItemRate: true, additionalItemCents: 300, },);
        const first = lines.find((l,) => l.key === 'shipping_first',)!;
        const add = lines.find((l,) => l.key === 'shipping_additional',)!;
        expect(first.value,).toBe('1 × $6.00 = $6.00',);
        expect(add.value,).toBe('2 × $3.00 = $6.00',);
        expect(first.cents + add.cents,).toBe(1200,);
    },);

    it('no breakdown for one shippable unit or free shipping', () => {
        expect(shippingBreakdown(500, 1, { useAdditionalItemRate: true, additionalItemCents: 100, },),).toBeNull();
        expect(shippingBreakdown(0, 3, { useAdditionalItemRate: true, additionalItemCents: 100, },),).toBeNull();
    },);
},);

describe('orderTotalsLines — bad currency', () => {
    it('falls back to plain amounts instead of throwing', () => {
        const lines = orderTotalsLines({ ...ORDER, currency: 'XXXXX', },);
        expect(lines.find((l,) => l.key === 'total',)!.value,).toBe('39.40 XXXXX',);
    },);
},);
