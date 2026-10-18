import { describe, expect, it, } from 'vitest';
import { parseApliiqTracking, } from './tracking';

describe('parseApliiqTracking', () => {
    it('maps a flat fulfilment payload to a shipped state', () => {
        const u = parseApliiqTracking('fulfillment', {
            OrderId: 991, OrderNumber: 'SS-ABC', Status: 'Shipped', TrackingNumber: '1Z999',
            Carrier: 'UPS', TrackingUrl: 'https://ups.example/1Z999', ShipDate: '2026-10-10T12:00:00Z',
            ShippingAddress: { name: 'Jane', line1: '1 Main', },
        },);
        expect(u,).toMatchObject({ externalOrderId: '991', orderNumber: 'SS-ABC', },);
        expect(u!.state.status,).toBe('shipped',);
        expect(u!.state.shipments,).toEqual([{
            carrier: 'UPS', number: '1Z999', url: 'https://ups.example/1Z999', shippedAt: '2026-10-10T12:00:00.000Z', deliveredAt: null,
        },],);
        // Never carries the address into the state.
        expect(JSON.stringify(u,),).not.toContain('Main',);
    },);

    it('reads several parcels and a nested order', () => {
        const u = parseApliiqTracking('fulfillment', {
            order: { id: 'A1', shipments: [{ trackingNumber: 'T1', }, { trackingNumbers: ['T2', 'T3',], },], },
        },);
        expect(u!.state.shipments.map((s,) => s.number,),).toEqual(['T1', 'T2', 'T3',],);
    },);

    it('warehouse_shipment_complete without numbers still marks shipped', () => {
        expect(parseApliiqTracking('warehouse_shipment_complete', { orderNumber: 'SS-1', },)!.state.status,).toBe('shipped',);
    },);

    it('cancelled and unattributable payloads', () => {
        expect(parseApliiqTracking('fulfillment', { id: 'x', status: 'Cancelled', },)!.state.status,).toBe('cancelled',);
        expect(parseApliiqTracking('fulfillment', { status: 'shipped', },),).toBeNull();
        expect(parseApliiqTracking('fulfillment', null,),).toBeNull();
    },);

    it('drops a non-http tracking link', () => {
        const u = parseApliiqTracking('fulfillment', { id: 'x', trackingNumber: 'T', trackingUrl: 'javascript:alert(1)', },);
        expect(u!.state.shipments[0].url,).toBeNull();
    },);
},);
