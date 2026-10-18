import { describe, expect, it, } from 'vitest';
import { mapPrice, } from './recurringPrices';

describe('mapPrice', () => {
    it('maps a live product price, marking the product default', () => {
        const p = mapPrice({
            id: 'price_1', nickname: 'Monthly', unit_amount: 2500, currency: 'usd', recurring: { interval: 'month', interval_count: 1, },
            product: { id: 'prod_1', name: 'Club', description: 'Members', default_price: 'price_1', },
        } as never,);
        expect(p,).toMatchObject({ priceId: 'price_1', productId: 'prod_1', productName: 'Club', productDescription: 'Members', productDeleted: false, isProductDefault: true, intervalCount: 1, },);
    },);
    it('flags a deleted product and drops its description', () => {
        const p = mapPrice({ id: 'price_2', unit_amount: 100, currency: 'usd', recurring: { interval: 'year', }, product: { id: 'prod_x', deleted: true, }, } as never,);
        expect(p.productDeleted,).toBe(true,);
        expect(p.productDescription,).toBeNull();
        expect(p.intervalCount,).toBe(1,);
    },);
},);
