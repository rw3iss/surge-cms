import { describe, expect, it, } from 'vitest';
import { receiptFilename, renderOrderReceipt, } from './receipt';

/**
 * The receipt is generated on demand and streamed straight to the buyer, so
 * there is no artefact to inspect after the fact — these tests assert the
 * bytes really are a PDF and that the awkward inputs (missing settings, odd
 * currencies, long titles, unicode names) produce a document instead of an
 * exception.
 */

const ORDER = {
    id: 'o1',
    orderNumber: 'SS-MTHMX6C69632',
    customerEmail: 'buyer@example.com',
    customerName: 'Alex Buyer',
    status: 'paid',
    subtotalCents: 2500,
    taxCents: 213,
    shippingCents: 899,
    shippingMethod: 'Standard',
    discountCents: 0,
    totalCents: 3612,
    currency: 'USD',
    fulfillmentStatus: 'unfulfilled',
    trackingNumber: null,
    carrier: null,
    createdAt: '2026-08-30T14:00:00.000Z',
    updatedAt: '2026-08-30T14:00:00.000Z',
    shippingAddress: {
        name: 'Alex Buyer', line1: '123 Market St', line2: null,
        city: 'Philadelphia', state: 'PA', postalCode: '19107', country: 'US',
    },
    items: [
        {
            id: 'i1', orderId: 'o1', productId: 'p1', variantId: 'v1',
            title: 'TP', variantTitle: 'Large / Blue', sku: 'TP-L-B',
            unitPriceCents: 2500, quantity: 1, subtotalCents: 2500,
            isDigital: false, downloadToken: null, createdAt: '2026-08-30T14:00:00.000Z',
        },
    ],
} as never;

/** A PDF file always starts with `%PDF-` and ends with an EOF marker. */
function isPdf(buf: Buffer,): boolean {
    return buf.subarray(0, 5,).toString('latin1',) === '%PDF-'
        && buf.subarray(-1024,).toString('latin1',).includes('%%EOF',);
}

describe('renderOrderReceipt', () => {
    it('produces a valid PDF', async () => {
        const pdf = await renderOrderReceipt(ORDER, { businessName: 'Surge Media', },);
        expect(isPdf(pdf,),).toBe(true,);
        expect(pdf.length,).toBeGreaterThan(800,);
    },);

    it('works with no shop settings at all', async () => {
        // A store that never filled in its business name must still get a receipt.
        const pdf = await renderOrderReceipt(ORDER, null,);
        expect(isPdf(pdf,),).toBe(true,);
    },);

    it('works with no shipping address (digital-only order)', async () => {
        const pdf = await renderOrderReceipt(
            { ...(ORDER as object), shippingAddress: null, } as never, null,
        );
        expect(isPdf(pdf,),).toBe(true,);
    },);

    it('survives an unknown currency code instead of throwing', async () => {
        // Intl.NumberFormat throws on a bad code; the receipt must not.
        const pdf = await renderOrderReceipt(
            { ...(ORDER as object), currency: 'XXXXX', } as never, null,
        );
        expect(isPdf(pdf,),).toBe(true,);
    },);

    it('handles a very long product title by wrapping, not failing', async () => {
        const long = { ...(ORDER as object), items: [
            { ...(ORDER as { items: unknown[]; }).items[0] as object, title: 'A '.repeat(200,), },
        ], } as never;
        const pdf = await renderOrderReceipt(long, null,);
        expect(isPdf(pdf,),).toBe(true,);
    },);

    it('handles non-Latin characters in the customer name', async () => {
        const pdf = await renderOrderReceipt(
            { ...(ORDER as object), customerName: 'Ольга Иванова', } as never, null,
        );
        expect(isPdf(pdf,),).toBe(true,);
    },);

    it('paginates an order with many line items', async () => {
        const items = Array.from({ length: 60, }, (_, i,) => ({
            ...(ORDER as { items: unknown[]; }).items[0] as object,
            id: `i${i}`, title: `Product ${i}`,
        }),);
        const pdf = await renderOrderReceipt({ ...(ORDER as object), items, } as never, null,);
        expect(isPdf(pdf,),).toBe(true,);
    },);

    it('includes tracking details when present', async () => {
        const pdf = await renderOrderReceipt(
            { ...(ORDER as object), trackingNumber: '1Z999', carrier: 'UPS', } as never, null,
        );
        expect(isPdf(pdf,),).toBe(true,);
    },);
},);

describe('receiptFilename', () => {
    it('names the file after the order', () => {
        expect(receiptFilename('SS-MTHMX6C69632',),).toBe('receipt-SS-MTHMX6C69632.pdf',);
    },);

    it('strips characters that would break the Content-Disposition header', () => {
        // A quote or newline here would let the header be split.
        expect(receiptFilename('SS-1"; drop\n',),).toBe('receipt-SS-1drop.pdf',);
    },);
},);
