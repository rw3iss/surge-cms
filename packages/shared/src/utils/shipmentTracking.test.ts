import { describe, expect, it, } from 'vitest';
import {
    carrierLabel,
    DEFAULT_CARRIER_TRACKING_TEMPLATES,
    findCarrierTemplate,
    resolveOrderShipments,
    resolveTrackingUrl,
} from './shipmentTracking';

describe('carrierLabel', () => {
    it('maps known codes to brand names', () => {
        expect(carrierLabel('ONTRAC',),).toBe('OnTrac',);
        expect(carrierLabel('DHL_eCommerce_Expedited',),).toBe('DHL eCommerce Expedited',);
        expect(carrierLabel('usps',),).toBe('USPS',);
        expect(carrierLabel('FedEx',),).toBe('FedEx',);
        expect(carrierLabel('DHL',),).toBe('DHL',);
    });
    it('title-cases an unknown code', () => {
        expect(carrierLabel('CANADA_POST_EXPEDITED',),).toBe('Canada Post Expedited',);
        expect(carrierLabel('ups_ground_saver',),).toBe('UPS Ground Saver',);
    });
    it('is null for empty', () => {
        expect(carrierLabel(null,),).toBeNull();
        expect(carrierLabel('  ',),).toBeNull();
    });
});

describe('findCarrierTemplate', () => {
    it('prefers the longest matching prefix', () => {
        expect(findCarrierTemplate('DHL_eCommerce_Expedited', DEFAULT_CARRIER_TRACKING_TEMPLATES,)?.carrier,).toBe('DHL_ECOMMERCE',);
        expect(findCarrierTemplate('DHL', DEFAULT_CARRIER_TRACKING_TEMPLATES,)?.carrier,).toBe('DHL',);
        expect(findCarrierTemplate('OnTrac', DEFAULT_CARRIER_TRACKING_TEMPLATES,)?.carrier,).toBe('ONTRAC',);
        expect(findCarrierTemplate('Royal Mail', DEFAULT_CARRIER_TRACKING_TEMPLATES,),).toBeNull();
    });
});

describe('resolveTrackingUrl precedence', () => {
    const input = { carrier: 'ONTRAC', number: 'D1 23', };
    it('manual URL wins', () => {
        expect(resolveTrackingUrl({ ...input, manualUrl: 'https://m.example/1', supplierUrl: 'https://s.example/1', },),)
            .toBe('https://m.example/1',);
    });
    it('then the supplier URL (default on)', () => {
        expect(resolveTrackingUrl({ ...input, supplierUrl: 'https://s.example/1', },),).toBe('https://s.example/1',);
    });
    it('then the carrier template, number URL-encoded', () => {
        expect(resolveTrackingUrl(input,),).toBe('https://www.ontrac.com/tracking/?number=D1%2023',);
    });
    it('skips the supplier URL when the shop says always use templates', () => {
        expect(resolveTrackingUrl({ ...input, supplierUrl: 'https://s.example/1', }, { useSupplierLinks: false, },),)
            .toBe('https://www.ontrac.com/tracking/?number=D1%2023',);
    });
    it('uses the operator templates instead of the defaults, and none when emptied', () => {
        const carriers = [{ carrier: 'ontrac', urlTemplate: 'https://x.example/t/{number}', },];
        expect(resolveTrackingUrl(input, { carriers, },),).toBe('https://x.example/t/D1%2023',);
        expect(resolveTrackingUrl(input, { carriers: [], },),).toBeNull();
    });
    it('refuses non-http links', () => {
        expect(resolveTrackingUrl({ manualUrl: 'javascript:alert(1)', carrier: 'zzz', number: '1', },),).toBeNull();
    });
});

describe('resolveOrderShipments', () => {
    const parcels = [
        { provider: 'printify', carrier: 'USPS', number: 'A1', url: 'https://aftership.example/A1', shippedAt: '2026-10-01T00:00:00.000Z', deliveredAt: null, },
        { provider: 'printify', carrier: 'DHL_eCommerce_Expedited', number: 'B2', url: null, shippedAt: null, deliveredAt: null, },
        { provider: 'printify', carrier: 'USPS', number: 'A1', url: null, shippedAt: null, deliveredAt: null, },
    ];
    it('lists every supplier parcel once, with labels and links', () => {
        const out = resolveOrderShipments({ trackingNumber: 'A1', carrier: 'USPS', }, parcels,);
        expect(out.map((s,) => [s.carrierLabel, s.number, s.url, s.source,]),).toEqual([
            ['USPS', 'A1', 'https://aftership.example/A1', 'supplier',],
            ['DHL eCommerce Expedited', 'B2', 'https://webtrack.dhlecommerce.com/?trackingnumber=B2', 'supplier',],
        ],);
        expect(out[0]!.shippedAt,).toBe('2026-10-01T00:00:00.000Z',);
    });
    it('puts a manual entry first and drops the supplier parcel it replaces', () => {
        const out = resolveOrderShipments(
            { trackingNumber: 'A1', carrier: 'UPS', trackingUrl: 'https://mine.example/A1', trackingManual: true, },
            parcels,
        );
        expect(out.map((s,) => [s.carrierLabel, s.number, s.url, s.source,]),).toEqual([
            ['UPS', 'A1', 'https://mine.example/A1', 'manual',],
            ['DHL eCommerce Expedited', 'B2', 'https://webtrack.dhlecommerce.com/?trackingnumber=B2', 'supplier',],
        ],);
    });
    it('falls back to the order-level columns of an older order', () => {
        const out = resolveOrderShipments({ trackingNumber: 'Z9', carrier: 'ONTRAC', trackingUrl: null, }, [],);
        expect(out,).toEqual([expect.objectContaining({
            carrierLabel: 'OnTrac', number: 'Z9', url: 'https://www.ontrac.com/tracking/?number=Z9', source: 'order',
        },),],);
    });
    it('is empty with no tracking', () => {
        expect(resolveOrderShipments({}, [],),).toEqual([],);
    });
});
