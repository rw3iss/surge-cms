/** Stable JSON stringify (sorted keys) so equal args produce equal keys. */
function stableStringify(value: unknown,): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value,) ?? 'null';
    if (Array.isArray(value,)) return `[${value.map(stableStringify,).join(',',)}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj,).filter((k,) => obj[k] !== undefined,).sort();
    return `{${keys.map((k,) => `${JSON.stringify(k,)}:${stableStringify(obj[k],)}`,).join(',',)}}`;
}

/** cms:<module>:<method>:<argsHash> */
export function cacheKey(namespace: string, module: string, method: string, args?: unknown,): string {
    const hash = args === undefined ? '' : stableStringify(args,);
    return `${namespace}:${module}:${method}:${hash}`;
}

/** prefix for invalidating every key of module.method (or whole module). */
export function cacheKeyPrefix(namespace: string, module: string, method?: string,): string {
    return method ? `${namespace}:${module}:${method}:` : `${namespace}:${module}:`;
}
