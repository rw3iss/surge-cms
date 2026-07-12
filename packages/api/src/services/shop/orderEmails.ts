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
import { getShopSettings, } from './settings';
import { getPublicSettings, } from '../settings';
import { logger, } from '../../utils/logger';
import type { ShopAddress, } from '@sitesurge/types';
import type { OrderDetail, } from '../../repositories/shop/shopOrders.repo';

/** Render context shared by every template. */
export interface OrderEmailContext {
    businessName: string;
    frontendUrl: string;
    currency: string;
}

// ─── Formatting utilities ──────────────────────────────────────────

/** Format a cent amount as a localized currency string. */
export function formatMoney(cents: number, currency: string,): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: (currency || 'usd').toUpperCase(),
    },).format(cents / 100,);
}

const MUTED = 'color:#6b7280;';
const CELL = 'padding:8px 12px;border-bottom:1px solid #e5e7eb;';
const CELL_R = 'padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;white-space:nowrap;';

/** HTML line-items table. Each row: title (+ variant) × qty, muted SKU, an
 *  optional token-gated download link for digital items, right-aligned line
 *  subtotal. */
export function renderItemsTable(order: OrderDetail,): string {
    const currency = order.currency || 'usd';
    const base = config.frontendUrl ?? '';

    const rows = order.items.map((item,) => {
        const name = `${item.title}${item.variantTitle ? ` — ${item.variantTitle}` : ''}`;
        const sku = item.sku
            ? `<br/><span style="${MUTED}font-size:12px;">SKU: ${item.sku}</span>`
            : '';
        const download = item.isDigital && item.downloadToken
            ? `<br/><a href="${base}/shop/orders/${order.orderNumber}/download/${item.downloadToken}" style="color:#e63946;">Download</a>`
            : '';
        return `<tr>
            <td style="${CELL}">${name} × ${item.quantity}${sku}${download}</td>
            <td style="${CELL_R}">${formatMoney(item.subtotalCents, currency,)}</td>
        </tr>`;
    },).join('',);

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

    const parts = [
        row('Subtotal', formatMoney(order.subtotalCents, c,),),
        row('Shipping', formatMoney(order.shippingCents, c,),),
        row('Tax', formatMoney(order.taxCents, c,),),
    ];
    if (order.discountCents > 0) {
        parts.push(row('Discount', `-${formatMoney(order.discountCents, c,)}`,),);
    }
    parts.push(row('Total', formatMoney(order.totalCents, c,), true,),);

    return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;max-width:280px;margin-left:auto;">
        <tbody>${parts.join('',)}</tbody>
    </table>`;
}

/** A labeled address block. Skips empty lines; returns '' for a null/empty
 *  address so callers can drop it wholesale. */
export function renderAddress(addr: ShopAddress | null | undefined, label: string,): string {
    if (!addr) return '';

    const cityLine = [
        addr.city,
        [addr.state, addr.postalCode,].filter(Boolean,).join(' ',),
    ].filter(Boolean,).join(', ',);

    const lines = [
        addr.name,
        addr.line1,
        addr.line2,
        cityLine,
        addr.country,
        addr.phone,
    ].filter((l,) => l && l.trim(),);

    if (lines.length === 0) return '';

    const body = lines.map((l,) => `${l}`,).join('<br/>',);
    return `<div style="margin:0 16px 16px 0;">
        <div style="font-weight:bold;margin-bottom:4px;">${label}</div>
        <div style="${MUTED}line-height:1.5;">${body}</div>
    </div>`;
}

/** Email shell — inline-styled, table-based, ~600px, email-client-safe. */
export function wrapEmail(opts: { title: string; bodyHtml: string; businessName: string; },): string {
    const brand = opts.businessName || 'Our Shop';
    return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6;padding:24px 0;">
        <tr>
            <td align="center">
                <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
                    <tr>
                        <td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
                            <span style="font-size:18px;font-weight:bold;">${brand}</span>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:24px;">
                            <h1 style="margin:0 0 16px;font-size:20px;">${opts.title}</h1>
                            ${opts.bodyHtml}
                        </td>
                    </tr>
                    <tr>
                        <td style="padding:16px 24px;border-top:1px solid #e5e7eb;${MUTED}font-size:12px;">
                            This is an automated message from ${brand}.
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

/** Both addresses side by side (as a flow of blocks). Empty ones drop out. */
function renderAddresses(order: OrderDetail,): string {
    const shipping = renderAddress(order.shippingAddress, 'Shipping address',);
    const billing = renderAddress(order.billingAddress, 'Billing address',);
    if (!shipping && !billing) return '';
    return `<div style="display:block;margin-top:8px;">${shipping}${billing}</div>`;
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
        ${renderItemsTable(order,)}
        ${renderTotals(order,)}
        ${renderAddresses(order,)}
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
    const customer = `${order.customerName ? `${order.customerName} — ` : ''}${order.customerEmail}`;
    const body = `
        <p>A new order has been placed and paid.</p>
        <p style="${MUTED}">Customer: ${customer}</p>
        ${renderItemsTable(order,)}
        ${renderTotals(order,)}
        ${renderAddresses(order,)}
        <p style="margin-top:16px;"><a href="${adminLink}" style="color:#e63946;">View this order in the admin</a></p>
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

    const tracking = order.status === 'shipped' && order.trackingNumber
        ? `<p style="margin:12px 0;padding:12px;background:#f3f4f6;border-radius:6px;">
               <strong>Tracking number:</strong> ${order.trackingNumber}
           </p>`
        : '';

    const body = `
        <p>Your order <strong>${order.orderNumber}</strong> is now <strong>${phrase}</strong>.</p>
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
    try {
        const shop = await getShopSettings();
        businessName = shop.businessName || '';
        currency = order.currency || shop.currency || 'usd';
    } catch (err) {
        logger.warn('Could not load shop settings for order email', { error: err, },);
    }
    return { businessName, frontendUrl: config.frontendUrl ?? '', currency, };
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

/** Send just the buyer confirmation (used by the receipt-resend action). */
export async function sendBuyerReceipt(order: OrderDetail,): Promise<void> {
    try {
        const ctx = await buildContext(order,);
        const mail = buildBuyerConfirmation(order, ctx,);
        await sendEmail({ to: order.customerEmail, subject: mail.subject, html: mail.html, },);
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
        await sendEmail({ to: order.customerEmail, subject: mail.subject, html: mail.html, },);
    } catch (err) {
        logger.error('Failed to send buyer order confirmation', { orderNumber: order.orderNumber, error: err, },);
    }

    // Seller/admin notification → site contactEmail.
    try {
        const seller = await getSellerEmail();
        if (!seller) {
            logger.warn('No site contactEmail set — skipping seller order notification', {
                orderNumber: order.orderNumber,
            },);
        } else {
            const mail = buildSellerNotification(order, ctx,);
            await sendEmail({ to: seller, subject: mail.subject, html: mail.html, },);
        }
    } catch (err) {
        logger.error('Failed to send seller order notification', { orderNumber: order.orderNumber, error: err, },);
    }
}

/** Buyer status-update email. Never throws. */
export async function sendOrderStatusEmail(order: OrderDetail, prevStatus?: string,): Promise<void> {
    try {
        const ctx = await buildContext(order,);
        const mail = buildStatusUpdate(order, ctx, prevStatus,);
        await sendEmail({ to: order.customerEmail, subject: mail.subject, html: mail.html, },);
    } catch (err) {
        logger.error('Failed to send order status update', { orderNumber: order.orderNumber, error: err, },);
    }
}
