/**
 * Apliiq as a Shop Provider.
 *
 * Apliiq is the inverse of Printify and the contract's optional members are
 * where that shows:
 *
 *  - no `syncProducts` — there is no list-designs endpoint. Products arrive by
 *    PUSH: the operator clicks "Add to Store" in Apliiq and it POSTs the product
 *    to the webhook we own. Verified against the live API; a design is not even
 *    reachable by its public product-page id until it has been added to a store.
 *  - no `quoteShipping` — Apliiq publishes no rate endpoint. Its lines fall back
 *    to the shop's configured flat rate, flagged so the storefront can say the
 *    figure is an estimate rather than silently shipping free.
 *  - `verifyWebhook` rather than `pollStatus` — tracking is pushed to the
 *    Fulfillment URL, signed with `x-apliiq-hmac`.
 */
import crypto from 'crypto';
import type {
    IncomingStoreProduct,
    ProviderField,
    ProviderWebhookEvent,
    ShopProvider,
    StoreAddDecision,
} from '../types';

const CONFIG_SCHEMA: ProviderField[] = [
    {
        key: 'appKey', label: 'App key', type: 'string', required: true,
        help: 'Apliiq → Stores → your custom store → security keys.',
    },
    {
        key: 'sharedSecret', label: 'Shared secret', type: 'secret', required: true,
        help: 'Signs every request. Never leaves the server.',
    },
    {
        key: 'designUrlTemplate', label: 'Design URL template', type: 'string',
        default: 'https://www.apliiq.com/product/{designId}',
        help: 'Links an imported product back to its Apliiq design. {designId} and {externalId} are substituted.',
    },
];

/**
 * The four inbound webhooks Apliiq offers. Their dashboard names are used as
 * labels verbatim so an operator can match our row to their field without
 * guessing which is which.
 *
 * Only Fulfillment is signed. The other three are unauthenticated by Apliiq's
 * design — see the security note in the plan; the path token is the only
 * credential they carry, which is why product writes land as drafts.
 */
const WEBHOOK_EVENTS: ProviderWebhookEvent[] = [
    {
        event: 'product_add_or_update', label: 'Add product to store URL',
        path: 'product-add-or-update', method: 'POST', signed: false,
    },
    {
        // A GET with ?search= — Apliiq queries OUR catalogue to tell the operator
        // whether a design is already in the store.
        event: 'product_search', label: 'Product Search URL',
        path: 'product-search', method: 'GET', signed: false,
    },
    {
        event: 'fulfillment', label: 'Fulfillment URL',
        path: 'fulfillment', method: 'POST', signed: true,
    },
    {
        event: 'warehouse_shipment_complete', label: 'Warehouse Shipment Complete URL',
        path: 'shipment-complete', method: 'POST', signed: false,
    },
];

/** Map our stored address onto the field names Apliiq expects. */
function toApliiqAddress(addr: Record<string, unknown>, name: string | null,): Record<string, unknown> {
    const full = String(addr.name ?? name ?? '',).trim();
    const sp = full.indexOf(' ',);
    return {
        first_name: addr.firstName ?? (sp > 0 ? full.slice(0, sp,) : full),
        last_name: addr.lastName ?? (sp > 0 ? full.slice(sp + 1,) : ''),
        address1: addr.line1 ?? addr.address1 ?? '',
        address2: addr.line2 ?? addr.address2 ?? '',
        phone: addr.phone ?? '',
        city: addr.city ?? '',
        zip: addr.postalCode ?? addr.zip ?? '',
        province: addr.state ?? addr.province ?? '',
        province_code: addr.stateCode ?? addr.province_code ?? addr.state ?? '',
        country: addr.country ?? 'United States',
        country_code: addr.countryCode ?? addr.country_code ?? 'US',
    };
}

/** `APQ-4633445S6A1` → `4633445`: the design stem shared by a product's SKUs. */
export function designStemFromSku(sku: string,): string | null {
    const m = /^APQ-(\d+)/.exec(sku.trim(),);
    return m ? m[1] : null;
}

export const apliiqProvider: ShopProvider = {
    key: 'apliiq',
    label: 'Apliiq',
    description:
        'Print-on-demand apparel with embroidery, woven labels and neck prints. '
        + 'Products are pushed to the store from Apliiq rather than synced.',
    configSchema: CONFIG_SCHEMA,
    webhookEvents: WEBHOOK_EVENTS,

    isConfigured(config,) {
        return Boolean(String(config.appKey ?? '',).trim() && String(config.sharedSecret ?? '',).trim(),);
    },

    async testConnection(config,) {
        if (!apliiqProvider.isConfigured(config,)) {
            return { ok: false, message: 'Enter an app key and shared secret first.', };
        }
        try {
            const { apliiqRequest, } = await import('./client.js');
            // The blank catalogue is the cheapest authenticated GET that proves
            // the signature is correct. It is large, so only the status matters.
            const res = await apliiqRequest(config, '/v1/Product/',);
            if (res.status === 401) return { ok: false, message: 'Rejected (401) — check the app key and shared secret.', };
            if (res.status !== 200) return { ok: false, message: `Apliiq returned ${res.status}.`, };
            return { ok: true, message: 'Connected to Apliiq.', };
        } catch (err) {
            return { ok: false, message: (err as Error).message, };
        }
    },

    /**
     * Reject anything that is not one coherent design before it is written.
     *
     * The add-to-store webhook is unauthenticated, so this is also the first
     * real validation the payload gets.
     */
    async beforeStoreAdd(_config, incoming: IncomingStoreProduct,): Promise<StoreAddDecision> {
        if (!incoming.variants.length) {
            return { action: 'reject', reason: 'The product arrived with no variants.', };
        }
        const stems = new Set<string>();
        for (const v of incoming.variants) {
            const stem = designStemFromSku(v.sku,);
            if (!stem) {
                return {
                    action: 'reject',
                    reason: `Variant SKU “${v.sku}” is not an Apliiq SKU (expected APQ-…).`,
                };
            }
            stems.add(stem,);
        }
        if (stems.size > 1) {
            // Two designs arriving as one product would import as a single
            // product whose variants order different garments — worth refusing
            // loudly rather than discovering it at fulfilment.
            return {
                action: 'reject',
                reason: `Variants belong to ${stems.size} different designs (${[...stems,].join(', ',)}).`,
            };
        }
        const { defaultStoreAddCheck, } = await import('../storeAdd.js');
        return defaultStoreAddCheck('apliiq', {
            ...incoming,
            externalDesignId: incoming.externalDesignId ?? [...stems,][0],
        },);
    },

    async submitOrder(config, order, lines,) {
        const { apliiqRequest, } = await import('./client.js');
        const addr = (order.shippingAddress ?? {}) as Record<string, unknown>;

        const missing = lines.filter((l,) => !l.externalVariantId);
        if (missing.length) {
            throw new Error(
                `${missing.length} line(s) have no Apliiq SKU — the product was not imported from Apliiq.`,
            );
        }

        // Shopify-shaped, which is what Apliiq models its order API on.
        const body = {
            id: order.orderNumber,
            name: `#${order.orderNumber}`,
            order_number: order.orderNumber,
            line_items: lines.map((l,) => ({
                id: l.variantId,
                title: 'Order item',
                quantity: l.qty,
                sku: l.externalVariantId,
            }),),
            shipping_address: toApliiqAddress(addr, order.name,),
            billing_address: toApliiqAddress(addr, order.name,),
            shipping_lines: [{ code: order.shippingMethod || 'standard', },],
        };

        const res = await apliiqRequest<{ id?: number | string; message?: string; }>(
            config, '/v1/Order', { method: 'POST', body, },
        );

        // A 202 is NOT success. Apliiq answers 202 with
        // "we did not find any matching product(s) in this account" when a SKU
        // is unknown — accepting that as an order placed would mean a customer
        // paid for something nobody is printing.
        const id = res.json?.id;
        if (!id) {
            const detail = res.json?.message || res.text.slice(0, 300,) || `HTTP ${res.status}`;
            throw new Error(`Apliiq did not create an order (${res.status}): ${detail}`,);
        }
        return { externalOrderId: String(id,), };
    },

    verifyWebhook(config, rawBody, headers,) {
        const secret = String(config.sharedSecret ?? '',);
        const sent = headers['x-apliiq-hmac'] ?? headers['X-Apliiq-Hmac'];
        if (!secret || !sent) return false;
        // base64(HMACSHA256(base64(payload), shared_secret))
        const expected = crypto.createHmac('sha256', Buffer.from(secret, 'utf8'),)
            .update(Buffer.from(rawBody, 'utf8',).toString('base64',), 'utf8',)
            .digest('base64',);
        const a = Buffer.from(expected,);
        const b = Buffer.from(String(sent,),);
        return a.length === b.length && crypto.timingSafeEqual(a, b,);
    },
};
