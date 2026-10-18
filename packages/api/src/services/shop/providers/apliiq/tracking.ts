/**
 * Apliiq tracking webhooks (`fulfillment`, `warehouse_shipment_complete`) →
 * the same `ProviderFulfilmentState` Printify's reconcile produces, so both
 * suppliers go through ONE write path (`applyFulfilmentState`: forward-only
 * order status, manual tracking kept, partial roll-up).
 *
 * Apliiq's payload is not formally documented; the parser is deliberately
 * tolerant of casing and of a flat vs. `shipments[]` shape, and only ever
 * reads ids, status words, carriers, numbers, links and dates — never the
 * customer's name or address (which the body also carries).
 */
import type { FulfilmentRowStatus, ProviderFulfilmentState, ProviderShipment, } from '../types';

export interface ApliiqTrackingUpdate {
    /** Apliiq's order id, when present. */
    externalOrderId: string | null;
    /** OUR order number, when Apliiq echoes it back. */
    orderNumber: string | null;
    state: ProviderFulfilmentState;
}

type Bag = Record<string, unknown>;

/** First present value among `keys`, matched case-insensitively. */
function pick(o: unknown, ...keys: string[]): unknown {
    if (!o || typeof o !== 'object') return undefined;
    const entries = Object.entries(o as Bag,);
    for (const k of keys) {
        const hit = entries.find(([key,],) => key.toLowerCase() === k.toLowerCase(),);
        if (hit && hit[1] !== undefined && hit[1] !== null && hit[1] !== '') return hit[1];
    }
    return undefined;
}

const str = (v: unknown,): string | null => (v === undefined || v === null || v === '' ? null : String(v,).trim().slice(0, 500,) || null);

function isoDate(v: unknown,): string | null {
    if (!v) return null;
    const d = new Date(String(v,),);
    return Number.isNaN(d.getTime(),) ? null : d.toISOString();
}

const httpUrl = (v: unknown,): string | null => {
    const s = str(v,);
    return s && /^https?:\/\//i.test(s,) ? s : null;
};

function shipmentsOf(body: Bag,): ProviderShipment[] {
    const list = pick(body, 'shipments', 'fulfillments', 'packages',);
    const raw: unknown[] = Array.isArray(list,) ? list : [body,];
    const out: ProviderShipment[] = [];
    for (const s of raw) {
        const numbers = pick(s, 'trackingNumbers', 'tracking_numbers',);
        const nums = Array.isArray(numbers,)
            ? numbers.map(str,).filter((x,): x is string => Boolean(x,),)
            : [str(pick(s, 'trackingNumber', 'tracking_number', 'tracking', 'trackingCode',),),].filter((x,): x is string => Boolean(x,),);
        for (const number of nums) {
            out.push({
                carrier: str(pick(s, 'carrier', 'shippingCarrier', 'shipping_carrier', 'carrierName',),),
                number,
                url: httpUrl(pick(s, 'trackingUrl', 'tracking_url', 'trackingLink',),),
                shippedAt: isoDate(pick(s, 'shippedAt', 'shipped_at', 'shipDate', 'ship_date', 'createdAt',),),
                deliveredAt: isoDate(pick(s, 'deliveredAt', 'delivered_at', 'deliveryDate',),),
            },);
        }
    }
    return out;
}

/** Parse one Apliiq tracking webhook body. Null = nothing we can attribute. */
export function parseApliiqTracking(event: string, body: unknown,): ApliiqTrackingUpdate | null {
    if (!body || typeof body !== 'object') return null;
    const root = body as Bag;
    // Some deliveries wrap the order: { order: { … } }.
    const inner = pick(root, 'order', 'data',);
    const o = (inner && typeof inner === 'object' ? inner : root) as Bag;

    const externalOrderId = str(pick(o, 'apliiqOrderId', 'orderId', 'order_id', 'id',),);
    const orderNumber = str(pick(o, 'orderNumber', 'order_number', 'number', 'externalId', 'external_id', 'reference',),);
    if (!externalOrderId && !orderNumber) return null;

    const ext = String(pick(o, 'status', 'fulfillmentStatus', 'fulfillment_status',) ?? event,).trim().toLowerCase();
    const shipments = shipmentsOf(o,);

    let status: FulfilmentRowStatus;
    if (/cancel/.test(ext,)) status = 'cancelled';
    else if (shipments.length) status = shipments.every((s,) => s.deliveredAt,) || /deliver/.test(ext,) ? 'delivered' : 'shipped';
    else if (/ship|fulfil|complete/.test(ext,) || event === 'warehouse_shipment_complete') status = 'shipped';
    else if (/hold/.test(ext,)) status = 'on_hold';
    else if (/produc|print|process/.test(ext,)) status = 'in_production';
    else status = 'pending';

    const shipped = status === 'shipped' || status === 'delivered';
    const shippedDates = shipments.map((s,) => s.shippedAt,).filter(Boolean,) as string[];
    const deliveredDates = shipments.map((s,) => s.deliveredAt,).filter(Boolean,) as string[];
    return {
        externalOrderId,
        orderNumber,
        state: {
            status,
            externalStatus: ext || event,
            shipments,
            inProductionAt: null,
            shippedAt: shipped ? (shippedDates.sort()[0] ?? new Date().toISOString()) : null,
            deliveredAt: status === 'delivered' ? (deliveredDates.sort().at(-1,) ?? null) : null,
        },
    };
}
