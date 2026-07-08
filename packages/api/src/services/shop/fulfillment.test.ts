import { beforeEach, describe, expect, it, vi, } from 'vitest';

// ── Mocks ──
vi.mock('./receipt', () => ({ sendOrderReceipt: vi.fn(), }),);

const queryMock = vi.fn(async () => ({ rows: [], }));
const fakeClient = { query: vi.fn(async () => ({ rows: [], rowCount: 0, })), };
vi.mock('../../db', () => ({
    query: (...a: unknown[]) => queryMock(...a),
    transaction: async (cb: (c: unknown,) => Promise<unknown>,) => cb(fakeClient,),
}),);

const markOrderPaidMock = vi.fn();
const findOrderItemsForFulfillmentMock = vi.fn();
const decrementInventoryMock = vi.fn().mockResolvedValue({ ok: true, },);
const setDownloadTokenMock = vi.fn().mockResolvedValue(undefined,);
const findOrderByIdMock = vi.fn().mockResolvedValue({ id: 'o1', items: [], customerEmail: 'a@b.com', },);
vi.mock('../../repositories/shop/shopOrders.repo', () => ({
    markOrderPaid: (...a: unknown[]) => markOrderPaidMock(...a),
    findOrderItemsForFulfillment: (...a: unknown[]) => findOrderItemsForFulfillmentMock(...a),
    decrementInventory: (...a: unknown[]) => decrementInventoryMock(...a),
    setDownloadToken: (...a: unknown[]) => setDownloadTokenMock(...a),
    findOrderById: (...a: unknown[]) => findOrderByIdMock(...a),
}),);

import { fulfillShopOrder, } from './fulfillment';

function pi(overrides: Record<string, unknown> = {},) {
    return {
        id: 'pi_1', latest_charge: 'ch_1',
        metadata: { orderType: 'shop', orderId: 'o1', orderNumber: 'SS-1', },
        ...overrides,
    } as never;
}

describe('shop order fulfillment', () => {
    beforeEach(() => {
        queryMock.mockClear();
        fakeClient.query.mockClear();
        markOrderPaidMock.mockReset();
        findOrderItemsForFulfillmentMock.mockReset();
        decrementInventoryMock.mockClear();
        setDownloadTokenMock.mockClear();
        // shop_orders lookup inside the txn (for the transactions insert) +
        // the post-commit re-read.
        queryMock.mockResolvedValue({ rows: [{ id: 'o1', order_number: 'SS-1', }], },);
        fakeClient.query.mockResolvedValue({ rows: [{ user_id: null, total_cents: 2500, currency: 'usd', order_number: 'SS-1', }], rowCount: 1, },);
    },);

    it('marks the order paid and decrements inventory for each variant item', async () => {
        markOrderPaidMock.mockResolvedValue({ updated: true, },);
        findOrderItemsForFulfillmentMock.mockResolvedValue([
            { id: 'oi1', variantId: 'v1', quantity: 2, isDigital: false, },
            { id: 'oi2', variantId: 'v2', quantity: 1, isDigital: false, },
        ],);
        await fulfillShopOrder(pi(),);
        expect(markOrderPaidMock,).toHaveBeenCalledWith(fakeClient, 'o1', { stripeChargeId: 'ch_1', },);
        expect(decrementInventoryMock,).toHaveBeenCalledTimes(2,);
        expect(decrementInventoryMock,).toHaveBeenCalledWith(fakeClient, 'v1', 2,);
        expect(decrementInventoryMock,).toHaveBeenCalledWith(fakeClient, 'v2', 1,);
    },);

    it('is idempotent: an already-paid order is a no-op (no inventory/token work)', async () => {
        markOrderPaidMock.mockResolvedValue({ updated: false, },);
        await fulfillShopOrder(pi(),);
        expect(findOrderItemsForFulfillmentMock,).not.toHaveBeenCalled();
        expect(decrementInventoryMock,).not.toHaveBeenCalled();
        expect(setDownloadTokenMock,).not.toHaveBeenCalled();
    },);

    it('generates a download token for each digital item', async () => {
        markOrderPaidMock.mockResolvedValue({ updated: true, },);
        findOrderItemsForFulfillmentMock.mockResolvedValue([
            { id: 'oi1', variantId: 'v1', quantity: 1, isDigital: true, },
            { id: 'oi2', variantId: null, quantity: 1, isDigital: true, },
        ],);
        await fulfillShopOrder(pi(),);
        expect(setDownloadTokenMock,).toHaveBeenCalledTimes(2,);
        // token is a non-empty hex string
        const tokenArg = setDownloadTokenMock.mock.calls[0][2] as string;
        expect(typeof tokenArg,).toBe('string',);
        expect(tokenArg.length,).toBeGreaterThan(0,);
    },);
},);
