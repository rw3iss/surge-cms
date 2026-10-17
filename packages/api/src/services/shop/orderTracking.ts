/**
 * Attach resolved tracking (`ShopOrder.shipments`) to orders on read.
 *
 * The parcels live on `shop_order_fulfillments` (one row per supplier, its
 * `shipments` JSONB — or the flat `tracking_numbers` / `carrier` / `tracking_url`
 * of a row written before migration 157); the order-level columns are the
 * fallback and the admin's manual override. The display rules themselves are in
 * `@sitesurge/types` (`resolveOrderShipments`), shared by every surface.
 */
import type { ShopOrder, ShopTrackingSettings, } from '@sitesurge/types';
import { resolveOrderShipments, type SupplierParcel, } from '@sitesurge/types';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { getShopSettings, } from './settings';

interface FulfilmentRow {
    order_id: string;
    provider: string;
    shipments: Array<{
        carrier?: string | null; number?: string | null; url?: string | null;
        shippedAt?: string | null; deliveredAt?: string | null;
    }> | null;
    tracking_numbers: string[] | null;
    carrier: string | null;
    tracking_url: string | null;
    shipped_at: Date | string | null;
    delivered_at: Date | string | null;
}

const iso = (v: Date | string | null | undefined,): string | null => (v ? new Date(v,).toISOString() : null);

/** Supplier parcels per order id, in supplier-row creation order. */
export async function loadParcels(orderIds: string[],): Promise<Map<string, SupplierParcel[]>> {
    const out = new Map<string, SupplierParcel[]>();
    if (!orderIds.length) return out;
    const r = await query<FulfilmentRow>(
        `SELECT order_id, provider, shipments, tracking_numbers, carrier, tracking_url, shipped_at, delivered_at
           FROM shop_order_fulfillments
          WHERE order_id = ANY($1::uuid[])
          ORDER BY created_at, provider`,
        [orderIds,],
    );
    for (const row of r.rows) {
        const list = out.get(row.order_id,) ?? [];
        if (row.shipments?.length) {
            for (const s of row.shipments) {
                list.push({
                    provider: row.provider, carrier: s.carrier ?? null, number: s.number ?? null, url: s.url ?? null,
                    shippedAt: s.shippedAt ?? null, deliveredAt: s.deliveredAt ?? null,
                },);
            }
        } else {
            // A row from before per-parcel detail: one entry per number, sharing
            // the row's carrier / link / dates.
            for (const number of row.tracking_numbers ?? []) {
                list.push({
                    provider: row.provider, carrier: row.carrier, number, url: row.tracking_url,
                    shippedAt: iso(row.shipped_at,), deliveredAt: iso(row.delivered_at,),
                },);
            }
        }
        out.set(row.order_id, list,);
    }
    return out;
}

async function trackingSettings(): Promise<ShopTrackingSettings | null> {
    try {
        return (await getShopSettings()).tracking ?? null;
    } catch {
        return null;
    }
}

/** The orders with `shipments` filled in. A failed read degrades to the
 *  order-level columns rather than failing the whole order read. */
export async function attachShipmentsMany<T extends ShopOrder,>(orders: T[],): Promise<T[]> {
    if (!orders.length) return orders;
    const settings = await trackingSettings();
    let parcels = new Map<string, SupplierParcel[]>();
    try {
        parcels = await loadParcels(orders.map((o,) => o.id),);
    } catch (err) {
        logger.warn('Could not load order shipments', { error: err, },);
    }
    return orders.map((o,) => ({ ...o, shipments: resolveOrderShipments(o, parcels.get(o.id,) ?? [], settings,), }));
}

export async function attachShipments<T extends ShopOrder,>(order: T,): Promise<T> {
    return (await attachShipmentsMany([order,],))[0]!;
}
