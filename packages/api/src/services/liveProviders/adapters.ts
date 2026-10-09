/**
 * Implemented live provider adapters, by descriptor key. A descriptor is
 * `implemented` exactly when its key is here (registry.ts derives it).
 */
import { cloudflareStreamAdapter, } from './cloudflareStream';
import type { LiveProviderAdapter, } from './types';

export const LIVE_ADAPTERS: Readonly<Record<string, LiveProviderAdapter>> = {
    [cloudflareStreamAdapter.key]: cloudflareStreamAdapter,
};

export function getAdapter(key: string | null | undefined,): LiveProviderAdapter | undefined {
    return key ? LIVE_ADAPTERS[key] : undefined;
}
