import { beforeEach, describe, expect, it, vi, } from 'vitest';

vi.mock('../audit', () => ({ logAudit: vi.fn(), }),);
const sendBuyerReceiptMock = vi.fn();
const sendOrderStatusEmailMock = vi.fn();
vi.mock('./orderEmails', () => ({
    sendBuyerReceipt: (...a: unknown[]) => sendBuyerReceiptMock(...a),
    sendOrderStatusEmail: (...a: unknown[]) => sendOrderStatusEmailMock(...a),
}),);
vi.mock('./orderTracking', () => ({
    attachShipments: async (o: unknown,) => o,
    attachShipmentsMany: async (o: unknown,) => o,
}),);
vi.mock('../../config', () => ({ config: { stripe: { secretKey: undefined, }, frontendUrl: '', }, }),);
const refundsCreate = vi.fn();
const getStripeClientMock = vi.fn((): unknown => null);
vi.mock('../payment/stripe', () => ({ getStripeClient: (...a: unknown[]) => getStripeClientMock(...(a as [])), }),);

const findOrdersMock = vi.fn().mockResolvedValue({ data: [], total: 0, });
const findOrderByIdMock = vi.fn();
const updateOrderMock = vi.fn();
const findOrderByNumberMock = vi.fn();
vi.mock('../../repositories/shop/shopOrders.repo', () => ({
    findOrders: (...a: unknown[]) => findOrdersMock(...a),
    findOrderById: (...a: unknown[]) => findOrderByIdMock(...a),
    findOrderByNumber: (...a: unknown[]) => findOrderByNumberMock(...a),
    updateOrder: (...a: unknown[]) => updateOrderMock(...a),
    findDigitalItemByToken: vi.fn(),
    findDigitalFileUrl: vi.fn(),
}),);

import * as orders from './orders';

describe('shop orders service — role-shaped reads', () => {
    beforeEach(() => {
        findOrdersMock.mockClear();
        findOrderByIdMock.mockReset();
        updateOrderMock.mockReset();
        sendBuyerReceiptMock.mockClear();
        sendOrderStatusEmailMock.mockClear();
    });

    it('admin list passes NO user/email filter (sees all orders)', async () => {
        await orders.list({}, { isAdmin: true, userId: 'admin1', email: 'admin@x.com', },);
        const filters = findOrdersMock.mock.calls[0][0] as { userId?: string; email?: string; };
        expect(filters.userId,).toBeUndefined();
        expect(filters.email,).toBeUndefined();
    },);

    it('user list scopes to their own user_id + email', async () => {
        await orders.list({}, { isAdmin: false, userId: 'u1', email: 'u1@x.com', },);
        const filters = findOrdersMock.mock.calls[0][0] as { userId?: string; email?: string; };
        expect(filters.userId,).toBe('u1',);
        expect(filters.email,).toBe('u1@x.com',);
    },);

    it('a user with no id and no email owns nothing (empty list, no query)', async () => {
        const result = await orders.list({}, { isAdmin: false, userId: null, email: null, },);
        expect(result.data,).toEqual([],);
        expect(findOrdersMock,).not.toHaveBeenCalled();
    },);

    it('get() returns any order for an admin', async () => {
        findOrderByIdMock.mockResolvedValue({ id: 'o1', userId: 'someoneElse', customerEmail: 'x@y.com', items: [], },);
        const out = await orders.get('o1', { isAdmin: true, userId: 'admin1', },);
        expect(out.id,).toBe('o1',);
    },);

    it('get() 404s when a non-admin requests an order they do not own', async () => {
        findOrderByIdMock.mockResolvedValue({ id: 'o1', userId: 'other', customerEmail: 'other@x.com', items: [], },);
        await expect(
            orders.get('o1', { isAdmin: false, userId: 'u1', email: 'u1@x.com', },),
        ).rejects.toMatchObject({ statusCode: 404, },);
    },);

    it('get() returns the order for the owning user', async () => {
        findOrderByIdMock.mockResolvedValue({ id: 'o1', userId: 'u1', customerEmail: 'u1@x.com', items: [], },);
        const out = await orders.get('o1', { isAdmin: false, userId: 'u1', email: 'u1@x.com', },);
        expect(out.id,).toBe('o1',);
    },);
},);

describe('shop orders service — status-update email on admin update', () => {
    const auditCtx = { userId: 'admin1', ipAddress: '127.0.0.1', userAgent: 'test', };

    beforeEach(() => {
        findOrderByIdMock.mockReset();
        updateOrderMock.mockReset();
        sendOrderStatusEmailMock.mockClear();
    },);

    it('notifyCustomer:true + a status change sends the status email', async () => {
        // existing (status: paid) → updated (status: shipped)
        findOrderByIdMock
            .mockResolvedValueOnce({ id: 'o1', status: 'paid', items: [], customerEmail: 'a@b.com', },)
            .mockResolvedValueOnce({ id: 'o1', status: 'shipped', items: [], customerEmail: 'a@b.com', },);
        updateOrderMock.mockResolvedValue({},);

        await orders.update('o1', { status: 'shipped', notifyCustomer: true, }, auditCtx,);

        expect(sendOrderStatusEmailMock,).toHaveBeenCalledTimes(1,);
        // prevStatus is passed as the second arg
        expect(sendOrderStatusEmailMock.mock.calls[0][1],).toBe('paid',);
    },);

    it('notifyCustomer:false does NOT send the status email even on a status change', async () => {
        findOrderByIdMock
            .mockResolvedValueOnce({ id: 'o1', status: 'paid', items: [], customerEmail: 'a@b.com', },)
            .mockResolvedValueOnce({ id: 'o1', status: 'shipped', items: [], customerEmail: 'a@b.com', },);
        updateOrderMock.mockResolvedValue({},);

        await orders.update('o1', { status: 'shipped', notifyCustomer: false, }, auditCtx,);

        expect(sendOrderStatusEmailMock,).not.toHaveBeenCalled();
    },);

    it('notifyCustomer:true but NO status change (same status) does NOT send', async () => {
        findOrderByIdMock
            .mockResolvedValueOnce({ id: 'o1', status: 'paid', items: [], customerEmail: 'a@b.com', },)
            .mockResolvedValueOnce({ id: 'o1', status: 'paid', items: [], customerEmail: 'a@b.com', },);
        updateOrderMock.mockResolvedValue({},);

        // tracking-only update, status omitted → no email
        await orders.update('o1', { trackingNumber: 'T1', notifyCustomer: true, }, auditCtx,);

        expect(sendOrderStatusEmailMock,).not.toHaveBeenCalled();
    },);
},);

describe('trackingPatch — manual tracking', () => {
    it('marks tracking manual when any tracking field is sent, blank → null', () => {
        expect(orders.trackingPatch({ trackingNumber: ' 1Z9 ', carrier: '', },),).toEqual({
            trackingNumber: '1Z9', carrier: null, trackingUrl: undefined, trackingManual: true,
        },);
    },);
    it('leaves tracking alone when none is sent', () => {
        expect(orders.trackingPatch({ notes: 'x', },),).toEqual({
            trackingNumber: undefined, carrier: undefined, trackingUrl: undefined, trackingManual: undefined,
        },);
    },);
    it('honours an explicit trackingManual: false (hand back to the sync)', () => {
        expect(orders.trackingPatch({ trackingManual: false, },).trackingManual,).toBe(false,);
        expect(orders.trackingPatch({ trackingUrl: 'https://t.example/1', trackingManual: false, },).trackingManual,).toBe(false,);
    },);
},);

describe('shop orders service — refunds', () => {
    const ctx = { userId: 'admin1', ipAddress: '127.0.0.1', userAgent: 'test', };
    beforeEach(() => {
        refundsCreate.mockReset();
        getStripeClientMock.mockReset();
        findOrderByIdMock.mockReset();
        updateOrderMock.mockReset();
        findOrderByIdMock.mockResolvedValue({ id: 'o1', status: 'paid', stripePaymentIntentId: 'pi_1', customerEmail: 'a@b', items: [], },);
    },);

    it('refunds through the SHOP Stripe context with an idempotency key', async () => {
        getStripeClientMock.mockReturnValue({ refunds: { create: refundsCreate, }, },);
        await orders.update('o1', { status: 'refunded', }, ctx,);
        expect(getStripeClientMock,).toHaveBeenCalledWith('shop',);
        expect(refundsCreate,).toHaveBeenCalledWith({ payment_intent: 'pi_1', }, { idempotencyKey: 'refund:o1', },);
        expect(updateOrderMock,).toHaveBeenCalled();
    },);

    it('an order already refunded in Stripe still flips to refunded', async () => {
        refundsCreate.mockRejectedValue(Object.assign(new Error('already',), { code: 'charge_already_refunded', },),);
        getStripeClientMock.mockReturnValue({ refunds: { create: refundsCreate, }, },);
        await orders.update('o1', { status: 'refunded', }, ctx,);
        expect(updateOrderMock.mock.calls[0][1],).toMatchObject({ status: 'refunded', },);
    },);

    it('no shop Stripe key → a clear error, nothing written', async () => {
        await expect(orders.update('o1', { status: 'refunded', }, ctx,),).rejects.toThrow(/not configured/,);
        expect(updateOrderMock,).not.toHaveBeenCalled();
    },);
},);

describe('shop orders service — order-number projection', () => {
    const ORDER = {
        id: 'o1', orderNumber: 'SS-1', userId: 'u1', customerEmail: 'Jane@X.com', customerName: 'Jane',
        accessKey: 'k'.repeat(32), shippingAddress: { line1: '1 Main', }, stripePaymentIntentId: 'pi',
        items: [{ id: 'i1', isDigital: true, downloadToken: 'dl-secret', },],
    };
    beforeEach(() => findOrderByNumberMock.mockResolvedValue(ORDER,));

    it('the number alone reveals no identity and no download tokens', async () => {
        const o = await orders.getByNumber('SS-1', { isAdmin: false, },);
        expect(o,).toMatchObject({ customerEmail: '', customerName: null, accessKey: null, shippingAddress: null, },);
        expect(o!.items[0].downloadToken,).toBeNull();
    },);

    it('the access key unlocks name, email and downloads (still no address)', async () => {
        const o = await orders.getByNumber('SS-1', { isAdmin: false, accessKey: 'k'.repeat(32), },);
        expect(o,).toMatchObject({ customerEmail: 'Jane@X.com', customerName: 'Jane', shippingAddress: null, },);
        expect(o!.items[0].downloadToken,).toBe('dl-secret',);
    },);

    it('a wrong key is treated as no key', async () => {
        const o = await orders.getByNumber('SS-1', { isAdmin: false, accessKey: 'x'.repeat(32), },);
        expect(o!.items[0].downloadToken,).toBeNull();
    },);

    it('the signed-in owner (email any case) is trusted', async () => {
        const o = await orders.getByNumber('SS-1', { isAdmin: false, email: 'jane@x.com', },);
        expect(o!.items[0].downloadToken,).toBe('dl-secret',);
    },);

    it('owner email matching is case-insensitive for get() too', async () => {
        findOrderByIdMock.mockResolvedValue({ ...ORDER, userId: null, },);
        await expect(orders.get('o1', { isAdmin: false, email: 'JANE@x.com', },),).resolves.toMatchObject({ id: 'o1', },);
    },);
},);
