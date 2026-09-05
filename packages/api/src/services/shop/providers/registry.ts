/**
 * The Shop Provider registry.
 *
 * Modelled on `FEATURE_REGISTRY`: one static, compile-time-exhaustive map, so
 * adding a provider is a single entry and every consumer (settings, checkout,
 * webhooks, cron) picks it up without its own switch statement.
 *
 * Note what is NOT here: Shopify. It replaces the storefront and checkout
 * wholesale rather than fulfilling items, so it cannot share a cart with these
 * and it stays a plugin.
 */
import type { ProviderKey, ShopProvider, } from './types';
import { apliiqProvider, } from './apliiq/provider';
import { printfulProvider, } from './printful';
import { printifyProvider, } from './printify';

export const PROVIDER_REGISTRY: Record<ProviderKey, ShopProvider> = {
    printify: printifyProvider,
    apliiq: apliiqProvider,
    printful: printfulProvider,
};

export function listProviders(): ShopProvider[] {
    return Object.values(PROVIDER_REGISTRY,);
}

export function getProvider(key: string,): ShopProvider | undefined {
    return (PROVIDER_REGISTRY as Record<string, ShopProvider>)[key];
}

export function isProviderKey(key: string,): key is ProviderKey {
    return key in PROVIDER_REGISTRY;
}

/**
 * Resolve a provider's deep link back to the source design/product.
 *
 * The template is operator-editable per provider, so the admin UI never
 * hard-codes a supplier URL. An unset template yields null and the caller
 * simply omits the link.
 */
export function designUrl(
    config: Record<string, unknown>,
    refs: { externalId?: string | null; designId?: string | null; },
): string | null {
    const tpl = String(config.designUrlTemplate ?? '',).trim();
    if (!tpl) return null;
    const designId = refs.designId ?? refs.externalId ?? '';
    const externalId = refs.externalId ?? refs.designId ?? '';
    if (!designId && !externalId) return null;
    return tpl
        .replace(/\{designId\}/g, encodeURIComponent(designId,),)
        .replace(/\{externalId\}/g, encodeURIComponent(externalId,),);
}
