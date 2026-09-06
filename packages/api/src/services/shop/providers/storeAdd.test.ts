/**
 * The re-publish contract.
 *
 * A provider pushing the same product again is how an EDIT reaches us — there
 * is no catalogue to pull from Apliiq — so the decision on an existing product
 * has to be `update`, not `skip`.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const rows: Array<{ id: string; }> = [];
vi.mock('../../../db', () => ({
    query: vi.fn(async () => ({ rows: rows.length ? [rows[0],] : [], })),
}));
vi.mock('../../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), }, }));

import { defaultStoreAddCheck, } from './storeAdd';

const incoming = (over: Partial<Parameters<typeof defaultStoreAddCheck>[1]> = {},) => ({
    externalId: '6068710',
    externalDesignId: '6068710',
    name: 'Mens Gold Soft Touch Tshirt',
    variants: [{ sku: 'APQ-6068710S6A1', priceCents: 2494, },],
    raw: {},
    ...over,
});

describe('defaultStoreAddCheck', () => {
    beforeEach(() => { rows.length = 0; },);

    it('creates when the product is not in the store', async () => {
        expect(await defaultStoreAddCheck('apliiq', incoming(),),).toEqual({ action: 'create', },);
    },);

    it('UPDATES when the product already exists', async () => {
        // The behaviour that matters: re-publishing is how a rename, a price
        // change or a new size reaches the store.
        rows.push({ id: 'prod-1', },);
        expect(await defaultStoreAddCheck('apliiq', incoming(),),)
            .toEqual({ action: 'update', productId: 'prod-1', },);
    },);

    it('updates regardless of whether the provider set replaceProduct', async () => {
        rows.push({ id: 'prod-1', },);
        for (const replaceProduct of [true, false, undefined,]) {
            expect(await defaultStoreAddCheck('apliiq', incoming({ replaceProduct, },),),)
                .toEqual({ action: 'update', productId: 'prod-1', },);
        }
    },);

    it('matches on the design id when the product id is absent', async () => {
        rows.push({ id: 'prod-1', },);
        const d = await defaultStoreAddCheck('apliiq', incoming({ externalId: null, },),);
        expect(d.action,).toBe('update',);
    },);
},);
