import {
    type CmsClientConfig, type ResolvedConfig, type TtlMap, DEFAULT_RETRY, DEFAULT_TTL,
} from './types';

function resolveFetch(injected?: typeof fetch,): typeof fetch {
    if (injected) return injected;
    if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis,);
    throw new Error('No fetch implementation available — pass `fetch` in the client config (Node < 18).',);
}

export function resolveConfig(config: CmsClientConfig,): ResolvedConfig {
    if (!config.baseUrl) throw new Error('cms-client: `baseUrl` is required.',);
    const baseUrl = config.baseUrl.replace(/\/+$/, '',);
    const cacheOpt = config.cache;
    const cacheEnabled = cacheOpt !== false;
    const cacheObj = (typeof cacheOpt === 'object' && cacheOpt !== null) ? cacheOpt : {};
    const authMode = config.auth?.mode ?? (config.auth?.apiKey ? 'apiKey' : 'bearer');

    const ttl: TtlMap = { ...DEFAULT_TTL, };
    if (cacheObj.ttl) {
        for (const [key, value,] of Object.entries(cacheObj.ttl,)) {
            if (value !== undefined) ttl[key] = value;
        }
    }

    return {
        baseUrl,
        apiBase: `${baseUrl}/api/v1`,
        authMode,
        apiKey: config.auth?.apiKey,
        initialTokens: config.auth?.tokens,
        storageKey: config.auth?.storageKey ?? 'cms.auth',
        customStore: config.auth?.store,
        cacheEnabled,
        cacheAdapter: cacheObj.adapter ?? 'auto',
        ttl,
        namespace: cacheObj.namespace ?? 'cms',
        fetchImpl: resolveFetch(config.fetch,),
        timeoutMs: config.timeoutMs ?? 30_000,
        retry: { ...DEFAULT_RETRY, ...config.retry, },
        headers: config.headers ?? {},
        onError: config.onError,
    };
}
