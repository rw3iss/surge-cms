/**
 * Shared Meta Graph API helpers for the Instagram + Facebook collectors.
 *
 * Meta renames and removes insight metrics every 6–12 months, and ONE invalid
 * metric fails a whole `metric=a,b,c` request. So metric groups are requested
 * together first and, on a metric error, one by one — a metric that fails
 * alone is remembered as unavailable for the rest of the run and reported
 * once (never a throw).
 */
import type { DailyPoint, } from '../types';

/** Current Graph version (v27 is the newest; v25 carries every metric we read). */
export const GRAPH_VERSION = 'v25.0';
export const FACEBOOK_GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;
export const INSTAGRAM_GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;

/** An env fallback, ignoring the `.env.example` placeholders ("your-…"). */
export function envValue(v: string | undefined,): string {
    const s = (v ?? '').trim();
    return /^your[-_]/i.test(s,) ? '' : s;
}

export class GraphError extends Error {
    constructor(
        message: string,
        public status: number,
        public code: number | null,
        public subcode: number | null,
    ) {
        super(message,);
    }
}

/** Token expired / revoked / invalid session — nothing else can work this run. */
export function isTokenError(e: unknown,): boolean {
    return e instanceof GraphError && (e.code === 190 || e.code === 102 || e.status === 401);
}

/** Why Meta rejected the token, in words an operator can act on (subcodes 458–467). */
export function tokenErrorHint(e: unknown,): string {
    const sub = e instanceof GraphError ? e.subcode : null;
    if (sub === 463) return 'the token has expired';
    if (sub === 460) return 'the account password changed, which revoked the token';
    if (sub === 458) return 'the app was removed from the account';
    if (sub === 459 || sub === 464) return 'the account needs to log in to Facebook to resolve a checkpoint';
    if (sub === 467) return 'the user logged out or the token was revoked';
    return 'the token is invalid or was revoked';
}

/** Meta throttling (app / user / Page / Business Use Case limits) — stop asking for the rest of this run. */
export function isRateLimitError(e: unknown,): boolean {
    if (!(e instanceof GraphError)) return false;
    const c = e.code;
    return e.status === 429 || c === 4 || c === 17 || c === 32 || c === 613 || (c !== null && c >= 80000 && c <= 80099);
}

/** The token lacks a permission (insights scope, ANALYZE task on the Page…). */
export function isPermissionError(e: unknown,): boolean {
    if (!(e instanceof GraphError)) return false;
    if (e.code === 10 && /not enough viewers/i.test(e.message,)) return false;
    return e.code === 10 || e.code === 200 || (e.code !== null && e.code >= 200 && e.code <= 299) || e.status === 403;
}

/** An unknown / removed metric, or a metric that does not apply to this object. */
export function isMetricError(e: unknown,): boolean {
    return e instanceof GraphError && (e.code === 100 || e.code === 2500) && !isTokenError(e,);
}

/** A Graph request that has not answered in this long is abandoned (one hung socket must not stall the cron). */
export const GRAPH_TIMEOUT_MS = 30_000;

/**
 * Strip credentials from text that may reach a warning, a log or stored JSON:
 * the token itself and any `access_token=` / `client_secret=` URL parameter.
 */
export function redactSecrets(text: string, ...secrets: Array<string | null | undefined>): string {
    let out = String(text ?? '',);
    for (const s of secrets) if (s && s.length >= 8) out = out.split(s,).join('[redacted]',);
    return out.replace(/((?:access_token|client_secret|appsecret_proof|fb_exchange_token)=)[^&\s"']+/gi, '$1[redacted]',);
}

/** GET a Graph URL. The token travels as a param but is never echoed in an error. */
export async function graphGet<T = any,>(base: string, path: string, params: Record<string, string>, token: string,): Promise<T> {
    const q = new URLSearchParams({ ...params, access_token: token, },);
    let res: Response;
    try {
        res = await fetch(`${base}/${path.replace(/^\//, '',)}?${q}`, { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS,), },);
    } catch (e) {
        const timedOut = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
        const msg = timedOut ? `no answer within ${GRAPH_TIMEOUT_MS / 1000} s` : (e as Error)?.message || 'network error';
        throw new GraphError(`Graph request failed: ${redactSecrets(msg, token,)}`, 0, null, null,);
    }
    const data = await res.json().catch(() => ({})) as { error?: { message?: string; code?: number; error_subcode?: number; }; };
    if (!res.ok || data?.error) {
        const err = data?.error ?? {};
        throw new GraphError(redactSecrets(err.message || `HTTP ${res.status}`, token,), res.status, err.code ?? null, err.error_subcode ?? null,);
    }
    return data as T;
}

export interface InsightRow {
    name: string;
    period?: string;
    values?: Array<{ value: unknown; end_time?: string; }>;
    total_value?: { value?: unknown; breakdowns?: Array<{ dimension_keys?: string[]; results?: Array<{ dimension_values?: string[]; value?: unknown; }>; }>; };
}

export interface InsightResponse {
    data?: InsightRow[];
}

const num = (v: unknown,): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const x = Number(v,);
    return Number.isFinite(x,) ? x : null;
};

/** A lifetime / total insight per metric name (numbers only). */
export function insightNumbers(resp: InsightResponse,): Map<string, number> {
    const out = new Map<string, number>();
    for (const row of resp.data ?? []) {
        const total = num(row.total_value?.value,);
        if (total !== null) {
            out.set(row.name, total,);
            continue;
        }
        const last = row.values?.[row.values.length - 1];
        const v = num(last?.value,);
        if (v !== null) out.set(row.name, v,);
    }
    return out;
}

/** Non-numeric insight values (e.g. reactions by type) — kept as raw. */
export function insightObjects(resp: InsightResponse,): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const row of resp.data ?? []) {
        const v = row.total_value?.value ?? row.values?.[row.values.length - 1]?.value;
        if (v !== null && typeof v === 'object') out[row.name] = v;
    }
    return out;
}

/**
 * A daily insight `end_time` is the END of the day it covers (midnight
 * Pacific, e.g. `2026-11-04T07:00:00+0000` = the 3rd) → that day.
 */
export function endTimeToDate(endTime: string,): string | null {
    const t = Date.parse(endTime.replace(/\+0000$/, 'Z',),);
    if (!Number.isFinite(t,)) return null;
    return new Date(t - 86400_000,).toISOString().slice(0, 10,);
}

/** Daily time-series rows → points, mapping Graph metric names to ours. */
export function timeSeriesPoints(resp: InsightResponse, map: Record<string, string>, scale: Record<string, number> = {},): DailyPoint[] {
    const points: DailyPoint[] = [];
    for (const row of resp.data ?? []) {
        const metric = map[row.name];
        if (!metric || (row.period && row.period !== 'day')) continue;
        for (const v of row.values ?? []) {
            const value = num(v.value,);
            const date = v.end_time ? endTimeToDate(v.end_time,) : null;
            if (value === null || !date) continue;
            points.push({ date, metric, value: value * (scale[row.name] ?? 1), },);
        }
    }
    return points;
}

export function addDays(day: string, n: number,): string {
    const d = new Date(`${day}T00:00:00Z`,);
    d.setUTCDate(d.getUTCDate() + n,);
    return d.toISOString().slice(0, 10,);
}

/** Unix seconds at 00:00 UTC of a YYYY-MM-DD. */
export function unixDay(day: string,): number {
    return Math.floor(Date.parse(`${day}T00:00:00Z`,) / 1000,);
}

export function chunk<T,>(list: T[], size: number,): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size,),);
    return out;
}

/** Run `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R,>(items: T[], limit: number, fn: (item: T,) => Promise<R>,): Promise<R[]> {
    const out: R[] = new Array(items.length,);
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i],);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length,), }, worker,),);
    return out;
}

/**
 * Collects warnings so a failure repeated over 200 posts is reported once,
 * with a count, instead of 200 times.
 */
export class WarningBag {
    private counts = new Map<string, number>();
    add(message: string,): void {
        this.counts.set(message, (this.counts.get(message,) ?? 0) + 1,);
    }
    flush(warn: (m: string,) => void,): void {
        for (const [m, n,] of this.counts) warn(n > 1 ? `${m} (×${n})` : m,);
        this.counts.clear();
    }
}

/** Prefix of the "ask this group one by one" marker kept in a `dead` set (never a metric name). */
const SPLIT_MARK = '\u0000split:';

/**
 * Fetch an insights edge for a metric list, tolerating dead metrics:
 * all at once → on a metric error, one at a time. `dead` is shared across
 * calls of one run, so a removed metric costs one failed request, not one
 * per post. Token and permission errors propagate (the caller decides).
 */
export async function fetchInsights(
    base: string,
    path: string,
    metrics: string[],
    params: Record<string, string>,
    token: string,
    dead: Set<string>,
    warnings: WarningBag,
    label: string,
): Promise<InsightResponse> {
    const live = metrics.filter((m,) => !dead.has(m,));
    if (!live.length) return { data: [], };
    // A group Meta refuses together although every metric works alone (a
    // metric that "invalidates" a grouped request) is asked one by one for the
    // rest of the run — not group-first (+ 1 failed call) per object.
    const splitKey = `${SPLIT_MARK}${[...live,].sort().join(',',)}`;
    let groupError: Error = new Error('grouped request refused',);
    if (live.length === 1 || !dead.has(splitKey,)) {
        try {
            return await graphGet<InsightResponse>(base, path, { ...params, metric: live.join(',',), }, token,);
        } catch (e) {
            if (!isMetricError(e,)) throw e;
            groupError = e as Error;
        }
    }
    const data: InsightRow[] = [];
    const failed: Array<[string, string,]> = [];
    if (live.length > 1) {
        for (const m of live) {
            try {
                const r = await graphGet<InsightResponse>(base, path, { ...params, metric: m, }, token,);
                data.push(...(r.data ?? []),);
            } catch (e) {
                if (!isMetricError(e,)) throw e;
                failed.push([m, (e as Error).message,],);
            }
        }
    }
    // Every metric failed (or the only one did, alone): the OBJECT has no
    // insights (an album child, media older than the business conversion…),
    // not the metrics — don't blacklist them for the rest of the run.
    if (live.length === 1 || failed.length === live.length) {
        warnings.add(`${label} (${live.join(', ',)}): ${failed[0]?.[1] ?? groupError.message}`,);
        return { data: [], };
    }
    if (!failed.length) dead.add(splitKey,);
    for (const [m, msg,] of failed) {
        dead.add(m,);
        warnings.add(`${label}: metric ${m} unavailable — ${msg}`,);
    }
    return { data, };
}

/**
 * Should a listed item get per-post insights today? The runner's due list
 * (≤ 90 days daily, older weekly) decides; an item the listing reached that is
 * not due is asked only when it is recent (just discovered, not yet in the due
 * list) — so the tail of the last listed page is not measured daily forever.
 */
export function dueForMetrics(id: string, time: string | undefined, due: Set<string>, today: string, days: number,): boolean {
    if (due.has(id,)) return true;
    const t = Date.parse(String(time ?? '',).replace(/\+0000$/, 'Z',),);
    if (!Number.isFinite(t,)) return true;
    return Date.parse(`${addDays(today, -days,)}T00:00:00Z`,) <= t;
}
