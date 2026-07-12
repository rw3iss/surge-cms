import type { ApiResponse, PageMeta, } from '@sitesurge/types';
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

/** A paged read's payload: the rows plus the envelope's page meta. */
export interface PagedPayload<T> {
    data: T;
    meta: PageMeta;
}

/** Single network attempt. Builds init, enforces timeout, unwraps the
 *  ApiResponse envelope (or returns raw text), throws a typed CmsError. */
export async function performRequest<T>(spec: RequestSpec,): Promise<T> {
    const res = await sendRequest(spec,);

    if (spec.raw) {
        const text = await res.text();
        if (!res.ok) throw new CmsError(`Request failed (${res.status})`, { code: 'UNKNOWN_ERROR', status: res.status, },);
        return text as unknown as T;
    }

    return unwrapEnvelope<T>(res, spec.url,);
}

/** Same network/timeout path as `performRequest`, but returns BOTH the
 *  unwrapped `data` and the envelope's `meta` (page/limit/total/totalPages)
 *  for paginated list reads. Throws the identical typed CmsError on failure. */
export async function performRequestEnvelope<T>(spec: RequestSpec,): Promise<PagedPayload<T>> {
    const res = await sendRequest(spec,);
    return unwrapEnvelopeWithMeta<T>(res, spec.url,);
}

/** Build init, enforce timeout, perform one fetch; translate transport
 *  failures into typed errors. Returns the raw Response for unwrapping. */
async function sendRequest(spec: RequestSpec,): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), spec.timeoutMs,);
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

    try {
        const res = await spec.fetchImpl(spec.url, {
            method: spec.method, headers, body, signal: controller.signal, credentials: 'include',
        } as RequestInit,);
        clearTimeout(timeout,);
        return res;
    } catch (err) {
        clearTimeout(timeout,);
        const name = (err as { name?: string; }).name;
        if (name === 'AbortError') {
            throw spec.signal?.aborted ? new AbortError() : new TimeoutError(`Request to ${spec.url} timed out`,);
        }
        throw new NetworkError((err as Error).message || 'Network request failed',);
    }
}

/** Parse the JSON envelope and return its `data` (or throw the typed error). */
async function unwrapEnvelope<T>(res: Response, url: string,): Promise<T> {
    const payload = await readEnvelope<T>(res, url,);
    if (res.ok && payload.success) return payload.data as T;
    throw envelopeError(res, payload,);
}

/** Parse the JSON envelope and return both `data` and `meta`. */
async function unwrapEnvelopeWithMeta<T>(res: Response, url: string,): Promise<PagedPayload<T>> {
    const payload = await readEnvelope<T>(res, url,);
    if (res.ok && payload.success) return { data: payload.data as T, meta: payload.meta ?? {}, };
    throw envelopeError(res, payload,);
}

async function readEnvelope<T>(res: Response, url: string,): Promise<ApiResponse<T>> {
    try { return await res.json() as ApiResponse<T>; }
    catch { throw new CmsError(`Invalid JSON from ${url} (${res.status})`, { code: 'UNKNOWN_ERROR', status: res.status, },); }
}

function envelopeError(res: Response, payload: ApiResponse<unknown>,): CmsError {
    const retryAfterHeader = res.headers.get('retry-after',);
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader,) : undefined;
    const error = payload.error ?? { code: 'UNKNOWN_ERROR', message: `Request failed (${res.status})`, } as never;
    return errorFromEnvelope(res.status, error, retryAfter,);
}
