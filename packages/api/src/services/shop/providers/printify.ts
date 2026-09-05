/**
 * Printify as a Shop Provider.
 *
 * A thin adapter, not a reimplementation: the engine in `services/printify/`
 * already does the sync, shipping quotes, order submission and status polling,
 * and keeps doing so. This file only re-expresses it through the common
 * `ShopProvider` contract so checkout can treat it like any other supplier.
 *
 * The config schema mirrors the plugin manifest it replaces
 * (`plugins/printify/plugin.json`) field for field, so the credential migration
 * in the providers migration is a straight copy with no key renaming.
 */
import type {
    ProviderConfig,
    ProviderField,
    ProviderLine,
    ProviderOrderContext,
    ProviderShippingQuote,
    ProviderSyncResult,
    ProviderTracking,
    ShopProvider,
} from './types';
import { ProviderNotImplementedError, } from './types';

const CONFIG_SCHEMA: ProviderField[] = [
    {
        key: 'apiToken', label: 'API access token', type: 'secret', required: true,
        help: 'Printify → My account → Connections → Personal access tokens. Needs shops/products/orders scopes.',
    },
    {
        key: 'shopId', label: 'Shop ID', type: 'string', required: true,
        help: 'Your numeric Printify shop id. Use Test connection to verify it against your account.',
    },
    {
        key: 'autoPublish', label: 'Import products as published', type: 'boolean', default: true,
        help: 'Off imports them as drafts so you can review before they hit the storefront.',
    },
    {
        key: 'syncIntervalMinutes', label: 'Auto-sync interval (minutes)', type: 'number', default: 60,
        help: '0 disables background sync; you can still sync on demand.',
    },
    {
        key: 'priceMarkupPercent', label: 'Price markup (%)', type: 'number', default: 0,
        help: "Printify's price is already retail, so this is normally 0.",
    },
    {
        key: 'autoFulfill', label: 'Send paid orders to production automatically', type: 'boolean', default: true,
    },
    {
        key: 'designUrlTemplate', label: 'Design URL template', type: 'string',
        default: 'https://printify.com/app/editor/{externalId}',
        help: 'Links an imported product back to its Printify source. {externalId} and {designId} are substituted.',
    },
];

/** Shape the stored config into what the existing engine expects. */
function toEngineConfig(config: ProviderConfig,) {
    return {
        apiToken: String(config.apiToken ?? '',),
        shopId: String(config.shopId ?? '',),
        apiBaseUrl: String(config.apiBaseUrl ?? 'https://api.printify.com/v1',),
        syncIntervalMinutes: Number(config.syncIntervalMinutes ?? 60,),
        autoPublish: config.autoPublish !== false,
        priceMarkupPercent: Number(config.priceMarkupPercent ?? 0,),
        autoFulfill: config.autoFulfill !== false,
    };
}

export const printifyProvider: ShopProvider = {
    key: 'printify',
    label: 'Printify',
    description: 'Print-on-demand catalogue sync, live shipping rates and order fulfilment.',
    configSchema: CONFIG_SCHEMA,

    isConfigured(config,) {
        return Boolean(String(config.apiToken ?? '',).trim() && String(config.shopId ?? '',).trim(),);
    },

    async testConnection(config,) {
        if (!printifyProvider.isConfigured(config,)) {
            return { ok: false, message: 'Enter an API token and shop ID first.', };
        }
        try {
            const { testConnection, } = await import('../../printify/client.js');
            const res = await testConnection(toEngineConfig(config,) as never,);
            return { ok: true, message: `Connected to “${res.shopTitle}”.`, };
        } catch (err) {
            return { ok: false, message: (err as Error).message, };
        }
    },

    async syncProducts(config,): Promise<ProviderSyncResult> {
        const { syncProducts, } = await import('../../printify/sync.js');
        const r = await syncProducts(toEngineConfig(config,) as never,);
        return {
            upserted: r.upserted, archived: r.archived,
            skipped: r.skipped, errors: r.errors as string[] | undefined,
        };
    },

    async quoteShipping(config, lines, shippingAddress,): Promise<ProviderShippingQuote> {
        const { getPrintifyShippingOptions, } = await import('../../printify/fulfillment.js');
        // The engine speaks its own line shape; map ours onto it.
        const engineLines = lines.map((l,) => ({
            externalProductId: l.externalProductId,
            externalVariantId: l.externalVariantId,
            qty: l.qty,
        }),);
        const q = await getPrintifyShippingOptions(engineLines as never, shippingAddress as never,);
        if (!q.ok) {
            return { ok: false, options: [], reason: q.reason as ProviderShippingQuote['reason'], error: q.error, };
        }
        // Printify returns a method→cents map; the contract wants ordered options.
        const ORDER = ['economy', 'standard', 'priority', 'express', 'printify_express',];
        const LABELS: Record<string, string> = {
            economy: 'Economy', standard: 'Standard', priority: 'Priority',
            express: 'Express', printify_express: 'Printify Express',
        };
        const methods = q.methods as Record<string, number | undefined>;
        return {
            ok: true,
            options: ORDER.filter((id,) => methods[id] != null)
                .map((id,) => ({ id, label: LABELS[id] ?? id, cents: methods[id]!, })),
        };
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async submitOrder(_config: ProviderConfig, _order: ProviderOrderContext, _lines: ProviderLine[],) {
        // Deliberately not wired here. The live path is
        // `submitOrderToPrintify(orderId)`, which reads the order back out of the
        // database rather than taking lines as arguments. Re-pointing it at this
        // signature is Task 5, where fulfilment is generalised across providers —
        // duplicating the body-building logic now would leave two versions to
        // keep in step in the meantime.
        throw new ProviderNotImplementedError('printify', 'order submission through the provider interface (see Task 5)',);
    },

    async pollStatus(config, externalOrderId,): Promise<ProviderTracking> {
        const { getOrder, } = await import('../../printify/client.js');
        const o = await getOrder(toEngineConfig(config,) as never, externalOrderId,) as {
            status?: string; printify_connect?: unknown;
            shipments?: Array<{ carrier?: string; number?: string; url?: string; }>;
        };
        const shipments = o.shipments ?? [];
        return {
            status: String(o.status ?? 'unknown',),
            carrier: shipments[0]?.carrier,
            tracking: shipments.map((s,) => s.number,).filter(Boolean,) as string[],
            trackingUrl: shipments[0]?.url,
        };
    },
};
