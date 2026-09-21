/**
 * Server-side rendering service.
 *
 * Intercepts HTML requests for public routes, looks up the content in the DB,
 * generates meta tags, and injects them into the index.html template.
 * Cached in Redis per-URL.
 *
 * Future extension: if a pre-rendered static HTML file exists for the URL,
 * serve that directly (marked with TODO below).
 */
import fs from 'fs/promises';
import path from 'path';
import { cache, } from '../cache';
import { logger, } from '../../utils/logger';
import { buildMetaHtml, } from './metaBuilder';
import { getSiteAnalyticsId, getSiteFavicon, getSiteNav, isPublicRoute, resolveRouteMeta, } from './routes';
import { gtagSnippet, isValidGaId, } from '../../utils/gtag';

const CACHE_TTL = 300; // 5 minutes

// Marker in index.html where meta tags should be injected
const META_INJECTION_MARKER = '<!-- SSR_META -->';
// Markers wrapping the in-flow body content. The SSR layer replaces
// everything between START and END with the route-specific body
// string when one is available. When the resolver doesn't produce a
// body (or the route doesn't match anything indexable), the markers
// stay and the default contents (the SPA loading shell) render —
// keeping the UX identical to dev / no-SSR mode.
const BODY_START_MARKER = '<!-- SSR_BODY_START -->';
const BODY_END_MARKER = '<!-- SSR_BODY_END -->';

let htmlTemplate: string | null = null;
let htmlTemplatePath: string | null = null;
let htmlTemplateMtimeMs = 0;
let lastBuildMtimeMs = 0;

/**
 * Drop the rendered-HTML cache when the frontend build changes (or on first
 * request after boot). A deploy replaces `index.html` with new content-hashed
 * asset URLs and removes the old bundles; the Redis `ssr:html:*` cache holds
 * fully-rendered shells that still point at the OLD hashes, so without this a
 * hard refresh serves a shell referencing a deleted main chunk → 500 → the SPA
 * never boots (only the SSR body shows). Runs before the cache lookup so the
 * stale entry is cleared before it can be served; self-heals with NO restart.
 */
async function ensureFreshBuild(distDir: string,): Promise<void> {
    try {
        const stat = await fs.stat(path.join(distDir, 'index.html',),);
        if (stat.mtimeMs === lastBuildMtimeMs) return;
        lastBuildMtimeMs = stat.mtimeMs; // set first so concurrent requests don't double-flush
        await cache.invalidateAllSsrCache();
        logger.info('SSR: frontend build changed — flushed rendered-HTML cache',);
    } catch {
        // stat failed — non-fatal; loadTemplate surfaces a missing template.
    }
}

/**
 * Load and cache the frontend index.html template, reloading when the file
 * changes on disk.
 *
 * The template embeds CONTENT-HASHED asset URLs (index-<hash>.js etc.) that
 * change on every deploy. Caching it purely in memory meant a deploy that
 * replaced index.html (new hashes, old bundles removed) was never picked up
 * until a process restart — so the SSR kept injecting the page body into the
 * STALE shell, which pointed at deleted bundles. A hard refresh then 500s on
 * the missing main chunk and the SPA never boots (only the SSR body shows).
 * Keying the cache on the file's mtime makes a `dist` deploy take effect on the
 * next request; the `stat` is negligible next to the render.
 */
async function loadTemplate(distDir: string,): Promise<string | null> {
    try {
        const templatePath = path.join(distDir, 'index.html',);
        const stat = await fs.stat(templatePath,);
        if (htmlTemplate && htmlTemplatePath === distDir && htmlTemplateMtimeMs === stat.mtimeMs) {
            return htmlTemplate;
        }
        const content = await fs.readFile(templatePath, 'utf-8',);
        htmlTemplate = content;
        htmlTemplatePath = distDir;
        htmlTemplateMtimeMs = stat.mtimeMs;
        logger.info(`SSR: Loaded HTML template from ${templatePath}`,);
        return content;
    } catch (error) {
        logger.warn('SSR: Could not load index.html template', { error: (error as Error).message, },);
        return null;
    }
}

/**
 * Inject meta HTML into the template's <head>.
 *
 * The static template carries a placeholder <title> for the no-SSR/dev case.
 * Our meta block emits the REAL <title>, and the placeholder sits earlier in
 * the head — so both shipped, and browsers/Google honour the FIRST one. The
 * site was consequently branding itself as the template's default in search
 * results. Strip any pre-existing <title> whenever we're supplying one.
 */
function injectMeta(template: string, metaHtml: string,): string {
    const html = metaHtml.includes('<title',)
        ? template.replace(/[ \t]*<title>[\s\S]*?<\/title>\s*\n?/i, '',)
        : template;

    // If the template has the explicit marker, replace it
    if (html.includes(META_INJECTION_MARKER,)) {
        return html.replace(META_INJECTION_MARKER, metaHtml,);
    }
    // Otherwise inject right before </head>
    return html.replace('</head>', `        ${metaHtml}\n    </head>`,);
}

/** Insert an arbitrary HTML snippet just before </head> (once). */
function injectHeadSnippet(html: string, snippet: string,): string {
    if (!snippet || !html.includes('</head>',)) return html;
    return html.replace('</head>', `    ${snippet}\n    </head>`,);
}

/**
 * Inject the route-specific body into the template, replacing the
 * default loading-shell content between the SSR_BODY_* markers. The
 * Solid SPA's `render()` overwrites `#root` on mount, so this body
 * is what bots and JS-disabled visitors see — users with JS see it
 * for at most one frame.
 *
 * If the markers aren't present (older template) or no body was
 * provided (route resolver opted out), this is a no-op.
 */
function injectBody(template: string, bodyHtml: string | undefined,): string {
    if (!bodyHtml) return template;
    const startIdx = template.indexOf(BODY_START_MARKER,);
    const endIdx = template.indexOf(BODY_END_MARKER,);
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return template;
    const before = template.slice(0, startIdx + BODY_START_MARKER.length,);
    const after = template.slice(endIdx,);
    return `${before}\n${bodyHtml}\n      ${after}`;
}

/**
 * Check for a pre-rendered static HTML file for the given path.
 * Returns the file contents if it exists, or null otherwise.
 *
 * TODO: Later we'll generate static HTML for each route during build/publish
 * and serve them from `cache/static-html/{slug}.html`.
 */
async function getStaticHtml(pathname: string,): Promise<string | null> {
    try {
        const safeSlug = pathname.replace(/^\/+|\/+$/g, '',).replace(/\//g, '_',) || 'index';
        const staticPath = path.join(process.cwd(), 'cache/static-html', `${safeSlug}.html`,);
        return await fs.readFile(staticPath, 'utf-8',);
    } catch {
        return null;
    }
}

/**
 * The rendered page plus the status code it must be served with.
 *
 * The status is NOT always 200: a URL that resolves to no content has to
 * answer 404, or the crawler is told a nonexistent page exists and indexes it.
 * Returning only HTML made that unrepresentable.
 */
export interface SsrRender {
    html: string;
    status: number;
}

/**
 * Main SSR entry point: render a public URL with server-side meta tags.
 * Returns the rendered HTML + status, or null if the path should be handled
 * differently (not a public route).
 */
export async function renderPublicRoute(
    pathname: string,
    distDir: string,
): Promise<SsrRender | null> {
    if (!isPublicRoute(pathname,)) return null;

    // 1. Check for pre-rendered static HTML
    const staticHtml = await getStaticHtml(pathname,);
    if (staticHtml) {
        logger.debug(`SSR: Served static HTML for ${pathname}`,);
        return { html: staticHtml, status: 200, };
    }

    // 1b. Drop stale rendered HTML if the frontend build changed since we last
    //     rendered (deploy) — before the cache lookup below can serve it.
    await ensureFreshBuild(distDir,);

    // 2. Check Redis cache
    const cacheKey = cache.CACHE_KEYS.ssrPath(pathname,);
    // Cached as the PAIR, so a 404 stays a 404 when served from cache. Storing
    // only the HTML meant a cache hit resurrected the soft 200.
    const cached = await cache.get<SsrRender | string>(cacheKey,);
    if (cached) {
        logger.debug(`SSR: Cache hit for ${pathname}`,);
        // Tolerate entries written by the previous (string-only) shape.
        return typeof cached === 'string' ? { html: cached, status: 200, } : cached;
    }

    // 3. Load the base template
    const template = await loadTemplate(distDir,);
    if (!template) return null;
    const ok = (html: string,) => ({ html, status: 200, });

    // 4. Resolve content meta for this route
    let meta;
    try {
        meta = await resolveRouteMeta(pathname,);
    } catch (error) {
        logger.error(`SSR: Failed to resolve meta for ${pathname}`, { error, },);
        return ok(template,); // Fall back to plain template
    }

    if (!meta) return ok(template,);

    // 4a. Attach the site favicon (global, same for every route) so the head
    //     builder can emit a <link rel="icon"> for the operator's icon. Set
    //     once here rather than in every per-route meta object.
    try {
        meta.favicon = await getSiteFavicon();
    } catch {
        // Non-fatal — fall back to the template's default favicon.
    }

    // 5. Build and inject meta tags — protect against a malformed meta object
    //    (e.g. unexpected non-string value) so a single bad page can't break SSR
    //    for every other route.
    let metaHtml: string;
    try {
        metaHtml = buildMetaHtml(meta,);
    } catch (error) {
        logger.error(`SSR: buildMetaHtml failed for ${pathname}`, {
            error: (error as Error).message,
        },);
        return ok(template,);
    }
    let html = injectMeta(template, metaHtml,);

    // 5a. Google tag (gtag.js): inject the standard snippet into <head> when the
    //     operator has set an Analytics ID. Public pages only (SSR runs for
    //     public routes), so admin usage isn't tracked. The CSP is extended in
    //     lockstep (services/analyticsCsp → middleware/csp). Non-fatal.
    try {
        const gaId = await getSiteAnalyticsId();
        if (isValidGaId(gaId,)) html = injectHeadSnippet(html, gtagSnippet(gaId,),);
    } catch (error) {
        logger.error(`SSR: analytics injection failed for ${pathname}`, {
            error: (error as Error).message,
        },);
    }

    // 5b. Inject the pre-rendered body, wrapped in the site nav.
    //
    //     The nav is what makes the rest of the site reachable without JS: the
    //     header and footer are SPA-rendered, so before this the SSR HTML of
    //     every page linked to almost nothing and Search Console reported the
    //     other pages as "Discovered — currently not indexed".
    //
    //     Order is header-nav, body, footer-nav, because that is the order a
    //     crawler reads the document in and the article should not be buried
    //     under two link lists.
    //
    //     Failures here are non-fatal — fall back to the default loading-shell
    //     template so the page still serves.
    try {
        let nav = { header: '', footer: '', };
        try {
            nav = await getSiteNav();
        } catch (error) {
            logger.error(`SSR: nav lookup failed for ${pathname}`, {
                error: (error as Error).message,
            },);
        }
        // Nav alone is still worth emitting on a route with no body of its
        // own — the links are the point, and a 404 page that links back into
        // the site is better for both crawlers and people.
        const composed = [nav.header, meta.body, nav.footer,].filter(Boolean,).join('\n',);
        html = injectBody(html, composed || undefined,);
    } catch (error) {
        logger.error(`SSR: injectBody failed for ${pathname}`, {
            error: (error as Error).message,
        },);
    }

    // 6. Cache the rendered HTML
    const result: SsrRender = { html, status: meta.notFound ? 404 : 200, };
    await cache.set(cacheKey, result, CACHE_TTL,);

    logger.debug(`SSR: Rendered and cached ${pathname}`,);
    return result;
}

/** Invalidate a single SSR cache entry */
export async function invalidateSsrCache(pathname: string,): Promise<void> {
    await cache.invalidateSsrCache(pathname,);
}

/** Invalidate all SSR cache entries */
export async function invalidateAllSsrCache(): Promise<void> {
    await cache.invalidateAllSsrCache();
}
