import { describe, expect, it, } from 'vitest';
import { centsToDollarsInput, clampPercent, formatMoney, parseDollars, payoutStatusForAdmin, payoutStatusForPartner, stripeState, } from './money';

describe('parseDollars', () => {
    it('reads plain, decimal, $ and comma amounts as cents', () => {
        expect(parseDollars('40',),).toBe(4000,);
        expect(parseDollars('40.5',),).toBe(4050,);
        expect(parseDollars('$1,000.25',),).toBe(100025,);
        expect(parseDollars('0',),).toBe(0,);
    },);
    it('rounds float artifacts (19.99 → 1999)', () => {
        expect(parseDollars('19.99',),).toBe(1999,);
        expect(parseDollars('0.29',),).toBe(29,);
        expect(parseDollars('1.005',),).toBe(101,);
    },);
    it('refuses blank, negative and junk', () => {
        expect(parseDollars('',),).toBeNull();
        expect(parseDollars('   ',),).toBeNull();
        expect(parseDollars('.',),).toBeNull();
        expect(parseDollars('-5',),).toBeNull();
        expect(parseDollars('abc',),).toBeNull();
        expect(parseDollars('1e3',),).toBeNull();
        expect(parseDollars(undefined,),).toBeNull();
    },);
    it('round-trips centsToDollarsInput', () => {
        expect(parseDollars(centsToDollarsInput(1999,),),).toBe(1999,);
    },);
},);

describe('clampPercent', () => {
    it('keeps a value inside the range', () => {
        expect(clampPercent('12.5',),).toBe(12.5,);
        expect(clampPercent('150',),).toBe(100,);
        expect(clampPercent('-3',),).toBe(0,);
        expect(clampPercent('8', 5,),).toBe(5,);
        expect(clampPercent('',),).toBe(0,);
        expect(clampPercent('x',),).toBe(0,);
    },);
},);

describe('formatMoney', () => {
    it('formats cents in any-case currency, null-safe', () => {
        expect(formatMoney(4000,),).toBe('$40.00',);
        expect(formatMoney(4000, 'usd',),).toBe('$40.00',);
        expect(formatMoney(null,),).toBe('$0.00',);
        expect(formatMoney(undefined, '',),).toBe('$0.00',);
    },);
},);

describe('status labels', () => {
    it('payout status', () => {
        expect(payoutStatusForPartner('paid',),).toBe('Sent',);
        expect(payoutStatusForPartner('pending',),).toBe('Processing',);
        expect(payoutStatusForAdmin('failed',),).toBe('Failed',);
    },);
    it('stripe state', () => {
        expect(stripeState({ connected: true, payoutsEnabled: true, },).tone,).toBe('success',);
        expect(stripeState({ connected: true, payoutsEnabled: false, },).label,).toBe('Setup not finished',);
        expect(stripeState({ connected: false, payoutsEnabled: false, },).tone,).toBe('muted',);
    },);
},);
