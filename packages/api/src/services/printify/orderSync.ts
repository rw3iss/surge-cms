/**
 * Printify order reconcile — brings OUR orders in line with Printify's.
 *
 * Reads the store's orders from Printify, matches each to one of ours, links any
 * that are not linked yet, and records status + every shipment on the
 * `shop_order_fulfillments` row (then rolls the order up). Printify orders that
 * are not ours (Manual / Sample orders made in the Printify dashboard, or
 * another store's) are counted and ignored.
 *
 * Matching, strongest first:
 *   1. the Printify order id we stored (fulfilment row, or the legacy
 *      `shop_orders.printify_order_id`);
 *   2. Printify `external_id`, else `metadata.shop_order_id` — set from our
 *      order number when we created the order (the list endpoint reports it in
 *      `metadata`, not as `external_id`);
 *   3. Printify `label`, else `metadata.shop_order_label` — also our number.
 *
 * Idempotent: an unchanged Printify order writes nothing.
 *
 * Buyer emails: a reconcile that moves an order to shipped/delivered would be
 * the natural moment for the buyer's "your order shipped" email. That is held
 * back by {@link SEND_CUSTOMER_SHIPPING_EMAILS_ON_SYNC} (off): the run lists
 * what it WOULD send and logs it, nothing goes to customers.
 */
import type {
    ShopProviderCustomerEmail,
    ShopProviderOrderReconcileItem,
    ShopProviderOrderReconcileResult,
} from '@sitesurge/types';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import type { FulfilmentRowStatus, ProviderFulfilmentState, ProviderShipment, } from '../shop/providers/types';
import type { PrintifyConfig, } from './config';
import { getOrder, listOrdersPage, } from './client';

/**
 * THE switch for buyer shipping emails sent by the order reconcile (cron +
 * "Sync from Printify"). Off: nothing is sent; the result's
 * `customerEmailsNotSent` and the log say what would have been. Turn on only
 * once the operator has checked those emails (purpose `shop_order_shipped`).
 */
export const SEND_CUSTOMER_SHIPPING_EMAILS_ON_SYNC = false;

const PROVIDER = 'printify';
/** Printify caps the orders list at 10 per page. */
const PAGE_SIZE = 10;
const MAX_PAGES = 40;
/** Linked orders missing from the listing are fetched one by one, up to this. */
const MAX_DIRECT_FETCHES = 25;

// ─── Printify wire shapes (only what we read) ──────────────────────────

export interface PrintifyApiShipment {
    carrier?: string | null;
    number?: string | null;
    url?: string | null;
    delivered_at?: string | null;
    line_item_ids?: string[];
}

export interface PrintifyApiLineItem {
    id?: string;
    status?: string;
    sent_to_production_at?: string | null;
    fulfilled_at?: string | null;
}

export interface PrintifyApiOrder {
    id: string;
    app_order_id?: string;
    external_id?: string | null;
    label?: string | null;
    status?: string;
    created_at?: string;
    sent_to_production_at?: string | null;
    fulfilled_at?: string | null;
    metadata?: {
        order_type?: string;
        shop_order_id?: string | number | null;
        shop_order_label?: string | null;
    } | null;
    shipments?: PrintifyApiShipment[] | null;
    line_items?: PrintifyApiLineItem[] | null;
}

// ─── Pure: status mapping ──────────────────────────────────────────────

/** Printify writes "2026-10-14 15:28:13+00:00"; return ISO or null. */
export function printifyDate(v: string | null | undefined,): string | null {
    if (!v) return null;
    const d = new Date(String(v,).replace(' ', 'T',),);
    return Number.isNaN(d.getTime(),) ? null : d.toISOString();
}

const minDate = (xs: Array<string | null>,): string | null =>
    xs.filter(Boolean,).sort()[0] ?? null;
const maxDate = (xs: Array<string | null>,): string | null =>
    xs.filter(Boolean,).sort().at(-1,) ?? null;

/** Line-item statuses that mean "not shipped yet". */
const PRE_SHIP_ITEM = new Set([
    'pending', 'on-hold', 'sending-to-production', 'in-production', 'has-issues', 'had-issues',
    'payment-not-received',
],);
const CANCELLED = new Set(['canceled', 'cancelled',],);
const IN_PRODUCTION = new Set(['in-production', 'sending-to-production',],);
const ON_HOLD = new Set(['on-hold', 'payment-not-received', 'has-issues', 'had-issues',],);

/**
 * Map one Printify order to our fulfilment state.
 *
 * Printify's order status says little about the parcel once it leaves
 * (`fulfilled` = handed to the carrier); delivery is per shipment
 * (`delivered_at`) and per line item (`shipment_delivered`). So: parcels decide
 * shipped / delivered, the order status decides everything before that.
 */
export function mapPrintifyOrder(o: PrintifyApiOrder,): ProviderFulfilmentState {
    const ext = String(o.status ?? '',).toLowerCase();
    const items = (o.line_items ?? []).filter((li,) => !CANCELLED.has(String(li.status ?? '',).toLowerCase(),),);
    const itemById = new Map(items.filter((li,) => li.id,).map((li,) => [li.id!, li,]),);

    // One entry per tracking number: Printify repeats a parcel once per line item.
    const byNumber = new Map<string, ProviderShipment>();
    for (const s of o.shipments ?? []) {
        const number = String(s.number ?? '',).trim();
        if (!number) continue;
        const shippedAt = minDate(
            (s.line_item_ids ?? []).map((id,) => printifyDate(itemById.get(id,)?.fulfilled_at,)),
        ) ?? printifyDate(o.fulfilled_at,);
        const prev = byNumber.get(number,);
        if (!prev) {
            byNumber.set(number, {
                carrier: s.carrier ? String(s.carrier,) : null,
                number,
                url: s.url ? String(s.url,) : null,
                shippedAt,
                deliveredAt: printifyDate(s.delivered_at,),
            },);
        } else {
            prev.shippedAt = minDate([prev.shippedAt, shippedAt,],);
            prev.deliveredAt = prev.deliveredAt && printifyDate(s.delivered_at,)
                ? maxDate([prev.deliveredAt, printifyDate(s.delivered_at,),],)
                : null;
        }
    }
    const shipments = [...byNumber.values(),];

    const allItemsCancelled = (o.line_items ?? []).length > 0 && items.length === 0;
    const itemsPreShip = items.some((li,) => PRE_SHIP_ITEM.has(String(li.status ?? '',).toLowerCase(),));

    let status: FulfilmentRowStatus;
    if (CANCELLED.has(ext,) || allItemsCancelled) status = 'cancelled';
    else if (shipments.length) {
        const partly = ext === 'partially-fulfilled' || itemsPreShip;
        if (partly) status = 'partially_shipped';
        else status = shipments.every((s,) => s.deliveredAt) ? 'delivered' : 'shipped';
    } else if (ext === 'fulfilled') status = 'shipped';
    else if (ext === 'partially-fulfilled') status = 'partially_shipped';
    else if (IN_PRODUCTION.has(ext,)) status = 'in_production';
    else if (ON_HOLD.has(ext,)) status = 'on_hold';
    else status = 'pending';

    const shipped = status === 'shipped' || status === 'delivered' || status === 'partially_shipped';
    return {
        status,
        externalStatus: ext || 'unknown',
        shipments,
        inProductionAt: printifyDate(o.sent_to_production_at,),
        shippedAt: shipped ? (printifyDate(o.fulfilled_at,) ?? minDate(shipments.map((s,) => s.shippedAt),)) : null,
        deliveredAt: status === 'delivered' ? maxDate(shipments.map((s,) => s.deliveredAt),) : null,
    };
}

// ─── Pure: matching ────────────────────────────────────────────────────

export interface OurOrderRef {
    orderId: string;
    orderNumber: string;
    customerEmail: string;
    /** Printify order id already recorded for this order, if any. */
    externalOrderId: string | null;
    /** Our fulfilment row status for Printify (null = no row). */
    rowStatus: string | null;
}

export interface OrderIndex {
    byExternalId: Map<string, OurOrderRef>;
    byOrderNumber: Map<string, OurOrderRef>;
}

export function buildOrderIndex(refs: OurOrderRef[],): OrderIndex {
    const byExternalId = new Map<string, OurOrderRef>();
    const byOrderNumber = new Map<string, OurOrderRef>();
    for (const r of refs) {
        if (r.externalOrderId) byExternalId.set(r.externalOrderId, r,);
        byOrderNumber.set(r.orderNumber.trim(), r,);
    }
    return { byExternalId, byOrderNumber, };
}

export interface OrderMatch {
    ref: OurOrderRef;
    via: ShopProviderOrderReconcileItem['matchedBy'];
    /** Our order is already linked to a DIFFERENT Printify order. */
    conflict: boolean;
}

/** Find which of our orders a Printify order belongs to; null = not ours. */
export function matchPrintifyOrder(o: PrintifyApiOrder, idx: OrderIndex,): OrderMatch | null {
    const byId = idx.byExternalId.get(String(o.id,),);
    if (byId) return { ref: byId, via: 'id', conflict: false, };

    const tries: Array<[OrderMatch['via'], unknown,]> = [
        ['external_id', o.external_id,],
        ['external_id', o.metadata?.shop_order_id,],
        ['label', o.label,],
        ['label', o.metadata?.shop_order_label,],
    ];
    for (const [via, raw,] of tries) {
        const key = raw === null || raw === undefined ? '' : String(raw,).trim();
        if (!key) continue;
        const ref = idx.byOrderNumber.get(key,);
        if (ref) {
            return { ref, via, conflict: !!ref.externalOrderId && ref.externalOrderId !== String(o.id,), };
        }
    }
    return null;
}

// ─── DB + API ──────────────────────────────────────────────────────────

/** Our orders in the window, with any Printify link they already have. */
async function loadOurOrders(sinceDays: number,): Promise<OurOrderRef[]> {
    const r = await query<{
        id: string; order_number: string; customer_email: string;
        external_order_id: string | null; legacy_id: string | null; row_status: string | null;
    }>(
        `SELECT o.id, o.order_number, o.customer_email,
                f.external_order_id, o.printify_order_id AS legacy_id, f.status AS row_status
         FROM shop_orders o
         LEFT JOIN shop_order_fulfillments f ON f.order_id = o.id AND f.provider = $1
         WHERE o.created_at > NOW() - make_interval(days => $2::int)`,
        [PROVIDER, sinceDays,],
    );
    return r.rows.map((x,) => ({
        orderId: x.id,
        orderNumber: x.order_number,
        customerEmail: x.customer_email,
        externalOrderId: x.external_order_id ?? x.legacy_id ?? null,
        rowStatus: x.row_status,
    }));
}

/** Printify orders newest-first, stopping once a page is entirely older than the window. */
async function listRecentPrintifyOrders(cfg: PrintifyConfig, sinceDays: number,): Promise<PrintifyApiOrder[]> {
    const cutoff = Date.now() - sinceDays * 86_400_000;
    const out: PrintifyApiOrder[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
        const d = await listOrdersPage(cfg, page, PAGE_SIZE,);
        const rows = (d.data ?? []) as PrintifyApiOrder[];
        out.push(...rows,);
        const oldest = rows.map((r,) => printifyDate(r.created_at,)).filter(Boolean,).sort()[0];
        if (!rows.length || page >= (d.last_page ?? page) || (oldest && new Date(oldest,).getTime() < cutoff)) break;
    }
    return out;
}

const TERMINAL_ROW = new Set(['delivered', 'cancelled',],);

/** Mask an address for logs: a***@example.com. */
const maskEmail = (e: string,): string => e.replace(/^(.).*?(@.*)$/, '$1***$2',);

export async function reconcilePrintifyOrders(
    cfg: PrintifyConfig,
    opts: { sinceDays: number; trigger: 'manual' | 'cron'; },
): Promise<ShopProviderOrderReconcileResult> {
    const started = Date.now();
    const result: ShopProviderOrderReconcileResult = {
        provider: PROVIDER, checked: 0, matched: 0, linked: 0, updated: 0, foreign: 0,
        statusCounts: {}, orders: [], customerEmailsNotSent: [], customerEmailsSent: 0,
        errors: [], durationMs: 0,
    };
    const { applyFulfilmentState, } = await import('../shop/providerFulfillment.js');

    const refs = await loadOurOrders(opts.sinceDays,);
    const idx = buildOrderIndex(refs,);

    let listed: PrintifyApiOrder[] = [];
    try {
        listed = await listRecentPrintifyOrders(cfg, opts.sinceDays,);
    } catch (err) {
        result.errors.push(`Could not list Printify orders: ${(err as Error).message}`,);
    }

    // Linked orders of ours that are still moving but fell outside the listing
    // (older than its window, or the listing failed) are fetched directly.
    const seen = new Set(listed.map((o,) => String(o.id,)),);
    const missing = refs
        .filter((r,) => r.externalOrderId && !seen.has(r.externalOrderId,) && !TERMINAL_ROW.has(r.rowStatus ?? '',))
        .slice(0, MAX_DIRECT_FETCHES,);
    for (const r of missing) {
        try {
            listed.push(await getOrder(cfg, r.externalOrderId!,) as PrintifyApiOrder,);
        } catch (err) {
            result.errors.push(`${r.orderNumber}: Printify order ${r.externalOrderId} could not be read — ${(err as Error).message}`,);
        }
    }

    for (const o of listed) {
        result.checked++;
        const m = matchPrintifyOrder(o, idx,);
        if (!m) { result.foreign++; continue; }
        if (m.conflict) {
            result.errors.push(
                `${m.ref.orderNumber}: Printify order ${o.id} names this order, but it is already linked to ${m.ref.externalOrderId} — left alone.`,
            );
            continue;
        }
        result.matched++;
        try {
            const state = mapPrintifyOrder(o,);
            const applied = await applyFulfilmentState(m.ref.orderId, PROVIDER, String(o.id,), state,);
            if (applied.conflict) {
                result.errors.push(`${m.ref.orderNumber}: already linked to Printify order ${applied.conflict} — ${o.id} left alone.`,);
                continue;
            }
            // Keep the legacy single-supplier columns coherent for old readers.
            await query(
                `UPDATE shop_orders SET printify_order_id = COALESCE(printify_order_id, $2), printify_status = $3
                 WHERE id = $1 AND (printify_order_id IS NULL OR printify_status IS DISTINCT FROM $3)`,
                [m.ref.orderId, String(o.id,), state.externalStatus,],
            );
            if (applied.linked) result.linked++;
            if (applied.changed) {
                result.updated++;
                result.statusCounts[state.status] = (result.statusCounts[state.status] ?? 0) + 1;
            }
            result.orders.push({
                orderNumber: m.ref.orderNumber,
                externalOrderId: String(o.id,),
                status: state.status,
                externalStatus: state.externalStatus,
                orderStatus: applied.orderStatusAfter,
                matchedBy: m.via,
                linked: applied.linked,
                changed: applied.changed,
                trackingNumbers: state.shipments.map((s,) => s.number,),
            },);

            const moved = applied.orderStatusAfter !== applied.orderStatusBefore;
            if (moved && (applied.orderStatusAfter === 'shipped' || applied.orderStatusAfter === 'delivered')) {
                await handleBuyerEmail(m.ref, applied.orderStatusAfter, state, result,);
            }
        } catch (err) {
            result.errors.push(`${m.ref.orderNumber}: ${(err as Error).message}`,);
        }
    }

    result.durationMs = Date.now() - started;
    if (result.updated || result.errors.length) {
        logger.info(
            `Printify order reconcile (${opts.trigger}): ${result.checked} checked, ${result.matched} ours, ` +
                `${result.linked} linked, ${result.updated} updated, ${result.foreign} not ours, ` +
                `${result.errors.length} error(s)`,
        );
    }
    for (const e of result.errors) logger.warn(`Printify order reconcile: ${e}`,);
    return result;
}

async function handleBuyerEmail(
    ref: OurOrderRef,
    orderStatus: string,
    state: ProviderFulfilmentState,
    result: ShopProviderOrderReconcileResult,
): Promise<void> {
    const email: ShopProviderCustomerEmail = {
        orderNumber: ref.orderNumber,
        to: ref.customerEmail,
        orderStatus,
        // Matches buildStatusUpdate's default subject (the operator's
        // `shop_order_shipped` template may override it at send time).
        subject: `Update on your order ${ref.orderNumber}`,
        trackingNumber: state.shipments[0]?.number ?? null,
    };
    if (!SEND_CUSTOMER_SHIPPING_EMAILS_ON_SYNC) {
        result.customerEmailsNotSent.push(email,);
        logger.info(
            `Printify reconcile: NOT sending buyer email (switch off) — ${ref.orderNumber} → ${maskEmail(ref.customerEmail,)} ` +
                `“${email.subject}” (now ${orderStatus}${email.trackingNumber ? `, tracking ${email.trackingNumber}` : ''})`,
        );
        return;
    }
    const { findOrderById, } = await import('../../repositories/shop/shopOrders.repo.js');
    const { sendOrderStatusEmail, } = await import('../shop/orderEmails.js');
    const { attachShipments, } = await import('../shop/orderTracking.js');
    await sendOrderStatusEmail(await attachShipments(await findOrderById(ref.orderId,),),);
    result.customerEmailsSent++;
}

/** Orders reach back this far when the operator presses "Sync from Printify". */
const MANUAL_RECONCILE_DAYS = 365;

/**
 * "Sync from Printify": the catalogue, then the orders. The order half runs even
 * when the product half fails (and vice versa) — they are independent.
 */
export async function syncProductsAndOrders(): Promise<
    import('./sync').PrintifySyncResult & { orders?: ShopProviderOrderReconcileResult; }
> {
    const { syncProducts, } = await import('./sync.js');
    const { getPrintifyOrderConfig, } = await import('./config.js');
    const products = await syncProducts();
    const cfg = await getPrintifyOrderConfig();
    if (!cfg) return products;
    try {
        const orders = await reconcilePrintifyOrders(cfg, { sinceDays: MANUAL_RECONCILE_DAYS, trigger: 'manual', },);
        return { ...products, orders, };
    } catch (err) {
        return { ...products, errors: [...products.errors, `Orders: ${(err as Error).message}`,], };
    }
}
