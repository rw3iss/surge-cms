import { describe, expect, it, } from 'vitest';
import {
    affiliateShareCents, discountCentsFor, discountSummary, distributeDiscount, merchandiseSubtotal, type DiscountLine, type DiscountRule,
} from './discountMath';

const lines: DiscountLine[] = [
    { key: 'shirt', subtotalCents: 3000, ticket: false, },
    { key: 'mug', subtotalCents: 1000, ticket: false, },
    { key: 'ticket', subtotalCents: 2000, ticket: true, },
];
const pct = (percent: number, tickets = false,): DiscountRule => ({ kind: 'percent', percent, amountCents: 0, appliesToTickets: tickets, });

describe('discountCentsFor', () => {
    it('percent off merchandise only by default', () => expect(discountCentsFor(pct(10,), lines,),).toBe(400,),);
    it('also tickets when the code says so', () => expect(discountCentsFor(pct(10, true,), lines,),).toBe(600,),);
    it('fixed never exceeds the eligible subtotal', () => {
        expect(discountCentsFor({ kind: 'fixed', percent: 0, amountCents: 500, appliesToTickets: false, }, lines,),).toBe(500,);
        expect(discountCentsFor({ kind: 'fixed', percent: 0, amountCents: 99999, appliesToTickets: false, }, lines,),).toBe(4000,);
    },);
    it('nothing on a tickets-only cart for a merchandise code', () => {
        expect(discountCentsFor(pct(50,), [lines[2],],),).toBe(0,);
    },);
    it('clamps a percent above 100', () => expect(discountCentsFor(pct(150,), lines,),).toBe(4000,),);
},);

describe('distributeDiscount', () => {
    it('splits proportionally and sums exactly', () => {
        const parts = distributeDiscount(lines, pct(10,), 401,);
        expect([...parts.values(),].reduce((a, b,) => a + b, 0,),).toBe(401,);
        expect(parts.get('ticket',),).toBe(0,);
        expect(parts.get('shirt',),).toBe(301,);
        expect(parts.get('mug',),).toBe(100,);
    },);
},);

describe('affiliateShareCents', () => {
    it('commission minus the buyer discount, on merchandise', () => {
        expect(affiliateShareCents(merchandiseSubtotal(lines,), 10, 0,),).toBe(400,);
        expect(affiliateShareCents(4000, 10, 4,),).toBe(240,);
        expect(affiliateShareCents(4000, 10, 10,),).toBe(0,);
        expect(affiliateShareCents(4000, 10, 15,),).toBe(0,);
    },);
},);

describe('discountSummary', () => {
    it('reads well', () => {
        expect(discountSummary(pct(12.5,),),).toBe('12.5% off merchandise',);
        expect(discountSummary(pct(10, true,),),).toBe('10% off merchandise and tickets',);
        expect(discountSummary({ kind: 'fixed', percent: 0, amountCents: 500, appliesToTickets: false, },),).toBe('$5.00 off merchandise',);
    },);
},);
