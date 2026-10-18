/**
 * Printify order reconcile: status mapping, matching our orders (id /
 * external_id / label; foreign orders skipped), and the order roll-up.
 * Fixtures are shaped on real Printify responses (ids/addresses removed).
 */
import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), }, }),);
vi.mock('../../db', () => ({ query: vi.fn(), }),);

const { buildOrderIndex, mapPrintifyOrder, matchPrintifyOrder, printifyDate, } = await import('./orderSync');
type Order = Parameters<typeof mapPrintifyOrder>[0];

const base = (over: Partial<Order> = {},): Order => ({
    id: 'pf1',
    status: 'pending',
    created_at: '2026-10-14 15:14:54+00:00',
    metadata: { order_type: 'api', shop_order_id: 'SS-A', shop_order_label: 'SS-A', },
    line_items: [{ id: 'li1', status: 'pending', },],
    shipments: null,
    ...over,
});

describe('printifyDate', () => {
    it('parses Printify timestamps to ISO', () => {
        expect(printifyDate('2026-10-14 15:28:13+00:00',),).toBe('2026-10-14T15:28:13.000Z',);
        expect(printifyDate(null,),).toBeNull();
        expect(printifyDate('nope',),).toBeNull();
    },);
},);

describe('mapPrintifyOrder', () => {
    it('pending / on hold / in production before anything ships', () => {
        expect(mapPrintifyOrder(base(),).status,).toBe('pending',);
        expect(mapPrintifyOrder(base({ status: 'payment-not-received', },),).status,).toBe('on_hold',);
        expect(mapPrintifyOrder(base({ status: 'on-hold', },),).status,).toBe('on_hold',);
        const prod = mapPrintifyOrder(base({
            status: 'in-production', sent_to_production_at: '2026-10-14 15:19:53+00:00',
            line_items: [{ id: 'li1', status: 'in-production', },],
        },),);
        expect(prod.status,).toBe('in_production',);
        expect(prod.inProductionAt,).toBe('2026-10-14T15:19:53.000Z',);
        expect(prod.shippedAt,).toBeNull();
    },);

    it('fulfilled with a parcel in transit = shipped, with tracking', () => {
        const s = mapPrintifyOrder(base({
            status: 'fulfilled',
            fulfilled_at: '2026-10-16 09:00:16+00:00',
            line_items: [{ id: 'li1', status: 'shipment_in_transit', fulfilled_at: '2026-10-16 09:00:16+00:00', },],
            shipments: [{ carrier: 'ONTRAC', number: '1LSCYM0001FODHC', url: 'https://t/1', delivered_at: null, line_item_ids: ['li1',], },],
        },),);
        expect(s.status,).toBe('shipped',);
        expect(s.externalStatus,).toBe('fulfilled',);
        expect(s.shippedAt,).toBe('2026-10-16T09:00:16.000Z',);
        expect(s.deliveredAt,).toBeNull();
        expect(s.shipments,).toEqual([{
            carrier: 'ONTRAC', number: '1LSCYM0001FODHC', url: 'https://t/1',
            shippedAt: '2026-10-16T09:00:16.000Z', deliveredAt: null,
        },],);
    },);

    it('every parcel delivered = delivered; repeated parcels collapse to one', () => {
        const s = mapPrintifyOrder(base({
            status: 'fulfilled',
            fulfilled_at: '2026-10-03 12:02:31+00:00',
            line_items: [
                { id: 'a', status: 'shipment_delivered', fulfilled_at: '2026-09-29 09:25:46+00:00', },
                { id: 'b', status: 'shipment_delivered', fulfilled_at: '2026-09-29 09:25:46+00:00', },
                { id: 'c', status: 'shipment_delivered', fulfilled_at: '2026-10-03 12:02:31+00:00', },
            ],
            shipments: [
                { carrier: 'USPS', number: 'U1', url: 'u', delivered_at: '2026-10-15 21:53:28+00:00', line_item_ids: ['a',], },
                { carrier: 'USPS', number: 'U1', url: 'u', delivered_at: '2026-10-15 21:53:28+00:00', line_item_ids: ['b',], },
                { carrier: 'DHL', number: 'D1', url: 'd', delivered_at: '2026-10-03 19:09:00+00:00', line_item_ids: ['c',], },
            ],
        },),);
        expect(s.status,).toBe('delivered',);
        expect(s.shipments.map((x,) => x.number),).toEqual(['U1', 'D1',],);
        expect(s.deliveredAt,).toBe('2026-10-15T21:53:28.000Z',);
    },);

    it('a parcel out while other items still print = partially shipped', () => {
        const s = mapPrintifyOrder(base({
            status: 'partially-fulfilled',
            line_items: [{ id: 'a', status: 'shipment_in_transit', }, { id: 'b', status: 'in-production', },],
            shipments: [{ carrier: 'DHL', number: 'D1', line_item_ids: ['a',], },],
        },),);
        expect(s.status,).toBe('partially_shipped',);
    },);

    it('one parcel delivered, another still in transit = shipped (not delivered)', () => {
        const s = mapPrintifyOrder(base({
            status: 'fulfilled',
            line_items: [{ id: 'a', status: 'shipment_delivered', }, { id: 'b', status: 'shipment_in_transit', },],
            shipments: [
                { number: 'X', delivered_at: '2026-10-10 00:00:00+00:00', line_item_ids: ['a',], },
                { number: 'Y', delivered_at: null, line_item_ids: ['b',], },
            ],
        },),);
        expect(s.status,).toBe('shipped',);
    },);

    it('cancelled', () => {
        expect(mapPrintifyOrder(base({ status: 'canceled', },),).status,).toBe('cancelled',);
        expect(mapPrintifyOrder(base({ status: 'pending', line_items: [{ status: 'canceled', },], },),).status,).toBe('cancelled',);
    },);
},);

describe('matchPrintifyOrder', () => {
    const refs = [
        { orderId: 'o1', orderNumber: 'SS-A', customerEmail: 'a@x', externalOrderId: 'pf1', rowStatus: 'submitted', },
        { orderId: 'o2', orderNumber: 'SS-B', customerEmail: 'b@x', externalOrderId: null, rowStatus: null, },
        { orderId: 'o3', orderNumber: 'SS-C', customerEmail: 'c@x', externalOrderId: 'pfOTHER', rowStatus: 'submitted', },
    ];
    const idx = buildOrderIndex(refs,);

    it('matches by the stored Printify id first', () => {
        const m = matchPrintifyOrder(base({ id: 'pf1', metadata: { shop_order_id: 'SS-B', }, },), idx,);
        expect(m?.ref.orderId,).toBe('o1',);
        expect(m?.via,).toBe('id',);
    },);

    it('then external_id / metadata.shop_order_id', () => {
        expect(matchPrintifyOrder(base({ id: 'n1', external_id: 'SS-B', metadata: null, },), idx,),)
            .toMatchObject({ ref: { orderId: 'o2', }, via: 'external_id', conflict: false, },);
        expect(matchPrintifyOrder(base({ id: 'n2', metadata: { shop_order_id: 'SS-B', }, },), idx,),)
            .toMatchObject({ ref: { orderId: 'o2', }, via: 'external_id', },);
    },);

    it('then label / metadata.shop_order_label', () => {
        expect(matchPrintifyOrder(base({ id: 'n3', label: 'SS-B', metadata: null, },), idx,),)
            .toMatchObject({ ref: { orderId: 'o2', }, via: 'label', },);
        expect(matchPrintifyOrder(base({ id: 'n4', metadata: { shop_order_label: ' SS-B ', }, },), idx,),)
            .toMatchObject({ ref: { orderId: 'o2', }, via: 'label', },);
    },);

    it('skips Printify orders that are not ours (manual / sample)', () => {
        expect(matchPrintifyOrder(base({ id: 'm1', metadata: { order_type: 'manual', }, },), idx,),).toBeNull();
        expect(matchPrintifyOrder(base({ id: 's1', metadata: { order_type: 'sample', }, label: 'Sample', },), idx,),).toBeNull();
    },);

    it('a manual order LABELLED with our number is flagged unconfirmed, never linked silently', () => {
        expect(matchPrintifyOrder(base({ id: 'm2', label: 'SS-B', metadata: { order_type: 'manual', }, },), idx,),)
            .toMatchObject({ ref: { orderId: 'o2', }, unconfirmed: true, },);
        // A plain API order with the same label is matched as before.
        expect(matchPrintifyOrder(base({ id: 'm3', label: 'SS-B', metadata: null, },), idx,)?.unconfirmed,).toBeUndefined();
    },);

    it('flags an order already linked to a different Printify order', () => {
        expect(matchPrintifyOrder(base({ id: 'pfNEW', metadata: { shop_order_id: 'SS-C', }, },), idx,),)
            .toMatchObject({ ref: { orderId: 'o3', }, conflict: true, },);
    },);
},);
