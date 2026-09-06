import { beforeEach, describe, expect, it, vi, } from 'vitest';
import type { OrderDetail, } from '../../repositories/shop/shopOrders.repo';

vi.mock('../../config', () => ({ config: { frontendUrl: 'https://shop.example.com', }, }),);

const sendEmailMock = vi.fn().mockResolvedValue(undefined,);
vi.mock('../email', () => ({ sendEmail: (...a: unknown[]) => sendEmailMock(...a), }),);

const getShopSettingsMock = vi.fn();
vi.mock('./settings', () => ({ getShopSettings: (...a: unknown[]) => getShopSettingsMock(...a), }),);

const getPublicSettingsMock = vi.fn();
vi.mock('../settings', () => ({ getPublicSettings: (...a: unknown[]) => getPublicSettingsMock(...a), }),);

import {
    buildBuyerConfirmation,
    buildStatusUpdate,
    receiptLink,
    renderAddress,
    renderItemsTable,
    sendOrderPlacedEmails,
    sendOrderStatusEmail,
} from './orderEmails';

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
    return {
        id: 'o1',
        orderNumber: 'SS-1001',
        customerEmail: 'buyer@example.com',
        customerName: 'Jane Buyer',
        status: 'paid',
        fulfillmentStatus: 'unfulfilled',
        trackingNumber: null,
        notes: null,
        subtotalCents: 2000,
        taxCents: 160,
        shippingCents: 500,
        discountCents: 0,
        totalCents: 2660,
        currency: 'usd',
        shippingAddress: null,
        billingAddress: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        items: [
            {
                id: 'oi1',
                title: 'Sticker Pack',
                variantTitle: 'Large',
                sku: 'STK-L',
                quantity: 2,
                unitPriceCents: 1000,
                subtotalCents: 2000,
                isDigital: false,
                downloadToken: null,
            },
        ],
        ...overrides,
    } as OrderDetail;
}

describe('orderEmails — formatting utilities', () => {
    it('renderItemsTable includes variant title and qty', () => {
        const o = order({
            items: [
                {
                    id: 'oi1', title: 'E-Book', variantTitle: 'PDF', sku: null,
                    quantity: 3, unitPriceCents: 500, subtotalCents: 1500,
                    isDigital: true, downloadToken: 'tok123',
                },
            ],
        } as Partial<OrderDetail>,);
        const html = renderItemsTable(o,);
        expect(html,).toContain('E-Book — PDF',);
        expect(html,).toContain('× 3',);
        // The per-item token link is gone: it pointed at an endpoint that
        // returns JSON, so clicking it from an inbox showed raw JSON, and it
        // rendered even for a "digital" product with no file attached.
        expect(html,).not.toContain('/download/tok123',);
    },);

    it('receiptLink points at the API receipt route, not an app route', () => {
        const url = receiptLink(order(), 'https://shop.example.com',);
        expect(url,).toBe('https://shop.example.com/api/v1/shop/orders/SS-1001/receipt',);
    },);

    it('receiptLink tolerates a trailing slash on the site URL', () => {
        expect(receiptLink(order(), 'https://shop.example.com/',),)
            .toBe('https://shop.example.com/api/v1/shop/orders/SS-1001/receipt',);
    },);

    it('receiptLink escapes an order number so the URL cannot be broken', () => {
        const url = receiptLink(order({ orderNumber: 'SS 10/01', } as Partial<OrderDetail>,), 'https://x.com',);
        expect(url,).toBe('https://x.com/api/v1/shop/orders/SS%2010%2F01/receipt',);
    },);

    it('the buyer confirmation carries the receipt download button', () => {
        const { html, } = buildBuyerConfirmation(order(), {
            businessName: 'Surge Media', frontendUrl: 'https://shop.example.com', currency: 'usd',
        },);
        expect(html,).toContain('Download receipt (PDF)',);
        expect(html,).toContain('/api/v1/shop/orders/SS-1001/receipt',);
    },);

    it('renderItemsTable shows SKU for physical items when present', () => {
        const html = renderItemsTable(order(),);
        expect(html,).toContain('SKU: STK-L',);
    },);

    it('renderAddress skips empty fields and renders present ones', () => {
        const html = renderAddress(
            { name: 'Jane', line1: '1 Main St', line2: '', city: 'Townsville', state: 'CA', postalCode: '90000', country: 'US', },
            'Shipping address',
        );
        expect(html,).toContain('Shipping address',);
        expect(html,).toContain('Jane',);
        expect(html,).toContain('1 Main St',);
        expect(html,).toContain('Townsville, CA 90000',);
        // empty line2 must not produce a stray blank
        expect(html,).not.toContain('<br/><br/>',);
    },);

    it('renderAddress returns empty string for a null address', () => {
        expect(renderAddress(null, 'Shipping address',),).toBe('',);
    },);

    it('buildStatusUpdate maps status to plain language and shows tracking when shipped', () => {
        const o = order({ status: 'shipped', trackingNumber: 'TRK-9', },);
        const mail = buildStatusUpdate(o, { businessName: 'Acme', frontendUrl: '', currency: 'usd', },);
        expect(mail.subject,).toContain('SS-1001',);
        expect(mail.html,).toContain('shipped',);
        expect(mail.html,).toContain('TRK-9',);
    },);
},);

describe('orderEmails — send helpers', () => {
    beforeEach(() => {
        sendEmailMock.mockClear();
        getShopSettingsMock.mockReset();
        getPublicSettingsMock.mockReset();
        getShopSettingsMock.mockResolvedValue({ businessName: 'Acme Store', currency: 'usd', },);
    },);

    it('sendOrderPlacedEmails sends TWO emails: buyer + seller (contactEmail)', async () => {
        getPublicSettingsMock.mockResolvedValue({ contactEmail: 'owner@acme.com', },);

        await sendOrderPlacedEmails(order(),);

        expect(sendEmailMock,).toHaveBeenCalledTimes(2,);
        const recipients = sendEmailMock.mock.calls.map((c,) => (c[0] as { to: string; }).to);
        expect(recipients,).toContain('buyer@example.com',);
        expect(recipients,).toContain('owner@acme.com',);
    });

    it('sendOrderPlacedEmails sends only the buyer email when no contactEmail is set', async () => {
        getPublicSettingsMock.mockResolvedValue({ contactEmail: '', },);

        await sendOrderPlacedEmails(order(),);

        expect(sendEmailMock,).toHaveBeenCalledTimes(1,);
        expect((sendEmailMock.mock.calls[0][0] as { to: string; }).to,).toBe('buyer@example.com',);
    },);

    it('sendOrderStatusEmail sends to the buyer', async () => {
        await sendOrderStatusEmail(order({ status: 'shipped', },), 'paid',);
        expect(sendEmailMock,).toHaveBeenCalledTimes(1,);
        expect((sendEmailMock.mock.calls[0][0] as { to: string; }).to,).toBe('buyer@example.com',);
    },);
},);

describe('renderItemsTable — supplier grouping', () => {
    const order = {
        currency: 'usd',
        items: [
            { title: 'Tee', variantTitle: 'M', sku: 'A1', quantity: 1, subtotalCents: 2500, fulfillmentGroup: 'apliiq', },
            { title: 'Mug', variantTitle: null, sku: 'B1', quantity: 2, subtotalCents: 3000, fulfillmentGroup: 'printify', },
            { title: 'Sticker', variantTitle: null, sku: 'C1', quantity: 1, subtotalCents: 500, fulfillmentGroup: 'native', },
        ],
    } as never;

    it('shows a flat list by default', () => {
        const html = renderItemsTable(order,);
        expect(html,).toContain('Tee',);
        expect(html,).not.toContain('Shipped by',);
    },);

    it('inserts a section header per fulfiller when grouped', () => {
        const html = renderItemsTable(order, { grouped: true, },);
        expect(html,).toContain('Shipped by apliiq',);
        expect(html,).toContain('Shipped by printify',);
        expect(html,).toContain('Shipped by us',);
    },);

    it('does not group a single-supplier order', () => {
        // One group is not a grouping — captioning a lone section with a
        // supplier name tells the buyer nothing and looks like a bug.
        const single = {
            currency: 'usd',
            items: [{ title: 'Tee', variantTitle: null, sku: 'A1', quantity: 1, subtotalCents: 2500, fulfillmentGroup: 'apliiq', },],
        } as never;
        expect(renderItemsTable(single, { grouped: true, },),).not.toContain('Shipped by',);
    },);

    it('keeps every line item in both modes', () => {
        for (const opts of [{}, { grouped: true, },]) {
            const html = renderItemsTable(order, opts,);
            for (const t of ['Tee', 'Mug', 'Sticker',]) expect(html,).toContain(t,);
        }
    },);
},);
