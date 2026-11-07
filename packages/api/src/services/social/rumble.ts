/**
 * Rumble I/O — public channel pages (feed sync + analytics) and the owner's
 * Live Stream API. Parsing is pure, in rumbleParse.ts.
 *
 * Polite by design: one request at a time with a gap between pages, a
 * timeout per request, at most MAX_PAGES pages per read, never /api/ or /l/
 * (robots.txt). Redirects are followed by hand so every hop is checked to
 * stay on rumble.com (`/c/Name` 301s to the lowercase name).
 */
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import type { FetchedPost, } from './types';
import {
    canonicalChannelUrl,
    channelCandidates,
    channelInfoFrom,
    mapLiveApi,
    parseChannelInput,
    parseVideosPage,
    publishedAtOf,
    redactLiveApiUrl,
    RUMBLE_HOSTS,
    type RumbleChannelInfo,
    type RumbleLiveData,
    rumbleFetchedPost,
    type RumbleVideoItem,
    validateLiveApiUrl,
    videosPageUrl,
} from './rumbleParse';

const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_REDIRECTS = 4;
/** Gap between two page requests. */
const PAGE_GAP_MS = 1_500;
export const MAX_PAGES = 4;
export const PAGE_SIZE = 25;

const sleep = (ms: number,) => new Promise((r,) => setTimeout(r, ms,));

export class RumbleFetchError extends Error {
    constructor(message: string, readonly status: number,) {
        super(message,);
    }
}

/**
 * Rumble's own mirror host. rumble.com sits behind a Cloudflare challenge that
 * answers datacenter IPs (our servers) with a 403 "Just a moment…" page; the
 * same pages on wn0.rumble.com are served without it (checked 2026-11-07).
 */
const MIRROR_HOST = 'wn0.rumble.com';
const FETCH_HOSTS = new Set([...RUMBLE_HOSTS, MIRROR_HOST,],);

function onRumble(url: string,): boolean {
    try {
        const u = new URL(url,);
        return u.protocol === 'https:' && FETCH_HOSTS.has(u.hostname.toLowerCase(),);
    } catch {
        return false;
    }
}

async function readCapped(res: Response,): Promise<string> {
    const len = Number(res.headers.get('content-length',),);
    if (Number.isFinite(len,) && len > MAX_BYTES) throw new RumbleFetchError('Rumble answered with an unexpectedly large page', res.status,);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new RumbleFetchError('Rumble answered with an unexpectedly large page', res.status,);
    return text;
}

/** A Cloudflare challenge page (403 "Just a moment…"), not a real refusal. */
const isChallenge = (e: unknown,) => e instanceof RumbleFetchError && (e.status === 403 || e.status === 503);

/**
 * GET a rumble.com page; returns the final URL + body. A Cloudflare challenge on
 * rumble.com is retried once on the mirror host (same path). The returned URL
 * is always on rumble.com, so canonical channel URLs never point at the mirror.
 */
async function getPage(url: string,): Promise<{ url: string; html: string; }> {
    try {
        return await fetchPage(url,);
    } catch (e) {
        const u = new URL(url,);
        if (!isChallenge(e,) || u.hostname === MIRROR_HOST) throw e;
        u.hostname = MIRROR_HOST;
        const page = await fetchPage(u.toString(),);
        const back = new URL(page.url,);
        if (back.hostname === MIRROR_HOST) back.hostname = 'rumble.com';
        return { url: back.toString(), html: page.html, };
    }
}

/** One fetch with hand-followed redirects; every hop must stay on a Rumble host. */
async function fetchPage(url: string,): Promise<{ url: string; html: string; }> {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        if (!onRumble(current,)) throw new RumbleFetchError('Rumble redirected off rumble.com', 0,);
        let res: Response;
        try {
            res = await fetch(current, {
                redirect: 'manual',
                headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9', },
                signal: AbortSignal.timeout(TIMEOUT_MS,),
            },);
        } catch (e) {
            const timedOut = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
            throw new RumbleFetchError(timedOut ? `Rumble did not answer within ${TIMEOUT_MS / 1000} s` : `Rumble request failed: ${(e as Error)?.message || 'network error'}`, 0,);
        }
        if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('location',);
            if (!loc) throw new RumbleFetchError(`Rumble answered HTTP ${res.status} without a location`, res.status,);
            current = new URL(loc, current,).toString();
            continue;
        }
        if (!res.ok) throw new RumbleFetchError(res.status === 404 ? 'Rumble has no such channel page (404)' : `Rumble answered HTTP ${res.status}`, res.status,);
        return { url: current, html: await readCapped(res,), };
    }
    throw new RumbleFetchError('Rumble redirected too many times', 0,);
}

export interface ResolvedChannel {
    channelUrl: string;
    info: RumbleChannelInfo | null;
    items: RumbleVideoItem[];
}

/**
 * Resolve what the operator typed (URL, @name or name) to the canonical
 * `https://rumble.com/c/<name>` (or /user/<name>) by loading its first videos
 * page. Null when no candidate is a readable channel page.
 */
export async function resolveRumbleChannel(input: string,): Promise<ResolvedChannel | null> {
    const ref = parseChannelInput(input,);
    if (!ref) return null;
    for (const base of channelCandidates(ref,)) {
        try {
            const page = await getPage(videosPageUrl(base, 1,),);
            const parsed = parseVideosPage(page.html,);
            if (parsed.problem) continue;
            const channelUrl = canonicalChannelUrl(page.url,) ?? base;
            return { channelUrl, info: channelInfoFrom(parsed.items, channelUrl,), items: parsed.items, };
        } catch (e) {
            if (!(e instanceof RumbleFetchError) || e.status !== 404) {
                logger.warn('rumble: channel lookup failed', { candidate: base, error: (e as Error).message, },);
            }
        }
    }
    return null;
}

export interface ChannelVideos {
    channelUrl: string;
    info: RumbleChannelInfo | null;
    items: RumbleVideoItem[];
    pagesRead: number;
    /** Format problems / page failures (the read still returns what it got). */
    warnings: string[];
}

/**
 * Read a channel's newest videos, page by page (25 each), one request at a
 * time. Stops at `maxItems`, at `maxPages`, at the last page, or — once at
 * least `minItems` are in — when a page reaches videos older than `olderThan`.
 */
export async function listChannelVideos(
    channelUrl: string,
    opts: { maxItems?: number; maxPages?: number; minItems?: number; olderThan?: number; } = {},
): Promise<ChannelVideos> {
    const base = canonicalChannelUrl(channelUrl,);
    if (!base) throw new RumbleFetchError('The saved Rumble channel URL is not a rumble.com channel — fix it in Social → Configuration → Rumble.', 0,);
    const maxPages = Math.min(Math.max(opts.maxPages ?? MAX_PAGES, 1,), MAX_PAGES,);
    const maxItems = opts.maxItems ?? maxPages * PAGE_SIZE;
    const out: ChannelVideos = { channelUrl: base, info: null, items: [], pagesRead: 0, warnings: [], };
    const seen = new Set<string>();
    for (let page = 1; page <= maxPages && out.items.length < maxItems; page++) {
        if (page > 1) await sleep(PAGE_GAP_MS,);
        let parsed;
        try {
            const res = await getPage(videosPageUrl(base, page,),);
            parsed = parseVideosPage(res.html,);
        } catch (e) {
            if (page === 1) throw e;
            out.warnings.push(`Rumble page ${page}: ${(e as Error).message}`,);
            break;
        }
        out.pagesRead++;
        if (parsed.problem) {
            if (page === 1) throw new RumbleFetchError(`Rumble: ${parsed.problem}.`, 0,);
            out.warnings.push(`Rumble page ${page}: ${parsed.problem}.`,);
            break;
        }
        if (page === 1) out.info = channelInfoFrom(parsed.items, base,);
        let older = false;
        for (const item of parsed.items) {
            const id = String(item.id,);
            if (seen.has(id,)) continue;
            seen.add(id,);
            out.items.push(item,);
            const t = Date.parse(publishedAtOf(item,) ?? '',);
            if (opts.olderThan != null && Number.isFinite(t,) && t < opts.olderThan) older = true;
            if (out.items.length >= maxItems) break;
        }
        if (!parsed.items.length || page >= parsed.lastPage) break;
        if (older && out.items.length >= (opts.minItems ?? 0)) break;
    }
    return out;
}

async function rumbleConnection(): Promise<{ credentials: Record<string, unknown>; } | null> {
    const r = await query<{ credentials: Record<string, unknown> | null; }>(
        `SELECT credentials FROM social_connections WHERE provider::text = 'rumble'`,
    ).catch(() => ({ rows: [] as Array<{ credentials: Record<string, unknown> | null; }>, }));
    return r.rows[0] ? { credentials: r.rows[0].credentials ?? {}, } : null;
}

/** Feed fetcher (social.ts PROVIDERS): the channel's newest videos. */
export async function fetchRumbleVideos(maxResults = 10,): Promise<FetchedPost[]> {
    const conn = await rumbleConnection();
    const channelUrl = String(conn?.credentials.channelUrl ?? '',);
    if (!channelUrl) return [];
    try {
        const n = Math.min(Math.max(maxResults, 1,), MAX_PAGES * PAGE_SIZE,);
        const res = await listChannelVideos(channelUrl, { maxItems: n, maxPages: Math.ceil(n / PAGE_SIZE,), },);
        for (const w of res.warnings) logger.warn('rumble: feed sync', { warning: w, },);
        return res.items.map(rumbleFetchedPost,);
    } catch (e) {
        logger.error('Error fetching Rumble videos', { error: (e as Error).message, },);
        return [];
    }
}

/** GET the owner's Live Stream API (the URL is a secret: never logged, redacted from errors). */
export async function fetchLiveApi(rawUrl: string,): Promise<RumbleLiveData> {
    const v = validateLiveApiUrl(rawUrl,);
    if (!v.ok) throw new RumbleFetchError(v.error, 0,);
    let res: Response;
    try {
        res = await fetch(v.url, {
            redirect: 'manual',
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', },
            signal: AbortSignal.timeout(TIMEOUT_MS,),
        },);
    } catch (e) {
        const timedOut = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
        throw new RumbleFetchError(
            timedOut ? `the Live Stream API did not answer within ${TIMEOUT_MS / 1000} s` : `Live Stream API request failed: ${redactLiveApiUrl((e as Error)?.message || 'network error', v.url,)}`,
            0,
        );
    }
    if (res.status >= 300 && res.status < 400) throw new RumbleFetchError(`the Live Stream API redirected (HTTP ${res.status}) — the key may be revoked; create a new URL at rumble.com/account/livestream-api.`, res.status,);
    if (res.status === 401 || res.status === 403 || res.status === 404) {
        throw new RumbleFetchError(`the Live Stream API refused the key (HTTP ${res.status}) — create a new URL at rumble.com/account/livestream-api.`, res.status,);
    }
    if (!res.ok) throw new RumbleFetchError(`the Live Stream API answered HTTP ${res.status}`, res.status,);
    let json: unknown;
    try {
        json = JSON.parse(await readCapped(res,),);
    } catch (e) {
        if (e instanceof RumbleFetchError) throw e;
        throw new RumbleFetchError('the Live Stream API did not answer with JSON (Rumble may have changed it)', res.status,);
    }
    const data = mapLiveApi(json,);
    if (!data) throw new RumbleFetchError('the Live Stream API answer has an unexpected shape (Rumble may have changed it)', res.status,);
    return data;
}
