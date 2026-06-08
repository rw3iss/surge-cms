import type { ApiResponse, } from '@rw/cms-shared';
import { AbortError, CmsError, errorFromEnvelope, NetworkError, TimeoutError, } from './errors';

export interface RequestSpec {
    fetchImpl: typeof fetch;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
    /** true → return the raw text body, skip envelope unwrap (feed/sitemap). */
    raw?: boolean;
    timeoutMs: number;
    signal?: AbortSignal;
}

function isFormData(v: unknown,): v is FormData {
    return typeof FormData !== 'undefined' && v instanceof FormData;
}

/** Single network attempt. Builds init, enforces timeout, unwraps the
 *  ApiResponse envelope (or returns raw text), throws a typed CmsError. */
export async function performRequest<T>(spec: RequestSpec,): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), spec.timeoutMs,);
    // Chain an external signal if provided.
    if (spec.signal) {
        if (spec.signal.aborted) controller.abort();
        else spec.signal.addEventListener('abort', () => controller.abort(), { once: true, },);
    }

    const headers: Record<string, string> = { ...spec.headers, };
    let body: BodyInit | undefined;
    if (spec.body !== undefined) {
        if (isFormData(spec.body,)) { body = spec.body; /* let fetch set the boundary */ }
        else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(spec.body,); }
    }

    let res: Response;
    try {
        res = await spec.fetchImpl(spec.url, {
            method: spec.method, headers, body, signal: controller.signal, credentials: 'include',
        } as RequestInit,);
    } catch (err) {
        clearTimeout(timeout,);
        const name = (err as { name?: string; }).name;
        if (name === 'AbortError') {
            throw spec.signal?.aborted ? new AbortError() : new TimeoutError(`Request to ${spec.url} timed out`,);
        }
        throw new NetworkError((err as Error).message || 'Network request failed',);
    }
    clearTimeout(timeout,);

    if (spec.raw) {
        const text = await res.text();
        if (!res.ok) throw new CmsError(`Request failed (${res.status})`, { code: 'UNKNOWN_ERROR', status: res.status, },);
        return text as unknown as T;
    }

    let payload: ApiResponse<T>;
    try { payload = await res.json() as ApiResponse<T>; }
    catch { throw new CmsError(`Invalid JSON from ${spec.url} (${res.status})`, { code: 'UNKNOWN_ERROR', status: res.status, },); }

    if (res.ok && payload.success) return payload.data as T;

    const retryAfterHeader = res.headers.get('retry-after',);
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader,) : undefined;
    const error = payload.error ?? { code: 'UNKNOWN_ERROR', message: `Request failed (${res.status})`, } as never;
    throw errorFromEnvelope(res.status, error, retryAfter,);
}
