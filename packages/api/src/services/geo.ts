/**
 * Address search + reverse lookup for map pickers (the event Location field),
 * proxied to OpenStreetMap Nominatim.
 *
 * Why through the server: Nominatim's usage policy asks for an identifying
 * User-Agent, at most 1 request per second and caching of results — none of
 * which a browser can promise — and proxying keeps the CSP `connect-src`
 * closed. Results are cached 7 days (`CACHE_KEYS.geoSearch` / `geoReverse`);
 * requests are serialised per process at ≥ 1.1 s apart, identical lookups in
 * flight share one call, and at most MAX_QUEUED wait (more → 503 GEO_BUSY). Staff-only, so the
 * volume is a handful of lookups while editing an event.
 */
import type { GeoPlace, } from '@sitesurge/types';
import { AppError, } from '../core/errors';
import { logger, } from '../utils/logger';
import { cache, CACHE_KEYS, } from './cache';
import { siteBaseUrl, } from './notifications';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const TTL_SECONDS = 7 * 86_400;
/** "Nothing found" is cached for a shorter time — the map data improves, and a fixed typo should not stay unplaceable for a week. */
const EMPTY_TTL_SECONDS = 86_400;
const GAP_MS = 1100;
/** At most this many lookups wait in the queue; more are refused at once instead of piling up behind a slow upstream. */
export const MAX_QUEUED = 20;

let chain: Promise<unknown> = Promise.resolve();
let last = 0;
let queued = 0;

const unavailable = () => new AppError(502, 'GEO_UNAVAILABLE', 'The map search is not available right now. Try again in a moment.',);

/** Run `fn` no sooner than GAP_MS after the previous Nominatim call (this process); calls run one at a time. */
export function throttled<T>(fn: () => Promise<T>,): Promise<T> {
    if (queued >= MAX_QUEUED) {
        return Promise.reject(new AppError(503, 'GEO_BUSY', 'The map search is busy. Try again in a moment.',),);
    }
    queued++;
    const run = chain.then(async () => {
        try {
            const wait = last + GAP_MS - Date.now();
            if (wait > 0) await new Promise((r,) => setTimeout(r, wait,),);
            // Other workers share the 1 req/s Nominatim limit: wait for the shared gate (≤ ~5 s).
            for (let i = 0; i < 20 && !(await cache.acquireGate(CACHE_KEYS.geoGate, GAP_MS,)); i++) {
                await new Promise((r,) => setTimeout(r, 250,),);
            }
            last = Date.now();
            return await fn();
        } finally {
            queued--;
        }
    },);
    chain = run.catch(() => undefined,);
    return run;
}

/** One upstream call per key at a time: identical lookups in flight share it. */
const inFlight = new Map<string, Promise<unknown>>();
function shared<T>(key: string, fn: () => Promise<T>,): Promise<T> {
    const running = inFlight.get(key,) as Promise<T> | undefined;
    if (running) return running;
    const p = fn().finally(() => inFlight.delete(key,),);
    inFlight.set(key, p,);
    return p;
}

interface NominatimPlace {
    lat: string;
    lon: string;
    display_name: string;
    name?: string;
    address?: Record<string, string | undefined>;
}

/** "Venue, 1400 John F Kennedy Blvd, Philadelphia, PA 19107" from the address parts. */
export function shortLabelOf(p: Pick<NominatimPlace, 'name' | 'address' | 'display_name'>,): string {
    const a = p.address ?? {};
    const street = [a.house_number, a.road ?? a.pedestrian ?? a.footway,].filter(Boolean,).join(' ',);
    const city = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.suburb;
    const region = [a.state, a.postcode,].filter(Boolean,).join(' ',);
    const venue = p.name && p.name !== street && p.name !== city ? p.name : '';
    const parts = [venue, street, city, region,].filter(Boolean,);
    return parts.length >= 2 ? parts.join(', ',) : p.display_name;
}

function toPlace(p: NominatimPlace,): GeoPlace | null {
    const lat = Number(p.lat,);
    const lng = Number(p.lon,);
    if (!Number.isFinite(lat,) || !Number.isFinite(lng,)) return null;
    return { label: p.display_name, shortLabel: shortLabelOf(p,), lat, lng, };
}

async function call<T>(path: string, params: Record<string, string>,): Promise<T> {
    const url = `${NOMINATIM}${path}?${new URLSearchParams({ format: 'jsonv2', addressdetails: '1', ...params, },)}`;
    const site = await siteBaseUrl().catch(() => '',);
    return throttled(async () => {
        const res = await fetch(url, {
            headers: { 'User-Agent': `SiteSurge CMS${site ? ` (${site})` : ''}`, 'Accept-Language': 'en', },
            signal: AbortSignal.timeout(8000,),
        },).catch((e: unknown,) => {
            logger.warn('Geo lookup failed', { error: (e as Error).message, },);
            throw unavailable();
        },);
        if (!res.ok) {
            logger.warn('Geo lookup refused', { status: res.status, },);
            throw unavailable();
        }
        try {
            return await res.json() as T;
        } catch (e) {
            logger.warn('Geo lookup returned bad JSON', { error: (e as Error).message, },);
            throw unavailable();
        }
    },);
}

/** Places matching a free-text address / venue (≤ 5). */
export async function search(q: string, limit = 5,): Promise<GeoPlace[]> {
    const text = q.trim().replace(/\s+/g, ' ',).slice(0, 200,);
    if (text.length < 3) return [];
    const n = Math.max(1, Math.min(5, Math.round(limit,),),);
    const key = CACHE_KEYS.geoSearch(`${n}:${text.toLowerCase()}`,);
    const hit = await cache.get<GeoPlace[]>(key,).catch(() => null);
    if (hit) return hit;
    return shared(key, async () => {
        const rows = await call<NominatimPlace[]>('/search', { q: text, limit: String(n,), },);
        const places = (Array.isArray(rows,) ? rows : []).map(toPlace,).filter((p,): p is GeoPlace => p !== null);
        await cache.set(key, places, places.length ? TTL_SECONDS : EMPTY_TTL_SECONDS,).catch(() => {},);
        return places;
    },);
}

/** The address at a point (null when nothing is there). */
export async function reverse(lat: number, lng: number,): Promise<GeoPlace | null> {
    const la = Number(lat.toFixed(5,),);
    const ln = Number(lng.toFixed(5,),);
    const key = CACHE_KEYS.geoReverse(la, ln,);
    // The point the user chose stays the point (the address is just its label) —
    // also on a cache hit, which may have been stored for a nearby point.
    const atPoint = (p: GeoPlace | null,): GeoPlace | null => (p ? { ...p, lat, lng, } : null);
    const hit = await cache.get<{ place: GeoPlace | null; }>(key,).catch(() => null);
    if (hit) return atPoint(hit.place,);
    const place = await shared(key, async () => {
        const row = await call<NominatimPlace & { error?: string; }>('/reverse', { lat: String(la,), lon: String(ln,), zoom: '18', },);
        const found = row && !row.error ? toPlace(row,) : null;
        await cache.set(key, { place: found, }, found ? TTL_SECONDS : EMPTY_TTL_SECONDS,).catch(() => {},);
        return found;
    },);
    return atPoint(place,);
}
