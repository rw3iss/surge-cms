/**
 * Printful as a Shop Provider — declared, not yet implemented.
 *
 * Present in the registry from day one on purpose: an operator can see it
 * exists, enter credentials, and test the connection. Everything that would
 * need real API work throws `ProviderNotImplementedError`, so the admin gets an
 * honest "not implemented yet" instead of a toggle that appears to work and
 * silently does nothing.
 *
 * Filling this in means writing `syncProducts` (Printful has a pullable
 * catalogue, so it follows Printify's shape rather than Apliiq's) and
 * `submitOrder`, plus deciding poll-vs-webhook for tracking.
 */
import type { ProviderField, ShopProvider, } from './types';
import { ProviderNotImplementedError, } from './types';

const CONFIG_SCHEMA: ProviderField[] = [
    {
        key: 'apiKey', label: 'API key', type: 'secret', required: true,
        help: 'Printful → Settings → Stores → API. Use a store-scoped key.',
    },
    {
        key: 'storeId', label: 'Store ID', type: 'string',
        help: 'Required only when the key covers more than one store.',
    },
    {
        key: 'designUrlTemplate', label: 'Design URL template', type: 'string',
        default: 'https://www.printful.com/dashboard/sync/{externalId}',
        help: 'Links an imported product back to its Printful source.',
    },
];

export const printfulProvider: ShopProvider = {
    key: 'printful',
    label: 'Printful',
    description: 'Print-on-demand fulfilment. Integration scaffolded — API calls not yet written.',
    configSchema: CONFIG_SCHEMA,

    isConfigured(config,) {
        return Boolean(String(config.apiKey ?? '',).trim(),);
    },

    async testConnection(config,) {
        if (!printfulProvider.isConfigured(config,)) {
            return { ok: false, message: 'Enter an API key first.', };
        }
        return {
            ok: false,
            message: 'Printful is scaffolded but not implemented yet — credentials are stored, but nothing is synced or ordered.',
        };
    },

    async syncProducts() {
        throw new ProviderNotImplementedError('printful', 'catalogue sync',);
    },

    async submitOrder() {
        throw new ProviderNotImplementedError('printful', 'order submission',);
    },
};
