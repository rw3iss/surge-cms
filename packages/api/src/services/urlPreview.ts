/**
 * SSRF-guarded link unfurl for the admin URL-Link block editor.
 *
 * The block editor lets an admin paste an arbitrary URL and pull its
 * OpenGraph/basic meta server-side. Because the server fetches an
 * operator-supplied URL, this is a classic SSRF vector — so before ANY
 * network call we:
 *   1. accept only http/https,
 *   2. resolve the hostname with `dns.lookup` and reject if it maps to a
 *      private / loopback / link-local / reserved IP (incl. the cloud
 *      metadata endpoint 169.254.169.254),
 *   3. reject the literal `localhost`.
 *
 * The fetch itself is bounded: 5s timeout, 512KB response cap, a sane
 * User-Agent, and `redirect: 'manual'` — we do NOT auto-follow redirects,
 * which closes the redirect-to-private-IP bypass (a followed 3xx could
 * point back at an internal host that the initial guard never saw). A
 * redirect response simply yields an empty preview.
 *
 * The HTML is parsed with a bounded set of regexes rather than a DOM
 * parser: the API package ships no HTML-parser dependency, and the parse
 * target here is narrow (a handful of <meta>/<title> tags in the document
 * head), so a careful regex extraction is adequate and dependency-free.
 */
import dns from 'node:dns';
import { promisify, } from 'node:util';
import type { UtilsUrlPreviewResponse, } from '@sitesurge/types';
import { ValidationError, } from '../core/errors';
import { logger, } from '../utils/logger';

const lookup = promisify(dns.lookup,);

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 512 * 1024; // 512KB
const USER_AGENT = 'SiteSurgeBot/1.0 (+link-preview)';

/**
 * True if `ip` is a private, loopback, link-local, or otherwise reserved
 * address that a public fetch must never target. Covers both IPv4 and the
 * common IPv6 forms (loopback, unique-local fc00::/7, link-local fe80::/10,
 * and IPv4-mapped ::ffff:a.b.c.d — unwrapped and re-checked as IPv4).
 */
export function isPrivateIp(ip: string,): boolean {
    const addr = ip.toLowerCase();

    // IPv6.
    if (addr.includes(':',)) {
        if (addr === '::1' || addr === '::') return true;
        if (addr.startsWith('fc',) || addr.startsWith('fd',)) return true; // fc00::/7 unique-local
        if (addr.startsWith('fe8',) || addr.startsWith('fe9',) || addr.startsWith('fea',) || addr.startsWith('feb',)) {
            return true; // fe80::/10 link-local
        }
        // IPv4-mapped IPv6 (::ffff:a.b.c.d) → re-check the embedded IPv4.
        const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/,);
        if (mapped) return isPrivateIp(mapped[1],);
        return false;
    }

    // IPv4.
    const parts = addr.split('.',).map((p,) => parseInt(p, 10,));
    if (parts.length !== 4 || parts.some((n,) => Number.isNaN(n,) || n < 0 || n > 255)) {
        return true; // malformed → refuse
    }
    const [a, b,] = parts;
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (+ metadata 169.254.169.254)
    if (a === 0) return true; // 0.0.0.0/8
    if (a >= 224) return true; // multicast / reserved
    return false;
}

/** Validate scheme + resolve the host and reject private targets. Throws
 *  a ValidationError ('URL not allowed.') on any failure. */
async function assertPublicUrl(rawUrl: string,): Promise<URL> {
    let parsed: URL;
    try {
        parsed = new URL(rawUrl,);
    } catch {
        throw new ValidationError('URL not allowed.',);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ValidationError('URL not allowed.',);
    }

    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost',)) {
        throw new ValidationError('URL not allowed.',);
    }

    // Resolve ALL addresses and reject if ANY is private (a hostname can
    // resolve to multiple records; a single public one must not launder a
    // private sibling).
    let records: Array<{ address: string; }>;
    try {
        records = await lookup(host, { all: true, },);
    } catch {
        throw new ValidationError('URL not allowed.',);
    }
    if (records.length === 0 || records.some((r,) => isPrivateIp(r.address,))) {
        throw new ValidationError('URL not allowed.',);
    }

    return parsed;
}

/** Decode common HTML entities in an extracted attribute value. */
function decodeEntities(s: string,): string {
    return s
        .replace(/&amp;/g, '&',)
        .replace(/&lt;/g, '<',)
        .replace(/&gt;/g, '>',)
        .replace(/&quot;/g, '"',)
        .replace(/&#39;/g, '\'',)
        .replace(/&#x27;/gi, '\'',)
        .trim();
}

/** Pull a `<meta property|name="prop" content="...">` value (attribute
 *  order agnostic). Returns undefined when absent. */
function metaContent(html: string, prop: string,): string | undefined {
    const escaped = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&',);
    // content-before-property and property-before-content both handled.
    const patterns = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i',),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i',),
    ];
    for (const re of patterns) {
        const m = html.match(re,);
        if (m && m[1]) return decodeEntities(m[1],);
    }
    return undefined;
}

/** Parse OpenGraph / twitter / basic meta out of an HTML document head. */
export function parsePreview(html: string,): UtilsUrlPreviewResponse {
    const titleTag = html.match(/<title[^>]*>([^<]*)<\/title>/i,);
    const title = metaContent(html, 'og:title',)
        ?? metaContent(html, 'twitter:title',)
        ?? (titleTag ? decodeEntities(titleTag[1],) : undefined);

    const description = metaContent(html, 'og:description',)
        ?? metaContent(html, 'twitter:description',)
        ?? metaContent(html, 'description',);

    const image = metaContent(html, 'og:image',)
        ?? metaContent(html, 'twitter:image',);

    const siteName = metaContent(html, 'og:site_name',);

    const out: UtilsUrlPreviewResponse = {};
    if (title) out.title = title;
    if (description) out.description = description;
    if (image) out.image = image;
    if (siteName) out.siteName = siteName;
    return out;
}

/** Fetch the page (bounded) and return the parsed preview. Empty object on
 *  a non-2xx / redirect / oversized / non-HTML response. */
export async function fetchUrlPreview(rawUrl: string,): Promise<UtilsUrlPreviewResponse> {
    const url = await assertPublicUrl(rawUrl,);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS,);

    let response: Response;
    try {
        response = await fetch(url.toString(), {
            method: 'GET',
            redirect: 'manual', // do NOT follow — closes redirect-to-private bypass
            signal: controller.signal,
            headers: {
                'User-Agent': USER_AGENT,
                Accept: 'text/html,application/xhtml+xml',
            },
        },);
    } catch (err) {
        clearTimeout(timer,);
        logger.warn('url-preview fetch failed', { url: url.toString(), error: err, },);
        return {};
    }

    try {
        // `redirect: 'manual'` surfaces 3xx as an opaque-redirect response
        // (status 0) or a real 3xx — either way, only accept 2xx bodies.
        if (response.status < 200 || response.status >= 300) return {};

        const contentType = response.headers.get('content-type',) || '';
        if (!contentType.includes('html',)) return {};

        // Read up to MAX_BYTES then stop; enough to cover the <head>.
        const reader = response.body?.getReader();
        if (!reader) return {};

        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
            const { done, value, } = await reader.read();
            if (done) break;
            if (value) {
                chunks.push(value,);
                total += value.length;
                if (total >= MAX_BYTES) {
                    await reader.cancel();
                    break;
                }
            }
        }
        const html = Buffer.concat(chunks.map((c,) => Buffer.from(c,)),).toString('utf8',);
        return parsePreview(html,);
    } finally {
        clearTimeout(timer,);
    }
}
