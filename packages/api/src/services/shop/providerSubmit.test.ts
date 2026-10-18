/**
 * A supplier order is created at most once: the submit claims its fulfilment
 * row atomically, so a webhook redelivery / the retry sweep / a manual retry
 * racing an in-flight submit is skipped instead of creating a second order.
 */
import { beforeEach, describe, expect, it, vi, } from 'vitest';

vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), }, }),);
const submitOrder = vi.fn(async () => ({ externalOrderId: 'pf-1', }));
vi.mock('./providers/registry', () => ({ getProvider: () => ({ key: 'printify', submitOrder, }), }),);
vi.mock('./providers/settings', () => ({ getActiveProviderConfig: async () => ({ token: 't', }), }),);

let claimed = true;
const query = vi.fn(async (sql: string,) => {
    if (/FROM shop_orders WHERE id = \$1/.test(sql,)) {
        return { rows: [{ id: 'o1', order_number: 'SS-1', customer_email: 'a@b', customer_name: null, shipping_address: {}, shipping_method: null, },], };
    }
    if (/SELECT DISTINCT fulfillment_group/.test(sql,)) return { rows: [{ fulfillment_group: 'printify', },], };
    if (/SELECT external_order_id FROM shop_order_fulfillments/.test(sql.replace(/\s+/g, ' ',),)) return { rows: [], };
    if (/FROM shop_order_items oi/.test(sql,)) {
        return { rows: [{ variant_id: 'v', quantity: 1, external_product_id: 'p', external_variant_id: '1', weight_grams: 0, },], };
    }
    if (/RETURNING id/.test(sql,)) return { rows: claimed ? [{ id: 'f1', },] : [], };
    return { rows: [], };
},);
vi.mock('../../db', () => ({ query: (sql: string, p?: unknown[],) => query(sql, ...(p ? [p,] : []) as []), }),);

const { submitOrderToProviders, retryPendingProviderFulfillment, } = await import('./providerFulfillment');

beforeEach(() => {
    submitOrder.mockClear();
    query.mockClear();
    claimed = true;
},);

describe('submitOrderToProviders — claim', () => {
    it('submits when it wins the claim', async () => {
        const r = await submitOrderToProviders('o1',);
        expect(r.submitted,).toEqual(['printify',],);
        expect(submitOrder,).toHaveBeenCalledTimes(1,);
    },);

    it('skips (never calls the supplier) when another submit holds the claim', async () => {
        claimed = false;
        const r = await submitOrderToProviders('o1',);
        expect(r.skipped,).toEqual(['printify',],);
        expect(submitOrder,).not.toHaveBeenCalled();
    },);

    it('the claim refuses a fresh in-flight submit and a linked row', async () => {
        await submitOrderToProviders('o1',);
        const sql = query.mock.calls.map((c,) => String(c[0],),).find((s,) => /RETURNING id/.test(s,),)!;
        expect(sql,).toMatch(/external_order_id IS NULL/,);
        expect(sql,).toMatch(/status <> 'submitting'/,);
    },);

    it('the retry sweep leaves fresh submitting rows alone', async () => {
        await retryPendingProviderFulfillment();
        const sql = String(query.mock.calls[0][0],);
        expect(sql,).toMatch(/f\.status = 'submitting' AND f\.updated_at < NOW\(\)/,);
    },);
},);
