/**
 * Live stream providers: the catalogue (descriptors → admin settings form) and
 * the server adapters that make a provider work.
 */
export { LIVE_PROVIDERS, getLiveProvider, isLiveProviderConfigured, } from './registry';
export { LIVE_ADAPTERS, getAdapter, } from './adapters';
export type { LiveAdapterPlayback, LiveAdapterPost, LiveInputResult, LiveProviderAdapter, LiveProviderConfig, } from './types';
