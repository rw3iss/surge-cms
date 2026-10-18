/**
 * Orders as an export dataset (CSV / printable page) — the same filters as the
 * admin Orders table (status, search, needs attention, dates), every page.
 * Built on the shared export model (`services/export/dataset.ts`), served from
 * the shop module so it is gated with the shop feature + its permissions.
 */
import { collectAll, deriveColumns, type ExportDataset, type Row, } from '../export/dataset';
import { formatCurrency, } from '@sitesurge/types';
import * as repo from '../../repositories/shop/shopOrders.repo';

export interface OrderExportQuery {
    status?: string;
    search?: string;
    attention?: boolean;
    from?: string;
    to?: string;
}

/** Flatten one order row for a spreadsheet — money in currency units, no secrets. */
function toRow(o: Record<string, unknown>,): Row {
    const cur = String(o.currency || 'usd',).toUpperCase();
    const money = (c: unknown,) => formatCurrency(Number(c ?? 0,), cur,);
    const ship = (o.shippingAddress ?? null) as Record<string, string> | null;
    return {
        orderNumber: o.orderNumber,
        createdAt: o.createdAt,
        status: o.status,
        fulfillmentStatus: o.fulfillmentStatus,
        customerName: o.customerName ?? '',
        customerEmail: o.customerEmail,
        subtotal: money(o.subtotalCents,),
        shipping: money(o.shippingCents,),
        shippingMethod: o.shippingMethod ?? '',
        tax: money(o.taxCents,),
        discount: money(o.discountCents,),
        total: money(o.totalCents,),
        currency: cur,
        carrier: o.carrier ?? '',
        trackingNumber: o.trackingNumber ?? '',
        trackingUrl: o.trackingUrl ?? '',
        shipName: ship?.name ?? '',
        shipLine1: ship?.line1 ?? '',
        shipLine2: ship?.line2 ?? '',
        shipCity: ship?.city ?? '',
        shipState: ship?.state ?? '',
        shipPostalCode: ship?.postalCode ?? '',
        shipCountry: ship?.country ?? '',
        notes: o.notes ?? '',
    };
}

export async function ordersDataset(q: OrderExportQuery,): Promise<ExportDataset> {
    const rows = await collectAll(async (page, limit,) => {
        const r = await repo.findOrders(
            { status: q.status, search: q.search, attention: q.attention, from: q.from, to: q.to, },
            { page, limit, },
        );
        return { rows: r.data.map((o,) => toRow(o as unknown as Record<string, unknown>,),), total: r.total, };
    },);
    const parts = [
        q.status ? `status ${q.status}` : '',
        q.attention ? 'needs attention' : '',
        q.search ? `search “${q.search}”` : '',
        q.from ? `from ${q.from}` : '',
        q.to ? `to ${q.to}` : '',
    ].filter(Boolean,);
    return {
        title: 'Shop orders',
        subtitle: parts.length ? parts.join(' · ',) : undefined,
        columns: deriveColumns(rows, { preferred: Object.keys(toRow({},),), },),
        printColumns: ['orderNumber', 'createdAt', 'customerName', 'customerEmail', 'total', 'status', 'fulfillmentStatus', 'trackingNumber',],
        rows,
    };
}
