/**
 * Shop order receipt email. Reuses the transactional email pipeline
 * (services/email.ts → MailProvider). Renders a simple table-based receipt
 * with the order number, line items, totals, and per-item digital-download
 * links (token-gated `/shop/orders/:number/download/:token`).
 */
import { config, } from '../../config';
import { sendEmail, } from '../email';
import type { OrderDetail, } from '../../repositories/shop/shopOrders.repo';

function money(cents: number, currency: string,): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: (currency || 'usd').toUpperCase(),
    },).format(cents / 100,);
}

/** Send an order receipt to the customer. */
export async function sendOrderReceipt(order: OrderDetail,): Promise<void> {
    const currency = order.currency || 'usd';
    const base = config.frontendUrl ?? '';

    const rows = order.items.map((item,) => {
        const line = `${item.title}${item.variantTitle ? ` — ${item.variantTitle}` : ''}`;
        const download = item.isDigital && item.downloadToken
            ? `<br/><a href="${base}/shop/orders/${order.orderNumber}/download/${item.downloadToken}">Download</a>`
            : '';
        return `<tr>
            <td style="padding:6px 12px 6px 0;">${line} × ${item.quantity}${download}</td>
            <td style="padding:6px 0;text-align:right;">${money(item.subtotalCents, currency,)}</td>
        </tr>`;
    }).join('',);

    const html = `
        <h1>Order ${order.orderNumber}</h1>
        <p>Thank you for your order! Here is your receipt.</p>
        <table style="border-collapse:collapse;width:100%;max-width:520px;">
            <tbody>${rows}</tbody>
            <tfoot>
                <tr><td style="padding-top:12px;">Subtotal</td><td style="padding-top:12px;text-align:right;">${money(order.subtotalCents, currency,)}</td></tr>
                <tr><td>Shipping</td><td style="text-align:right;">${money(order.shippingCents, currency,)}</td></tr>
                <tr><td>Tax</td><td style="text-align:right;">${money(order.taxCents, currency,)}</td></tr>
                <tr><td style="font-weight:bold;padding-top:6px;">Total</td><td style="font-weight:bold;text-align:right;padding-top:6px;">${money(order.totalCents, currency,)}</td></tr>
            </tfoot>
        </table>
    `;

    await sendEmail({
        to: order.customerEmail,
        subject: `Your order ${order.orderNumber}`,
        html,
    },);
}
