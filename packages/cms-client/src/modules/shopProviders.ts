import { ModuleBase, } from './base';

export interface ShopProviderField {
    key: string;
    label: string;
    type: 'string' | 'secret' | 'boolean' | 'number';
    required?: boolean;
    help?: string;
    default?: unknown;
}

export interface ShopProviderSummary {
    key: string;
    label: string;
    description?: string;
    configSchema: ShopProviderField[];
    /** Secrets arrive masked; sending a masked value back leaves it unchanged. */
    config: Record<string, unknown>;
    enabled: boolean;
    configured: boolean;
    autoSync: boolean;
    syncIntervalMinutes: number;
    lastSyncAt: string | null;
    lastError: string | null;
    /** False for providers that push rather than publish a catalogue (Apliiq). */
    supportsSync: boolean;
    /** False for providers with no rate API — their items use the flat rate. */
    supportsShippingQuote: boolean;
}

export interface ShopProviderWebhook {
    id: string;
    event: string;
    label: string;
    method: string;
    enabled: boolean;
    isCustom: boolean;
    /** False when the provider does not sign this endpoint, so the secret URL
     *  is its only protection. */
    signed: boolean;
    url: string;
    lastSeenAt: string | null;
    lastStatus: number | null;
    callCount: number;
}

/** /shop/providers — fulfilment suppliers (Printify, Apliiq, Printful). */
export class ShopProvidersModule extends ModuleBase {
    protected readonly module = 'shop-providers';

    list(): Promise<ShopProviderSummary[]> {
        return this.get<ShopProviderSummary[]>('/shop/providers', { options: { cache: false, }, },);
    }

    save(key: string, body: {
        enabled?: boolean; autoSync?: boolean;
        syncIntervalMinutes?: number; config?: Record<string, unknown>;
    },): Promise<{ key: string; enabled: boolean; }> {
        return this.mutate('PUT', '/shop/providers/:key', {
            params: { key, }, body, invalidates: ['shop-providers', 'shop',],
        },);
    }

    test(key: string,): Promise<{ ok: boolean; message: string; }> {
        return this.mutate('POST', '/shop/providers/:key/test', { params: { key, }, },);
    }

    sync(key: string,): Promise<{ ok: boolean; message?: string; upserted?: number; archived?: number; }> {
        return this.mutate('POST', '/shop/providers/:key/sync', {
            params: { key, }, invalidates: ['shop',],
        },);
    }

    webhooks(key: string,): Promise<ShopProviderWebhook[]> {
        return this.get<ShopProviderWebhook[]>('/shop/providers/:key/webhooks', {
            params: { key, }, options: { cache: false, },
        },);
    }

    regenerateWebhook(key: string, id: string,): Promise<{ id: string; url: string; }> {
        return this.mutate('POST', '/shop/providers/:key/webhooks/:id/regenerate', {
            params: { key, id, }, invalidates: ['shop-providers',],
        },);
    }
}
