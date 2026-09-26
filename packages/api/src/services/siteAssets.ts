/**
 * The site's logo and favicon, served from the site's OWN origin at
 * `/logo.png` and `/favicon.ico`.
 *
 * Settings → Site Branding stores each as a media URL, which on a CDN-backed
 * install is another host (`cdn.surgemedia.us/uploads/…`). Some consumers
 * will only take an image from the domain they are configured for — Google
 * Workspace's email footer logo refused the CDN URL — and `/favicon.ico` is
 * the path browsers and crawlers ask for whether or not a page links it. It
 * answered with the SPA's HTML page, so it was simply broken.
 *
 * Both are resolved from the CURRENT branding on every miss, so editing or
 * clearing the logo in the admin changes what these URLs return; there is no
 * copy on disk to fall out of step. Bytes are memoised per source URL, so a new
 * logo is a new cache key and a stale one can never be served for it.
 */
import { createHash, } from 'node:crypto';
import { readFile, } from 'node:fs/promises';
import path from 'node:path';
import { config, } from '../config';
import { logger, } from '../utils/logger';
import { getPublicSettings, } from './settings';

export type SiteAssetKind = 'logo' | 'favicon';

export interface SiteAsset {
    body: Buffer;
    contentType: string;
    etag: string;
}

/** Re-check the upstream at most this often, even for an unchanged URL. */
const MEMO_TTL_MS = 10 * 60 * 1000;
/** Refuse anything bigger — this is a logo, and it is proxied. */
const MAX_BYTES = 5 * 1024 * 1024;

const memo = new Map<string, { asset: SiteAsset; at: number; }>();

/** The configured source URL for a kind, or undefined when none is set. */
async function sourceUrl(kind: SiteAssetKind,): Promise<string | undefined> {
    const s = await getPublicSettings();
    const url = (kind === 'logo' ? s.logo : s.favicon)?.trim();
    return url || undefined;
}

/** Content type from a file extension, for a local upload read from disk. */
function typeFromPath(p: string,): string {
    const ext = path.extname(p,).toLowerCase();
    return ({
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
    } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

/**
 * Read the source bytes.
 *
 * Only two shapes are accepted: an absolute http(s) URL (a CDN / S3 object),
 * or a site-relative `/uploads/…` path read straight from disk. Anything else
 * — notably a relative path to `/logo.png` itself — is refused, so a
 * misconfigured branding row cannot make this route fetch itself in a loop.
 */
async function readSource(url: string,): Promise<{ body: Buffer; contentType: string; }> {
    if (url.startsWith('/uploads/',)) {
        const root = path.resolve(process.cwd(), config.upload.dir,);
        const file = path.resolve(root, url.slice('/uploads/'.length,),);
        // Path traversal guard: the resolved file must stay under the upload dir.
        if (!file.startsWith(root + path.sep,)) throw new Error('logo path escapes the upload directory',);
        return { body: await readFile(file,), contentType: typeFromPath(file,), };
    }
    if (!/^https?:\/\//i.test(url,)) throw new Error(`unsupported branding URL: ${url}`,);

    const res = await fetch(url, { signal: AbortSignal.timeout(10_000,), },);
    if (!res.ok) throw new Error(`upstream ${res.status} for ${url}`,);
    const body = Buffer.from(await res.arrayBuffer(),);
    if (body.length > MAX_BYTES) throw new Error(`branding image too large (${body.length} bytes)`,);
    const contentType = res.headers.get('content-type',)?.split(';',)[0]?.trim() ||
        typeFromPath(new URL(url,).pathname,);
    return { body, contentType, };
}

/**
 * The logo as PNG — `/logo.png` must honour its extension, because the
 * consumers that need this URL (mail clients, Google's footer) will not render
 * an SVG. A PNG source passes through untouched; anything else is converted.
 */
async function asPng(src: { body: Buffer; contentType: string; },): Promise<Buffer> {
    if (src.contentType === 'image/png') return src.body;
    const sharp = (await import('sharp')).default;
    // `density` rasterises an SVG crisply rather than at 72 dpi.
    return sharp(src.body, { density: 300, },).png().toBuffer();
}

export async function getSiteAsset(kind: SiteAssetKind,): Promise<SiteAsset | null> {
    const url = await sourceUrl(kind,);
    if (!url) return null;

    const key = `${kind}:${url}`;
    const hit = memo.get(key,);
    if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.asset;

    try {
        const src = await readSource(url,);
        const body = kind === 'logo' ? await asPng(src,) : src.body;
        const contentType = kind === 'logo' ? 'image/png' : src.contentType;
        const asset: SiteAsset = {
            body,
            contentType,
            etag: `"${createHash('sha1',).update(body,).digest('hex',).slice(0, 20,)}"`,
        };
        // Drop any entry for a previous URL of the same kind — it can never be
        // asked for again once the branding points elsewhere.
        for (const k of memo.keys()) if (k.startsWith(`${kind}:`,)) memo.delete(k,);
        memo.set(key, { asset, at: Date.now(), },);
        return asset;
    } catch (e) {
        logger.warn('site asset unavailable', { kind, url, error: (e as Error).message, },);
        // A transient upstream failure keeps serving the last good copy.
        return hit?.asset ?? null;
    }
}

/** Icon sizes served at `/apple-touch-icon.png` and `/icons/icon-<n>x<n>.png`. */
export const SQUARE_ICON_SIZES = [180, 192, 512,] as const;
export type SquareIconSize = typeof SQUARE_ICON_SIZES[number];

/**
 * A square PNG icon at `size`, generated from the branding.
 *
 * The favicon is the right source (it is designed to be square); the logo is
 * the fallback, centred on white so a wide wordmark is not cropped. These
 * files were referenced by the page head, the web manifest and every link
 * preview's image — and did not exist, so each answered with the HTML shell.
 */
export async function getSquareIcon(size: SquareIconSize,): Promise<SiteAsset | null> {
    const key = `icon${size}`;
    const source = (await getSiteAsset('favicon',)) ?? (await getSiteAsset('logo',));
    if (!source) return null;

    const memoKey = `${key}:${source.etag}`;
    const hit = memo.get(memoKey,);
    if (hit) return hit.asset;
    try {
        const sharp = (await import('sharp')).default;
        const body = await sharp(source.body, { density: 300, },)
            .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1, }, },)
            .flatten({ background: '#ffffff', },)
            .png()
            .toBuffer();
        const asset: SiteAsset = {
            body,
            contentType: 'image/png',
            etag: `"${createHash('sha1',).update(body,).digest('hex',).slice(0, 20,)}"`,
        };
        for (const k of memo.keys()) if (k.startsWith(`${key}:`,)) memo.delete(k,);
        memo.set(memoKey, { asset, at: Date.now(), },);
        return asset;
    } catch (e) {
        logger.warn('site icon generation failed', { size, error: (e as Error).message, },);
        return null;
    }
}

/**
 * The web app manifest, from Site Settings.
 *
 * It was a build-time file naming the product ("SiteSurge") rather than the
 * site, and some link previews and every "Add to Home Screen" read it.
 */
export async function buildWebManifest(): Promise<Record<string, unknown>> {
    const s = await getPublicSettings();
    const name = s.siteName || 'Site';
    const primary = s.appearance?.primaryColor;
    const background = s.appearance?.backgroundColor;
    // A swatch reference means nothing outside the site's own CSS.
    const hex = (v: string | undefined, fallback: string,) => (v && /^#[0-9a-f]{3,8}$/i.test(v,) ? v : fallback);
    return {
        name,
        short_name: name.length > 12 ? name.split(/\s+/,)[0] : name,
        description: s.siteDescription || s.siteTagline || '',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        lang: 'en',
        theme_color: hex(primary, '#ffffff',),
        background_color: hex(background, '#ffffff',),
        icons: [
            { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png', },
            { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', },
            { src: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable', },
        ],
    };
}

/**
 * Tell Cloudflare to forget the edge copies, after a branding change.
 *
 * Optional: needs `CLOUDFLARE_ZONE_ID` + a token with Cache Purge. Without
 * them this is a no-op and the edge refreshes on its own within the 5-minute
 * TTL the route sets. Never throws — a failed purge must not fail a save.
 */
export async function purgeSiteAssetsFromEdge(): Promise<void> {
    memo.clear();
    const { zoneId, purgeToken, } = config.cloudflare;
    if (!zoneId || !purgeToken) return;
    const base = config.frontendUrl.replace(/\/+$/, '',);
    try {
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${purgeToken}`, 'Content-Type': 'application/json', },
            body: JSON.stringify({
                files: [
                    `${base}/logo.png`,
                    `${base}/favicon.ico`,
                    `${base}/apple-touch-icon.png`,
                    `${base}/icons/icon-192x192.png`,
                    `${base}/icons/icon-512x512.png`,
                    `${base}/manifest.webmanifest`,
                ],
            },),
            signal: AbortSignal.timeout(10_000,),
        },);
        if (!res.ok) logger.warn('Cloudflare purge failed', { status: res.status, body: await res.text(), },);
    } catch (e) {
        logger.warn('Cloudflare purge failed', { error: (e as Error).message, },);
    }
}

/** Test-only: forget memoised bytes. */
export function __resetSiteAssetMemo(): void {
    memo.clear();
}
