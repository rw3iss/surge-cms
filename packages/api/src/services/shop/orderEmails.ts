/**
 * Shop order emails — the transactional order-notification system. Like the
 * welcome / donation-receipt emails, these are CODE-BUILT templates (not the
 * block-based `mail_templates` system, which is for marketing campaigns with
 * dynamic per-recipient content). Everything routes through the shared
 * transactional pipeline (`services/email.ts` → MailProvider/SMTP).
 *
 * Three templates:
 *   - buildBuyerConfirmation — buyer, on a paid order.
 *   - buildSellerNotification — seller/admin, on a paid order.
 *   - buildStatusUpdate — buyer, on an opt-in admin status change.
 *
 * Two send helpers gather the render context (shop business name, site
 * contact email, frontend URL) and dispatch. Both NEVER throw — an email
 * failure must not break checkout fulfillment or an admin update.
 */
import { config, } from '../../config';
import { sendEmail, } from '../email';
import { sendPurposeMail, } from '../mail/purposes';
import { getShopSettings, } from './settings';
import { getPublicSettings, } from '../settings';
import { buildNotification, getNotificationSettings, notify, notifyUser, personLabel, } from '../notifications';
import { logger, } from '../../utils/logger';
import {
    formatCurrency,
    orderTotalsLines,
    resolveOrderShipments,
    shipmentText,
    type ShopAddress,
    type ShopOrderShipment,
    type ShopTrackingSettings,
} from '@sitesurge/types';
import { escapeHtml, } from '../../utils/html';
import { wrapEmailShell, } from '../mail/shell';
import { formatAddressLines, } from './address';
import type { OrderDetail, } from '../../repositories/shop/shopOrders.repo';

/** Render context shared by every template. */
export interface OrderEmailContext {
    /** Group the buyer-facing item list by fulfiller. Off unless the operator
     *  also shows the cart grouped — otherwise the receipt reveals a split the
     *  checkout never mentioned. */
    groupItems?: boolean;
    /** Group the seller notification. Defaults ON: the operator needs to know
     *  who is printing what even when the buyer sees one list. */
    groupItemsForAdmin?: boolean;
    businessName: string;
    frontendUrl: string;
    currency: string;
    /** Shop → Order tracking settings, for orders read without `shipments`. */
    tracking?: ShopTrackingSettings | null;
    /** Link / button colour — the site primary when it is a literal hex. */
    accentColor?: string;
}

/** The built-in accent, used when the site primary is unset or a swatch ref. */
export const DEFAULT_ACCENT = '#e63946';

/** A colour safe to drop into an inline style: a literal hex, else the default. */
export function accentOf(ctx?: Pick<OrderEmailContext, 'accentColor'> | null,): string {
    const c = ctx?.accentColor;
    return c && /^#[0-9a-f]{3,8}$/i.test(c,) ? c : DEFAULT_ACCENT;
}

/** The order's parcels: the server-resolved list when attached, else built
 *  from the order-level columns alone. */
export function orderShipments(order: OrderDetail, ctx?: Pick<OrderEmailContext, 'tracking'>,): ShopOrderShipment[] {
    return order.shipments ?? resolveOrderShipments(order, [], ctx?.tracking ?? null,);
}

const shortDate = (iso: string | null,): string =>
    iso ? new Date(iso,).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', },) : '';

/** One line per parcel: "OnTrac · 1LSC…" linked to its tracking page, plus
 *  shipped / delivered dates when known. Empty when there is no tracking. */
export function renderShipmentsHtml(shipments: ShopOrderShipment[], accent: string = DEFAULT_ACCENT,): string {
    if (!shipments.length) return '';
    const rows = shipments.map((s,) => {
        const text = escapeHtml(shipmentText(s,),);
        const link = s.url
            ? `<a href="${escapeHtml(s.url,)}" target="_blank" rel="noopener" style="color:${accent};">${text}</a>`
            : `<strong>${text}</strong>`;
        const dates = [
            s.shippedAt ? `shipped ${escapeHtml(shortDate(s.shippedAt,),)}` : '',
            s.deliveredAt ? `delivered ${escapeHtml(shortDate(s.deliveredAt,),)}` : '',
        ].filter(Boolean,).join(', ',);
        return `<div style="margin:4px 0;">${link}${dates ? ` <span style="${MUTED}">(${dates})</span>` : ''}</div>`;
    },).join('',);
    const title = shipments.length > 1 ? 'Tracking (one link per parcel)' : 'Tracking';
    return `<div style="margin:12px 0;padding:12px;background:#f3f4f6;border-radius:6px;">
               <div style="margin-bottom:4px;"><strong>${title}</strong></div>${rows}
           </div>`;
}

// ─── Formatting utilities ──────────────────────────────────────────

/** Format a cent amount as a localized currency string. Delegates to the shared
 *  `formatCurrency` (the one canonical cents→currency formatter); kept as a named
 *  export because the email templates reference it. */
export function formatMoney(cents: number, currency: string,): string {
    return formatCurrency(cents, (currency || 'usd').toUpperCase(),);
}

const MUTED = 'color:#6b7280;';
const CELL = 'padding:8px 12px;border-bottom:1px solid #e5e7eb;';
const CELL_R = 'padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;';

/** HTML line-items table. Each row: title (+ variant) × qty, muted SKU,
 *  right-aligned line subtotal. */
/**
 * The order's line items.
 *
 * `grouped` inserts a sub-header per fulfiller. It is opt-in because a buyer
 * shown one cart at checkout should not first learn at the receipt that their
 * order was split between three suppliers — and conversely the seller usually
 * DOES want that breakdown. The two audiences get separate settings.
 */
export function renderItemsTable(order: OrderDetail, opts: { grouped?: boolean; } = {},): string {
    const currency = order.currency || 'usd';

    const renderRow = (item: OrderDetail['items'][number],) => {
        // Titles can arrive from a supplier webhook and names/addresses are
        // buyer-typed: every interpolated value is escaped.
        const name = escapeHtml(`${item.title}${item.variantTitle ? ` — ${item.variantTitle}` : ''}`,);
        const sku = item.sku
            ? `<br/><span style="${MUTED}font-size:12px;">SKU: ${escapeHtml(item.sku,)}</span>`
            : '';
        return `<tr>
            <td style="${CELL}">${name} × ${item.quantity}${sku}</td>
            <td style="${CELL_R}">${formatMoney(item.subtotalCents, currency,)}</td>
        </tr>`;
    };

    let rows: string;
    if (opts.grouped) {
        const groups = new Map<string, OrderDetail['items']>();
        for (const item of order.items) {
            const key = (item as { fulfillmentGroup?: string | null; }).fulfillmentGroup || 'native';
            const list = groups.get(key,) ?? [];
            list.push(item,);
            groups.set(key, list,);
        }
        // One group is not a grouping — fall back to a plain list rather than
        // captioning a single section with a supplier name for no reason.
        if (groups.size <= 1) {
            rows = order.items.map(renderRow,).join('',);
        } else {
            rows = [...groups.entries(),].map(([key, items,],) => {
                const label = key === 'native'
                    ? 'Shipped by us'
                    : key === 'event_tickets' ? 'Event tickets' : `Shipped by ${escapeHtml(key,)}`;
                return `<tr><td colspan="2" style="${CELL}${MUTED}font-size:12px;text-transform:uppercase;letter-spacing:.04em;">${label}</td></tr>`
                    + items.map(renderRow,).join('',);
            },).join('',);
        }
    } else {
        rows = order.items.map(renderRow,).join('',);
    }

    return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:560px;margin:0 0 16px;">
        <tbody>${rows}</tbody>
    </table>`;
}

/** Totals block — subtotal / shipping / tax / discount (only when > 0) /
 *  bold Total. */
export function renderTotals(order: OrderDetail,): string {
    const c = order.currency || 'usd';
    const row = (label: string, value: string, bold = false,): string => {
        const weight = bold ? 'font-weight:bold;' : '';
        const pad = bold ? 'padding-top:8px;' : '';
        return `<tr>
            <td style="padding:4px 12px 4px 0;${weight}${pad}">${label}</td>
            <td style="padding:4px 0;text-align:right;${weight}${pad}">${value}</td>
        </tr>`;
    };

    // The shared rows (`orderTotalsLines`) — the same lines the order pages and
    // the PDF receipt print. Labels can carry the supplier's method name: escaped.
    const parts = orderTotalsLines(order,).map((l,) => row(escapeHtml(l.label,), escapeHtml(l.value,), l.grand === true,));

    return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:280px;margin-left:auto;">
        <tbody>${parts.join('',)}</tbody>
    </table>`;
}

/** A labeled address block. Skips empty lines; returns '' for a null/empty
 *  address so callers can drop it wholesale. */
export function renderAddress(addr: ShopAddress | null | undefined, label: string,): string {
    if (!addr) return '';

    const lines = formatAddressLines(addr,);
    if (lines.length === 0) return '';

    const body = lines.map((l,) => escapeHtml(l,),).join('<br/>',);
    return `<div style="margin:0 16px 16px 0;">
        <div style="font-weight:bold;margin-bottom:4px;">${escapeHtml(label,)}</div>
        <div style="${MUTED}line-height:1.5;">${body}</div>
    </div>`;
}

/** Email shell — inline-styled, table-based, ~600px, email-client-safe.
 *  Chrome (brand header + footer) is shop-specific; the DOCTYPE/centering
 *  table skeleton is shared via `wrapEmailShell`. */
export function wrapEmail(opts: { title: string; bodyHtml: string; businessName: string; },): string {
    const brand = escapeHtml(opts.businessName || 'Our Shop',);
    const card = `<tr>
                        <td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
                            <span style="font-size:18px;font-weight:bold;">${brand}</span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:24px;">
                            <h1 style="margin:0 0 16px;font-size:20px;">${escapeHtml(opts.title,)}</h1>
                            ${opts.bodyHtml}
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:16px 24px;border-top:1px solid #e5e7eb;${MUTED}font-size:12px;">
                            This is an automated message from ${brand}.
                        </td>
                    </tr>`;
    return wrapEmailShell({
        docType: '<!DOCTYPE html>',
        bodyHtml: card,
        bg: '#f3f4f6',
        font: '-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif',
        color: '#111827',
        outerPadding: '24px 0',
        innerBorder: '',
        innerRadius: '8px',
        innerStyleExtra: 'overflow:hidden',
    },);
}

/** Both addresses side by side (as a flow of blocks). Empty ones drop out. */
function renderAddresses(order: OrderDetail,): string {
    const shipping = renderAddress(order.shippingAddress, 'Shipping address',);
    const billing = renderAddress(order.billingAddress, 'Billing address',);
    if (!shipping && !billing) return '';
    return `<div style="display:block;margin-top:8px;">${shipping}${billing}</div>`;
}

/**
 * Absolute URL of the order's receipt PDF.
 *
 * Points at the API route, not an app route: the endpoint replies with
 * `Content-Disposition: attachment`, so the link downloads a real file straight
 * from the email. (The token-gated digital-download endpoint is NOT usable
 * here — it returns JSON for the storefront to act on, so a buyer clicking it
 * from an inbox would just see raw JSON.)
 */
export function receiptLink(order: OrderDetail, frontendUrl: string,): string {
    const base = (frontendUrl || config.frontendUrl || '').replace(/\/+$/, '',);
    return `${base}/api/v1/shop/orders/${encodeURIComponent(order.orderNumber,)}/receipt`;
}

/** A prominent "download your receipt" call to action. */
export function renderReceiptButton(order: OrderDetail, frontendUrl: string, accent: string = DEFAULT_ACCENT,): string {
    // Inline styles only, and a table-free anchor: email clients drop
    // stylesheets, and a padded inline-block is the most widely supported
    // button that still degrades to a plain link where it isn't.
    const style = [
        'display:inline-block',
        'padding:10px 18px',
        `background:${accent}`,
        'color:#ffffff',
        'text-decoration:none',
        'border-radius:6px',
        'font-weight:600',
    ].join(';',);
    return `<p style="margin:20px 0;">`
        + `<a href="${escapeHtml(receiptLink(order, frontendUrl,),)}" style="${style};">`
        + `Download receipt (PDF)</a></p>`;
}

/** The storefront confirmation page, carrying the order's access key so the
 *  buyer sees their details and digital downloads there. */
export function orderPageLink(order: OrderDetail, frontendUrl: string,): string {
    const base = (frontendUrl || config.frontendUrl || '').replace(/\/+$/, '',);
    const key = (order as { accessKey?: string | null; }).accessKey;
    return `${base}/shop/orders/${encodeURIComponent(order.orderNumber,)}${key ? `?k=${encodeURIComponent(key,)}` : ''}`;
}

/** "View your order" — or "Get your downloads" when the order has a digital item. */
export function renderOrderPageLink(order: OrderDetail, frontendUrl: string, accent: string = DEFAULT_ACCENT,): string {
    const digital = (order.items ?? []).some((i,) => i.isDigital,);
    const label = digital ? 'Get your downloads' : 'View your order';
    return `<p style="margin:12px 0;"><a href="${escapeHtml(orderPageLink(order, frontendUrl,),)}" style="color:${accent};font-weight:600;">${label}</a></p>`;
}

// ─── Templates ─────────────────────────────────────────────────────

export interface BuiltEmail {
    subject: string;
    html: string;
}

/** Buyer order confirmation (paid order). */
export function buildBuyerConfirmation(order: OrderDetail, ctx: OrderEmailContext,): BuiltEmail {
    const body = `
        <p>Thank you for your order! Here's a summary of what you purchased.</p>
        ${renderItemsTable(order, { grouped: ctx.groupItems === true, },)}
        ${renderTotals(order,)}
        ${renderShipmentsHtml(orderShipments(order, ctx,), accentOf(ctx,),)}
        ${renderAddresses(order,)}
        ${renderOrderPageLink(order, ctx.frontendUrl, accentOf(ctx,),)}
        ${renderReceiptButton(order, ctx.frontendUrl, accentOf(ctx,),)}
    `;
    return {
        subject: `Thank you for your order ${order.orderNumber}`,
        html: wrapEmail({
            title: `Thank you for your order ${order.orderNumber}`,
            bodyHtml: body,
            businessName: ctx.businessName,
        },),
    };
}

/** Seller/admin new-order notification (paid order). */
export function buildSellerNotification(order: OrderDetail, ctx: OrderEmailContext,): BuiltEmail {
    const adminLink = `${ctx.frontendUrl}/admin/shop/orders/${order.id}`;
    const customer = escapeHtml(`${order.customerName ? `${order.customerName} — ` : ''}${order.customerEmail}`,);
    const body = `
        <p>A new order has been placed and paid.</p>
        <p style="${MUTED}">Customer: ${customer}</p>
        ${renderItemsTable(order, { grouped: ctx.groupItemsForAdmin !== false, },)}
        ${renderTotals(order,)}
        ${renderAddresses(order,)}
        <p style="margin-top:16px;"><a href="${escapeHtml(adminLink,)}" style="color:${accentOf(ctx,)};">View this order in the admin</a></p>
    `;
    return {
        subject: `New order ${order.orderNumber}`,
        html: wrapEmail({
            title: `New order ${order.orderNumber}`,
            bodyHtml: body,
            businessName: ctx.businessName,
        },),
    };
}

/** Map a raw order status to buyer-facing plain language. */
function statusPhrase(status: string,): string {
    switch (status) {
        case 'paid': return 'confirmed';
        case 'processing': return 'being prepared';
        case 'shipped': return 'shipped';
        case 'delivered': return 'delivered';
        case 'cancelled': return 'cancelled';
        case 'refunded': return 'refunded';
        default: return status;
    }
}

/** Buyer status-update email (opt-in, on an admin status change). */
export function buildStatusUpdate(
    order: OrderDetail,
    ctx: OrderEmailContext,
    _prevStatus?: string,
): BuiltEmail {
    const phrase = statusPhrase(order.status,);

    const tracking = order.status === 'cancelled' || order.status === 'refunded'
        ? ''
        : renderShipmentsHtml(orderShipments(order, ctx,), accentOf(ctx,),);

    const body = `
        <p>Your order <strong>${escapeHtml(order.orderNumber,)}</strong> is now <strong>${escapeHtml(phrase,)}</strong>.</p>
        ${tracking}
        ${renderItemsTable(order,)}
        ${renderTotals(order,)}
    `;
    return {
        subject: `Update on your order ${order.orderNumber}`,
        html: wrapEmail({
            title: `Update on your order ${order.orderNumber}`,
            bodyHtml: body,
            businessName: ctx.businessName,
        },),
    };
}

// ─── Context + send helpers ────────────────────────────────────────

/** Gather the shared render context (business name / frontend URL / currency). */
async function buildContext(order: OrderDetail,): Promise<OrderEmailContext> {
    let businessName = '';
    let currency = order.currency || 'usd';
    // Buyer grouping is gated on the CART being grouped too. Showing a split in
    // the receipt that the checkout never showed is worse than not showing it.
    let groupItems = false;
    let groupItemsForAdmin = true;
    let tracking: ShopTrackingSettings | null = null;
    let accentColor: string | undefined;
    try {
        accentColor = (await getPublicSettings()).appearance?.primaryColor;
    } catch { /* default accent */ }
    try {
        const shop = await getShopSettings();
        businessName = shop.businessName || '';
        currency = order.currency || shop.currency || 'usd';
        groupItems = shop.cartDisplay === 'grouped' && shop.orderEmailDisplay === 'grouped';
        tracking = shop.tracking ?? null;
        groupItemsForAdmin = shop.adminNotificationDisplay !== 'combined';
    } catch (err) {
        logger.warn('Could not load shop settings for order email', { error: err, },);
    }
    return {
        businessName, frontendUrl: config.frontendUrl ?? '', currency,
        groupItems, groupItemsForAdmin, tracking, accentColor,
    };
}

/** Resolve the seller/admin notification address (site contact email). */
async function getSellerEmail(): Promise<string | null> {
    try {
        const site = await getPublicSettings();
        return site.contactEmail?.trim() || null;
    } catch (err) {
        logger.warn('Could not load site settings for seller email', { error: err, },);
        return null;
    }
}

/**
 * Variables offered to an operator-authored order template.
 *
 * `itemsHtml` is the rendered line-item table from the built-in builder rather
 * than raw data: a custom template almost always wants the table as-is, and
 * rebuilding it out of loops in the block editor would be miserable.
 */
function purposeContext(order: OrderDetail, itemsHtml: string, ctx?: OrderEmailContext,): Record<string, unknown> {
    const shipments = orderShipments(order, ctx,);
    const first = shipments[0];
    return {
        order: {
            number: order.orderNumber,
            total: formatMoney(order.totalCents, order.currency,),
            status: order.status ?? '',
            // The first parcel, resolved (friendly carrier name + the link to use).
            trackingNumber: first?.number ?? order.trackingNumber ?? '',
            trackingUrl: first?.url ?? '',
            carrier: first?.carrierLabel ?? order.carrier ?? '',
            /** Every parcel as linked lines (empty when no tracking yet). */
            trackingHtml: renderShipmentsHtml(shipments, accentOf(ctx,),),
            shipments,
            itemsHtml,
            /** The buyer's order page (with its access key). */
            url: orderPageLink(order, ctx?.frontendUrl ?? '',),
        },
        customer: { name: order.customerName ?? '', email: order.customerEmail, },
    };
}

/** Send just the buyer confirmation (used by the receipt-resend action). */
export async function sendBuyerReceipt(order: OrderDetail,): Promise<void> {
    try {
        const ctx = await buildContext(order,);
        const mail = buildBuyerConfirmation(order, ctx,);
        await sendPurposeMail('shop_order_customer', {
            to: order.customerEmail,
            defaultSubject: mail.subject,
            defaultHtml: mail.html,
            context: purposeContext(order, mail.html, ctx,),
        },);
    } catch (err) {
        logger.error('Failed to send buyer order confirmation', { orderNumber: order.orderNumber, error: err, },);
    }
}

/**
 * Order-paid emails: buyer confirmation + seller/admin notification. Each is
 * dispatched in its own try/catch so one failure never blocks the other, and
 * the whole thing never throws. Skips + warns when no site contactEmail is set.
 */
export async function sendOrderPlacedEmails(order: OrderDetail,): Promise<void> {
    const ctx = await buildContext(order,);

    // Buyer confirmation.
    try {
        const mail = buildBuyerConfirmation(order, ctx,);
        await sendPurposeMail('shop_order_customer', {
            to: order.customerEmail,
            defaultSubject: mail.subject,
            defaultHtml: mail.html,
            context: purposeContext(order, mail.html, ctx,),
        },);
    } catch (err) {
        logger.error('Failed to send buyer order confirmation', { orderNumber: order.orderNumber, error: err, },);
    }

    // Seller/admin notification. Primary path is the Notifications system
    // (Settings → Notifications → "New shop order"): dispatch to every
    // configured recipient/channel. If NO shop_order recipients are configured,
    // fall back to the site contactEmail so the shop owner still gets notified
    // (preserves the pre-Notifications behavior; avoids double-sending).
    try {
        const mail: BuiltEmail & { text?: string; } = await sellerNotice(order, ctx,).catch((err,) => {
            logger.warn('Shop order notice build failed — using the plain one', { orderNumber: order.orderNumber, error: (err as Error).message, },);
            return buildSellerNotification(order, ctx,);
        },);
        void notify('shop_order', {
            purpose: 'shop_order_admin',
            context: purposeContext(order, mail.html, ctx,),
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
        },);

        const nset = await getNotificationSettings().catch(() => ({} as Record<string, { email?: { enabled: boolean; addresses: string[]; }; }>));
        const emailCfg = nset['shop_order']?.email;
        const hasConfiguredRecipients = Boolean(emailCfg?.enabled) && (emailCfg?.addresses?.length ?? 0) > 0;
        if (!hasConfiguredRecipients) {
            const seller = await getSellerEmail();
            if (!seller) {
                logger.warn('No shop_order notification recipients and no site contactEmail — skipping seller order notification', {
                    orderNumber: order.orderNumber,
                },);
            } else {
                await sendPurposeMail('shop_order_admin', {
                    to: seller,
                    defaultSubject: mail.subject,
                    defaultHtml: mail.html,
                    context: purposeContext(order, mail.html, ctx,),
                },);
            }
        }
    } catch (err) {
        logger.error('Failed to send seller order notification', { orderNumber: order.orderNumber, error: err, },);
    }
}

/**
 * The seller/admin "new order" notice through the shared notification builder:
 * the customer (with their account details when they have one), an order
 * summary, the item table + totals + addresses, and a link to the order.
 */
async function sellerNotice(order: OrderDetail, ctx: OrderEmailContext,): Promise<BuiltEmail & { text: string; }> {
    const person = await notifyUser({ userId: order.userId ?? null, email: order.customerEmail, name: order.customerName ?? null, },);
    const who = personLabel(person, order.customerEmail,);
    const itemCount = (order.items ?? []).reduce((n, i,) => n + (i.quantity ?? 0), 0,);
    return buildNotification({
        title: `New order ${order.orderNumber}`,
        subject: `New order ${order.orderNumber} — ${who} (${formatMoney(order.totalCents, order.currency,)})`,
        intro: `${who} placed and paid for an order.`,
        person,
        personHeading: 'Customer',
        sections: [
            {
                heading: 'Order',
                rows: [
                    { label: 'Order number', value: order.orderNumber, },
                    { label: 'Total', value: formatMoney(order.totalCents, order.currency,), },
                    { label: 'Items', value: itemCount || null, },
                    { label: 'Status', value: order.status, },
                    { label: 'Shipping method', value: order.shippingMethod ?? null, },
                ],
            },
            {
                heading: 'Items',
                // Trusted: built by this module's own renderers.
                html: renderItemsTable(order, { grouped: ctx.groupItemsForAdmin !== false, },) + renderTotals(order,) + renderAddresses(order,),
                text: (order.items ?? []).map((i,) => `${i.quantity} × ${i.title ?? ''}`,).join('\n',),
            },
        ],
        links: [
            { label: 'View order', url: `/admin/shop/orders/${order.id}`, },
            ...(person?.adminUrl ? [{ label: 'View customer', url: person.adminUrl, },] : []),
        ],
    },);
}

/** Buyer status-update email. Never throws. */
export async function sendOrderStatusEmail(order: OrderDetail, prevStatus?: string,): Promise<void> {
    try {
        const ctx = await buildContext(order,);
        const mail = buildStatusUpdate(order, ctx, prevStatus,);
        await sendPurposeMail('shop_order_shipped', {
            to: order.customerEmail,
            defaultSubject: mail.subject,
            defaultHtml: mail.html,
            context: purposeContext(order, mail.html, ctx,),
        },);
    } catch (err) {
        logger.error('Failed to send order status update', { orderNumber: order.orderNumber, error: err, },);
    }
}
