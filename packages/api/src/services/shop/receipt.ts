/**
 * Order receipt as a PDF.
 *
 * Built with PDFKit rather than by hand: a receipt has to survive long product
 * names, multi-line addresses and non-Latin characters in a customer's name,
 * and hand-rolling text measurement and font encoding for those cases is how a
 * receipt silently renders as garbage for one customer in fifty.
 *
 * The document is streamed into a Buffer instead of to disk — receipts are
 * generated on demand and never stored, so an order can be re-downloaded at
 * any time and no stale copy can drift from the order it describes.
 */
import PDFDocument from 'pdfkit';
import type { ShopAddress, ShopOrderDetail, ShopSettings, } from '@sitesurge/types';

/** Page geometry, in PDF points (72 per inch). */
const MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/** Column x-offsets for the line-item table. */
const COL_QTY = MARGIN + 300;
const COL_UNIT = MARGIN + 360;
const COL_TOTAL = MARGIN + 440;

const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';

function money(cents: number, currency: string,): string {
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency, },)
            .format((cents || 0) / 100,);
    } catch {
        // An unknown/blank currency code must not fail the whole receipt.
        return `${((cents || 0) / 100).toFixed(2,)} ${currency || ''}`.trim();
    }
}

function formatDate(iso: string | Date,): string {
    const d = iso instanceof Date ? iso : new Date(iso,);
    if (Number.isNaN(d.getTime(),)) return '';
    return d.toLocaleDateString('en-US', { dateStyle: 'long', },);
}

/** An address as display lines, blanks removed. */
function addressLines(addr: ShopAddress | null | undefined,): string[] {
    if (!addr) return [];
    const cityLine = [addr.city, addr.state, addr.postalCode,].filter(Boolean,).join(', ',);
    return [addr.name, addr.line1, addr.line2, cityLine, addr.country,]
        .map((l,) => (l || '').trim())
        .filter(Boolean,) as string[];
}

/**
 * Render one order to a PDF buffer.
 *
 * `settings` supplies the seller's name and address; both are optional so a
 * store that has not filled them in still gets a usable receipt.
 */
export function renderOrderReceipt(
    order: ShopOrderDetail,
    settings?: Partial<ShopSettings> | null,
    opts: { siteName?: string; siteUrl?: string; } = {},
): Promise<Buffer> {
    const doc = new PDFDocument({ size: 'A4', margin: MARGIN, info: {
        Title: `Receipt ${order.orderNumber}`,
        Author: settings?.businessName || opts.siteName || 'Receipt',
        Subject: `Order ${order.orderNumber}`,
    }, },);

    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>((resolve, reject,) => {
        doc.on('data', (c: Buffer,) => chunks.push(c,),);
        doc.on('end', () => resolve(Buffer.concat(chunks,),),);
        doc.on('error', reject,);
    },);

    const seller = settings?.businessName || opts.siteName || '';
    const currency = order.currency || 'USD';

    // ── Header: seller on the left, RECEIPT + order meta on the right ──
    doc.fillColor(INK,).font('Helvetica-Bold',).fontSize(18,)
        .text(seller || 'Receipt', MARGIN, MARGIN, { width: CONTENT_WIDTH * 0.55, },);

    if (settings?.businessAddress) {
        doc.font('Helvetica',).fontSize(9,).fillColor(MUTED,)
            .text(settings.businessAddress, MARGIN, doc.y + 2, { width: CONTENT_WIDTH * 0.55, },);
    }
    if (opts.siteUrl) {
        doc.font('Helvetica',).fontSize(9,).fillColor(MUTED,)
            .text(opts.siteUrl, MARGIN, doc.y + 2, { width: CONTENT_WIDTH * 0.55, },);
    }

    const metaX = MARGIN + CONTENT_WIDTH * 0.55;
    const metaW = CONTENT_WIDTH * 0.45;
    doc.font('Helvetica-Bold',).fontSize(20,).fillColor(INK,)
        .text('RECEIPT', metaX, MARGIN, { width: metaW, align: 'right', },);
    doc.font('Helvetica',).fontSize(10,).fillColor(MUTED,)
        .text(`Order ${order.orderNumber}`, metaX, doc.y + 4, { width: metaW, align: 'right', },)
        .text(formatDate(order.createdAt,), metaX, doc.y + 2, { width: metaW, align: 'right', },)
        .text(`Status: ${order.status}`, metaX, doc.y + 2, { width: metaW, align: 'right', },);

    let y = Math.max(doc.y, MARGIN + 70,) + 18;
    doc.moveTo(MARGIN, y,).lineTo(MARGIN + CONTENT_WIDTH, y,).strokeColor(RULE,).stroke();
    y += 18;

    // ── Billed-to / ship-to ──
    const billTo = [order.customerName, order.customerEmail,].filter(Boolean,) as string[];
    const shipTo = addressLines(order.shippingAddress,);
    const colW = CONTENT_WIDTH / 2 - 10;

    doc.font('Helvetica-Bold',).fontSize(9,).fillColor(MUTED,).text('BILLED TO', MARGIN, y,);
    if (shipTo.length) {
        doc.font('Helvetica-Bold',).fontSize(9,).fillColor(MUTED,)
            .text('SHIP TO', MARGIN + colW + 20, y,);
    }
    y += 14;

    doc.font('Helvetica',).fontSize(10,).fillColor(INK,)
        .text(billTo.join('\n',), MARGIN, y, { width: colW, },);
    const leftBottom = doc.y;
    let rightBottom = y;
    if (shipTo.length) {
        doc.text(shipTo.join('\n',), MARGIN + colW + 20, y, { width: colW, },);
        rightBottom = doc.y;
    }
    y = Math.max(leftBottom, rightBottom,) + 22;

    // ── Line items ──
    doc.font('Helvetica-Bold',).fontSize(9,).fillColor(MUTED,)
        .text('ITEM', MARGIN, y,)
        .text('QTY', COL_QTY, y, { width: 40, align: 'right', },)
        .text('PRICE', COL_UNIT, y, { width: 70, align: 'right', },)
        .text('TOTAL', COL_TOTAL, y, { width: MARGIN + CONTENT_WIDTH - COL_TOTAL, align: 'right', },);
    y += 14;
    doc.moveTo(MARGIN, y,).lineTo(MARGIN + CONTENT_WIDTH, y,).strokeColor(RULE,).stroke();
    y += 10;

    for (const item of order.items || []) {
        // A long title wraps, so the row height is whatever the title needed.
        const label = item.variantTitle ? `${item.title}\n${item.variantTitle}` : item.title;
        const titleTop = y;
        doc.font('Helvetica',).fontSize(10,).fillColor(INK,)
            .text(label, MARGIN, y, { width: COL_QTY - MARGIN - 10, },);
        const titleBottom = doc.y;

        doc.font('Helvetica',).fontSize(10,).fillColor(INK,)
            .text(String(item.quantity,), COL_QTY, titleTop, { width: 40, align: 'right', },)
            .text(money(item.unitPriceCents, currency,), COL_UNIT, titleTop, { width: 70, align: 'right', },)
            .text(
                money(item.subtotalCents, currency,),
                COL_TOTAL,
                titleTop,
                { width: MARGIN + CONTENT_WIDTH - COL_TOTAL, align: 'right', },
            );

        y = Math.max(titleBottom, titleTop + 14,) + 8;

        // Start a new page before the row runs off the bottom.
        if (y > 720) { doc.addPage(); y = MARGIN; }
    }

    doc.moveTo(MARGIN, y,).lineTo(MARGIN + CONTENT_WIDTH, y,).strokeColor(RULE,).stroke();
    y += 12;

    // ── Totals, right-aligned ──
    const totalRow = (label: string, value: string, bold = false,) => {
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica',).fontSize(bold ? 12 : 10,)
            .fillColor(bold ? INK : MUTED,)
            .text(label, COL_UNIT - 60, y, { width: 130, align: 'right', },)
            .fillColor(INK,)
            .text(value, COL_TOTAL, y, {
                width: MARGIN + CONTENT_WIDTH - COL_TOTAL, align: 'right',
            },);
        y += bold ? 20 : 16;
    };

    totalRow('Subtotal', money(order.subtotalCents, currency,),);
    totalRow(
        order.shippingMethod ? `Shipping (${order.shippingMethod})` : 'Shipping',
        money(order.shippingCents, currency,),
    );
    if (order.discountCents) totalRow('Discount', `-${money(order.discountCents, currency,)}`,);
    totalRow('Tax', money(order.taxCents, currency,),);

    doc.moveTo(COL_UNIT - 60, y - 4,).lineTo(MARGIN + CONTENT_WIDTH, y - 4,)
        .strokeColor(RULE,).stroke();
    y += 6;
    totalRow('Total', money(order.totalCents, currency,), true,);

    // ── Footer ──
    y += 16;
    if (order.trackingNumber) {
        doc.font('Helvetica',).fontSize(9,).fillColor(MUTED,).text(
            `Tracking: ${order.carrier ? `${order.carrier} · ` : ''}${order.trackingNumber}`,
            MARGIN,
            y,
            { width: CONTENT_WIDTH, },
        );
        y = doc.y + 6;
    }
    doc.font('Helvetica',).fontSize(9,).fillColor(MUTED,).text(
        'Thank you for your order.',
        MARGIN,
        y,
        { width: CONTENT_WIDTH, },
    );

    doc.end();
    return done;
}

/** The filename a browser should save the receipt under. */
export function receiptFilename(orderNumber: string,): string {
    return `receipt-${orderNumber.replace(/[^A-Za-z0-9._-]/g, '',)}.pdf`;
}
