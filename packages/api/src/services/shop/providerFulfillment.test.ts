/**
 * Supplier fulfilment roll-up + the reconcile write path: forward-only order
 * status, partial for mixed suppliers, first-parcel tracking aggregate, and
 * idempotent writes.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), }, }),);

// A tiny in-memory stand-in for the two tables applyFulfilmentState touches.
interface Row { [k: string]: unknown; }
const db = { order: {} as Row, fulfil: null as Row | null, writes: 0, };
const query = vi.fn(async (sql: string, params: unknown[] = [],) => {
    if (/FROM shop_order_fulfillments WHERE order_id = \$1 AND provider = \$2/.test(sql,)) {
        return { rows: db.fulfil ? [db.fulfil,] : [], };
    }
    if (/^SELECT status FROM shop_orders/.test(sql.trim(),)) return { rows: [{ status: db.order.status, },], };
    if (/INSERT INTO shop_order_fulfillments/.test(sql,)) {
        db.writes++;
        const [, , ext, status, extStatus, shipments, nums, carrier, url, inProd, shipped, delivered,] = params;
        db.fulfil = {
            external_order_id: ext, status, external_status: extStatus, shipments: JSON.parse(String(shipments,),),
            tracking_numbers: nums, carrier, tracking_url: url,
            in_production_at: inProd ? new Date(String(inProd,),) : null,
            shipped_at: shipped ? new Date(String(shipped,),) : null,
            delivered_at: delivered ? new Date(String(delivered,),) : null,
        };
        return { rows: [], };
    }
    if (/SELECT o.status,[\s\S]*EXISTS/.test(sql,)) {
        return {
            rows: [{
                status: db.order.status, has_native: false, tracking_number: db.order.tracking_number ?? null,
                tracking_url: db.order.tracking_url ?? null, carrier: db.order.carrier ?? null,
                tracking_manual: db.order.tracking_manual ?? false,
            },],
        };
    }
    if (/SELECT status, shipments, tracking_numbers/.test(sql,)) return { rows: db.fulfil ? [db.fulfil,] : [], };
    if (/^UPDATE shop_orders/.test(sql.trim(),)) {
        const [, fs, st, num, url, carrier,] = params;
        db.order.fulfillment_status = fs;
        if (st) db.order.status = st;
        db.order.tracking_number = num;
        db.order.tracking_url = url;
        db.order.carrier = carrier;
        return { rows: [], };
    }
    return { rows: [], };
},);
vi.mock('../../db', () => ({ query, }),);

const { applyFulfilmentState, computeRollUp, mergeOrderTracking, } = await import('./providerFulfillment');

const shipment = (number: string, deliveredAt: string | null = null,) => ({
    carrier: 'ONTRAC', number, url: `https://t/${number}`, shippedAt: '2026-10-16T09:00:16.000Z', deliveredAt,
});

describe('computeRollUp', () => {
    it('moves a paid order forward to shipped / delivered', () => {
        expect(computeRollUp([{ status: 'shipped', },], 'paid', false,),).toMatchObject({
            fulfillmentStatus: 'fulfilled', orderStatus: 'shipped',
        },);
        expect(computeRollUp([{ status: 'delivered', },], 'shipped', false,).orderStatus,).toBe('delivered',);
        expect(computeRollUp([{ status: 'in_production', },], 'paid', false,),).toMatchObject({
            fulfillmentStatus: 'unfulfilled', orderStatus: 'processing',
        },);
    },);

    it('never moves backwards, nor touches cancelled / refunded / pending', () => {
        expect(computeRollUp([{ status: 'shipped', },], 'delivered', false,).orderStatus,).toBeNull();
        expect(computeRollUp([{ status: 'delivered', },], 'refunded', false,).orderStatus,).toBeNull();
        expect(computeRollUp([{ status: 'delivered', },], 'cancelled', false,).orderStatus,).toBeNull();
        expect(computeRollUp([{ status: 'delivered', },], 'pending', false,).orderStatus,).toBeNull();
    },);

    it('partial with two suppliers, or a part-shipped one', () => {
        expect(computeRollUp([{ status: 'shipped', }, { status: 'in_production', },], 'paid', false,),)
            .toMatchObject({ fulfillmentStatus: 'partial', orderStatus: 'processing', },);
        expect(computeRollUp([{ status: 'partially_shipped', },], 'paid', false,).fulfillmentStatus,).toBe('partial',);
    },);

    it('an order with lines we ship ourselves stops at processing', () => {
        expect(computeRollUp([{ status: 'delivered', },], 'paid', true,).orderStatus,).toBe('processing',);
    },);

    it('tracking aggregate = the first parcel of the first supplier with one', () => {
        const r = computeRollUp([
            { status: 'in_production', shipments: [], },
            { status: 'shipped', shipments: [shipment('A',), shipment('B',),], },
        ], 'paid', false,);
        expect(r.tracking,).toEqual({ number: 'A', carrier: 'ONTRAC', url: 'https://t/A', },);
    },);
},);

describe('applyFulfilmentState', () => {
    beforeEach(() => {
        db.order = { status: 'paid', fulfillment_status: 'unfulfilled', tracking_number: null, };
        db.fulfil = { external_order_id: 'pf1', status: 'submitted', external_status: null, shipments: null,
            in_production_at: null, shipped_at: null, delivered_at: null, };
        db.writes = 0;
    },);

    const state = {
        status: 'shipped' as const, externalStatus: 'fulfilled', shipments: [shipment('A',),],
        inProductionAt: '2026-10-13T00:56:00.000Z', shippedAt: '2026-10-15T17:07:58.000Z', deliveredAt: null,
    };

    it('writes the state, rolls the order up, then is a no-op on the same input', async () => {
        const first = await applyFulfilmentState('o1', 'printify', 'pf1', state,);
        expect(first,).toMatchObject({ changed: true, linked: false, orderStatusBefore: 'paid', orderStatusAfter: 'shipped', },);
        expect(db.order.tracking_number,).toBe('A',);

        const again = await applyFulfilmentState('o1', 'printify', 'pf1', state,);
        expect(again.changed,).toBe(false,);
        expect(again.orderStatusAfter,).toBe('shipped',);
        expect(db.writes,).toBe(1,);
    },);

    it('is a no-op when the stored jsonb comes back with its keys reordered', async () => {
        await applyFulfilmentState('o1', 'printify', 'pf1', state,);
        // Postgres jsonb orders keys by length then bytes: url, number, carrier, …
        db.fulfil!.shipments = (db.fulfil!.shipments as Array<Record<string, unknown>>).map((x,) => ({
            url: x.url, number: x.number, carrier: x.carrier, shippedAt: x.shippedAt, deliveredAt: x.deliveredAt,
        }));
        const again = await applyFulfilmentState('o1', 'printify', 'pf1', state,);
        expect(again.changed,).toBe(false,);
        expect(db.writes,).toBe(1,);
    },);

    it('never overwrites tracking an admin typed (tracking_manual)', async () => {
        db.order.tracking_number = 'MINE';
        db.order.tracking_url = 'https://mine.example/MINE';
        db.order.carrier = 'UPS';
        db.order.tracking_manual = true;
        await applyFulfilmentState('o1', 'printify', 'pf1', state,);
        expect(db.order,).toMatchObject({
            status: 'shipped', tracking_number: 'MINE', tracking_url: 'https://mine.example/MINE', carrier: 'UPS',
        },);
    },);

    it('replaces sync-written tracking with the supplier\'s latest first parcel', async () => {
        db.order.tracking_number = 'OLD';
        db.order.tracking_manual = false;
        await applyFulfilmentState('o1', 'printify', 'pf1', state,);
        expect(db.order,).toMatchObject({ tracking_number: 'A', tracking_url: 'https://t/A', carrier: 'ONTRAC', },);
    },);

    it('links an order that has no supplier row yet', async () => {
        db.fulfil = null;
        const r = await applyFulfilmentState('o1', 'printify', 'pf9', state,);
        expect(r.linked,).toBe(true,);
        expect(db.fulfil?.external_order_id,).toBe('pf9',);
    },);

    it('refuses to relink an order tied to another supplier order', async () => {
        const r = await applyFulfilmentState('o1', 'printify', 'pfOTHER', state,);
        expect(r.conflict,).toBe('pf1',);
        expect(db.writes,).toBe(0,);
    },);
},);

describe('mergeOrderTracking', () => {
    const supplier = { number: 'S1', url: 'https://s/S1', carrier: 'USPS', };
    it('keeps manual columns', () => {
        expect(mergeOrderTracking({ number: 'M', url: null, carrier: null, manual: true, }, supplier,),)
            .toEqual({ number: 'M', url: null, carrier: null, },);
    },);
    it('fills empty columns and takes newer supplier values when not manual', () => {
        expect(mergeOrderTracking({ number: null, url: null, carrier: null, manual: false, }, supplier,),).toEqual(supplier,);
        expect(mergeOrderTracking({ number: 'X', url: 'https://x', carrier: 'UPS', manual: false, }, { number: null, url: null, carrier: null, },),)
            .toEqual({ number: 'X', url: 'https://x', carrier: 'UPS', },);
    },);
},);
