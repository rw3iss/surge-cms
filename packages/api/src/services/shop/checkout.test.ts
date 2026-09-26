import { beforeEach, describe, expect, it, vi, } from 'vitest';

// ── Mocks ──
vi.mock('../audit', () => ({ logAudit: vi.fn(), }),);

// Stripe secret unset by default → computeTax short-circuits to 0 without
// hitting the SDK (stripeTaxEnabled defaults false in the test settings too).
vi.mock('../../config', () => ({ config: { stripe: { secretKey: undefined, }, frontendUrl: '', }, }),);

const createPaymentIntentMock = vi.fn().mockResolvedValue({
    id: 'pi_123', clientSecret: 'cs_123', status: 'requires_payment_method',
});
vi.mock('../payment', () => ({
    getPaymentProvider: () => ({ createPaymentIntent: (...a: unknown[]) => createPaymentIntentMock(...a), }),
}),);

// top-level query(): shop_settings read + variant validation lookups.
const queryMock = vi.fn();
const txnQueries: { sql: string; params?: unknown[]; }[] = [];
const fakeClient = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
        txnQueries.push({ sql, params, },);
        return { rows: [], };
    }),
};
vi.mock('../../db', () => ({
    query: (...a: unknown[]) => queryMock(...a),
    transaction: async (cb: (c: unknown,) => Promise<unknown>,) => cb(fakeClient,),
}),);

const createOrderMock = vi.fn().mockResolvedValue({ id: 'o1', orderNumber: 'SS-TEST', });
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
    }),
}),);

// Ticket lines are priced by the events module, never from the client.
const resolveTicketLinesMock = vi.fn();
vi.mock('../events/tickets', () => ({
    resolveTicketLines: (...a: unknown[]) => resolveTicketLinesMock(...a),
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

    describe('event ticket lines', () => {
        const TICKET = {
            variantId: 'event:e1:2026-10-01:t1',
            qty: 2,
            kind: 'event_ticket' as const,
            eventId: 'e1',
            occurrenceDate: '2026-10-01',
            tierId: 't1',
            attendee: { email: 'guest@b.com', name: 'Guest', },
        };
        beforeEach(() => {
            resolveTicketLinesMock.mockReset();
            resolveTicketLinesMock.mockResolvedValue({
                lines: [{
                    eventId: 'e1', eventTitle: 'Gala', occurrenceDate: '2026-10-01', tierId: 't1',
                    tierName: 'VIP', priceCents: 1500, currency: 'USD', quantity: 2, remaining: 10,
                },],
                totalCents: 3000,
            },);
        },);

        it('prices a ticket line from the event tier, not the variant table', async () => {
            const totals = await checkout.previewCheckout({ items: [TICKET,], },);
            expect(totals.subtotalCents,).toBe(3000,);
            expect(totals.shippingCents,).toBe(0,);
            expect(queryMock,).not.toHaveBeenCalledWith(expect.stringContaining('shop_variants',), expect.anything(),);
        },);

        it('records the ticket on the order item with no product/variant id', async () => {
            await checkout.createCheckout({ items: [TICKET,], customerEmail: 'a@b.com', }, ctx,);
            const items = createOrderItemsMock.mock.calls[0][2] as Array<Record<string, unknown>>;
            expect(items[0],).toMatchObject({
                productId: null,
                variantId: null,
                quantity: 2,
                unitPriceCents: 1500,
                fulfillmentGroup: 'event_tickets',
                metadata: {
                    kind: 'event_ticket', eventId: 'e1', occurrenceDate: '2026-10-01', tierId: 't1',
                    attendee: { email: 'guest@b.com', name: 'Guest', },
                },
            },);
            const piArg = createPaymentIntentMock.mock.calls[0][0] as { amountCents: number; };
            expect(piArg.amountCents,).toBe(3000,);
        },);

        it('drops a sold-out ticket from the preview but refuses it at checkout', async () => {
            resolveTicketLinesMock.mockRejectedValue(new Error('Only 1 left',),);
            const totals = await checkout.previewCheckout({ items: [TICKET,], },);
            expect(totals.unavailableVariantIds,).toEqual([TICKET.variantId,],);
            await expect(checkout.createCheckout({ items: [TICKET,], customerEmail: 'a@b.com', }, ctx,),)
                .rejects.toThrow('Only 1 left',);
        },);
    },);
},);
