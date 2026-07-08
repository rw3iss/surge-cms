import { beforeEach, describe, expect, it, vi, } from 'vitest';

// ── Mocks ──
vi.mock('../audit', () => ({ logAudit: vi.fn(), }),);

// Stripe secret unset by default → computeTax short-circuits to 0 without
// hitting the SDK (stripeTaxEnabled defaults false in the test settings too).
vi.mock('../../config', () => ({ config: { stripe: { secretKey: undefined, }, frontendUrl: '', }, }),);

const createPaymentIntentMock = vi.fn().mockResolvedValue({
    id: 'pi_123', clientSecret: 'cs_123', status: 'requires_payment_method',
},);
vi.mock('../payment', () => ({
    getPaymentProvider: () => ({ createPaymentIntent: (...a: unknown[]) => createPaymentIntentMock(...a), }),
}),);

// top-level query(): shop_settings read + variant validation lookups.
const queryMock = vi.fn();
const txnQueries: { sql: string; params?: unknown[]; }[] = [];
const fakeClient = {
    query: vi.fn(async (sql: string, params?: unknown[],) => {
        txnQueries.push({ sql, params, },);
        return { rows: [], };
    }),
};
vi.mock('../../db', () => ({
    query: (...a: unknown[]) => queryMock(...a),
    transaction: async (cb: (c: unknown,) => Promise<unknown>,) => cb(fakeClient,),
}),);

const createOrderMock = vi.fn().mockResolvedValue({ id: 'o1', orderNumber: 'SS-TEST', },);
const createOrderItemsMock = vi.fn().mockResolvedValue([],);
vi.mock('../../repositories/shop/shopOrders.repo', () => ({
    createOrder: (...a: unknown[]) => createOrderMock(...a),
    createOrderItems: (...a: unknown[]) => createOrderItemsMock(...a),
}),);

// Shop config comes from the settings service now (not an inline reader).
// Mock it so this suite exercises only checkout's validation/total logic:
// tax off, no flat shipping, usd.
vi.mock('./settings', () => ({
    getShopSettings: vi.fn().mockResolvedValue({
        currency: 'usd', taxEnabled: false, businessName: '', storeEnabled: true,
    },),
}),);

import * as checkout from './checkout';

const ctx = { userId: 'u1', ipAddress: '', userAgent: '', };

// Helper: a variant lookup row.
function variantRow(overrides: Record<string, unknown> = {},) {
    return {
        rows: [{
            variant_id: 'v1', product_id: 'p1', price_cents: 2500, inventory_qty: 10,
            sku: 'SKU1', requires_shipping: true, option1: 'M', option2: null, option3: null,
            title: 'Shirt', type: 'physical', status: 'active', ...overrides,
        }],
    };
}

describe('shop checkout service', () => {
    beforeEach(() => {
        queryMock.mockReset();
        txnQueries.length = 0;
        fakeClient.query.mockClear();
        createPaymentIntentMock.mockClear();
        createOrderMock.mockClear();
        createOrderItemsMock.mockClear();
    },);

    it('rejects checkout when a variant has insufficient inventory (409)', async () => {
        // Shop config comes from the mocked settings service; queryMock now
        // only serves the variant lookup.
        queryMock
            .mockResolvedValueOnce(variantRow({ inventory_qty: 1, }),); // variant: only 1 in stock
        await expect(
            checkout.createCheckout(
                { items: [{ variantId: 'v1', qty: 5, },], customerEmail: 'a@b.com', }, ctx,
            ),
        ).rejects.toMatchObject({ statusCode: 409, },);
        expect(createOrderMock,).not.toHaveBeenCalled();
    },);

    it('computes subtotal from DB prices, ignoring any client-supplied price', async () => {
        queryMock
            .mockResolvedValueOnce(variantRow({ price_cents: 2500, },),); // DB says 2500
        // Client sends only {variantId, qty} — no price channel exists.
        const totals = await checkout.previewCheckout({ items: [{ variantId: 'v1', qty: 2, },], },);
        expect(totals.subtotalCents,).toBe(5000,); // 2 × 2500 from the DB
        expect(totals.totalCents,).toBe(5000,); // tax off, all-physical but no flat rate
    },);

    it('creates the order + items + a PaymentIntent tagged orderType=shop', async () => {
        queryMock
            .mockResolvedValueOnce(variantRow(),);
        const result = await checkout.createCheckout(
            { items: [{ variantId: 'v1', qty: 1, },], customerEmail: 'a@b.com', customerName: 'A', }, ctx,
        );
        expect(createOrderMock,).toHaveBeenCalledTimes(1,);
        expect(createOrderItemsMock,).toHaveBeenCalledTimes(1,);
        expect(createPaymentIntentMock,).toHaveBeenCalledTimes(1,);
        const piArg = createPaymentIntentMock.mock.calls[0][0] as { metadata: Record<string, string>; amountCents: number; };
        expect(piArg.metadata.orderType,).toBe('shop',);
        expect(piArg.metadata.orderId,).toBe('o1',);
        expect(piArg.amountCents,).toBe(2500,);
        expect(result.clientSecret,).toBe('cs_123',);
        expect(result.orderNumber,).toBe('SS-TEST',);
    },);
},);
