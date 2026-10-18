import { describe, expect, it, } from 'vitest';
import { billingFrequency, formatMoney, isUpgrade, perMonthCents, } from './membershipPrice';

describe('membershipPrice', () => {
    it('compares prices per month across intervals', () => {
        expect(perMonthCents({ amount: 25000, interval: 'year', },),).toBeCloseTo(2083.33, 1,);
        expect(perMonthCents({ amount: 2500, interval: 'month', },),).toBe(2500,);
        expect(perMonthCents({ amount: 150000, interval: 'week', intervalCount: 2, },),).toBeCloseTo(325000, 0,);
        // $25/month → $250/year is cheaper per month, so NOT an upgrade.
        expect(isUpgrade({ amount: 25000, interval: 'year', }, { amount: 2500, interval: 'month', },),).toBe(false,);
        expect(isUpgrade({ amount: 5000, interval: 'month', }, { amount: 2500, interval: 'month', },),).toBe(true,);
    },);
    it('words billing', () => {
        expect(billingFrequency('month',),).toBe('monthly',);
        expect(billingFrequency('month', 3,),).toBe('every 3 months',);
        expect(billingFrequency('week', 2,),).toBe('bi-weekly',);
    },);
    it('formats money with the currency', () => {
        expect(formatMoney(150000, 'usd',),).toBe('$1,500.00',);
        expect(formatMoney(2500, 'eur',),).toBe('€25.00',);
    },);
},);
