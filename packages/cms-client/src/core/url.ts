/** Replace :param tokens in a path with encoded values. */
export function interpolatePath(path: string, params?: Record<string, string | number>,): string {
    if (!params) return path;
    return path.replace(/:([A-Za-z0-9_]+)/g, (_, key,) => {
        const v = params[key];
        if (v === undefined) throw new Error(`Missing path param ":${key}" for ${path}`,);
        return encodeURIComponent(String(v,),);
    },);
}

/** Serialize a query object to a string; drops undefined/null; numbers→strings. */
export function buildQuery(query?: Record<string, unknown>,): string {
    if (!query) return '';
    const sp = new URLSearchParams();
    for (const [k, v,] of Object.entries(query,)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v,)) { for (const item of v) sp.append(k, String(item,),); }
        else sp.append(k, String(v,),);
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
}

export function joinUrl(base: string, path: string, query?: Record<string, unknown>,): string {
    const p = path.startsWith('/',) ? path : `/${path}`;
    return `${base}${p}${buildQuery(query,)}`;
}
