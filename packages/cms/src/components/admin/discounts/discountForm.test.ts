import { describe, expect, it, } from 'vitest';
import { buildDiscountBody, type DiscountDraft, fromLocalInput, toLocalInput, } from './discountForm';

const base = (over: Partial<DiscountDraft> = {},): DiscountDraft => ({
    code: 'SUMMER10', kind: 'percent', percent: 10, amountDollars: '', active: true, maxUses: '', maxUsesPerUser: '', minSubtotal: '',
    startsAt: '', endsAt: '', allowedTierIds: [], allowedRoles: [], appliesToTickets: false, commissionPercent: 10, note: '', ...over,
});

describe('buildDiscountBody', () => {
    it('builds a percent code', () => {
        const r = buildDiscountBody(base(), false,);
        expect(r.ok,).toBe(true,);
        if (r.ok) expect(r.body,).toMatchObject({ code: 'SUMMER10', kind: 'percent', percent: 10, amountCents: 0, maxUses: null, note: null, },);
    },);
    it('refuses a bad or empty code', () => {
        expect(buildDiscountBody(base({ code: '', },), false,).ok,).toBe(false,);
        expect(buildDiscountBody(base({ code: 'a!', },), false,).ok,).toBe(false,);
        expect(buildDiscountBody(base({ code: '-AB', },), false,).ok,).toBe(false,);
    },);
    it('refuses a code that gives nothing', () => {
        expect(buildDiscountBody(base({ percent: 0, },), false,).ok,).toBe(false,);
        expect(buildDiscountBody(base({ kind: 'fixed', amountDollars: '', },), false,).ok,).toBe(false,);
        expect(buildDiscountBody(base({ kind: 'fixed', amountDollars: '0', },), false,).ok,).toBe(false,);
    },);
    it('converts a fixed amount to cents without float drift', () => {
        const r = buildDiscountBody(base({ kind: 'fixed', amountDollars: '19.99', minSubtotal: '0.29', },), false,);
        expect(r.ok && r.body.amountCents,).toBe(1999,);
        expect(r.ok && r.body.minSubtotalCents,).toBe(29,);
        expect(r.ok && r.body.percent,).toBe(0,);
    },);
    it('clamps percent into 0–100', () => {
        const r = buildDiscountBody(base({ percent: '250', },), false,);
        expect(r.ok && r.body.percent,).toBe(100,);
    },);
    it('affiliate: buyer discount may not exceed the commission', () => {
        expect(buildDiscountBody(base({ percent: 12, commissionPercent: 10, },), true,).ok,).toBe(false,);
        const r = buildDiscountBody(base({ kind: 'fixed', percent: 5, commissionPercent: 10, },), true,);
        expect(r.ok && r.body,).toMatchObject({ kind: 'percent', percent: 5, commissionPercent: 10, },);
        expect(buildDiscountBody(base({ percent: 0, },), true,).ok,).toBe(true,);
    },);
    it('checks limits and the window', () => {
        expect(buildDiscountBody(base({ maxUses: '1.5', },), false,).ok,).toBe(false,);
        expect(buildDiscountBody(base({ maxUsesPerUser: '0', },), false,).ok,).toBe(false,);
        expect(buildDiscountBody(base({ minSubtotal: 'abc', },), false,).ok,).toBe(false,);
        expect(buildDiscountBody(base({ startsAt: '2026-11-02T10:00', endsAt: '2026-11-01T10:00', },), false,).ok,).toBe(false,);
        const r = buildDiscountBody(base({ maxUses: '50', startsAt: '2026-11-01T10:00', endsAt: '2026-11-02T10:00', },), false,);
        expect(r.ok && r.body.maxUses,).toBe(50,);
    },);
},);

describe('datetime-local helpers', () => {
    it('round-trips', () => {
        const iso = fromLocalInput('2026-11-01T09:30',)!;
        expect(toLocalInput(iso,),).toBe('2026-11-01T09:30',);
        expect(fromLocalInput('',),).toBeNull();
        expect(toLocalInput('nonsense',),).toBe('',);
    },);
},);
