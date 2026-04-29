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
import { isPublicRoute, resolveRouteMeta, } from './routes';

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

/** Load and cache the frontend index.html template */
async function loadTemplate(distDir: string,): Promise<string | null> {
    if (htmlTemplate && htmlTemplatePath === distDir) return htmlTemplate;

    try {
        const templatePath = path.join(distDir, 'index.html',);
        const content = await fs.readFile(templatePath, 'utf-8',);
        htmlTemplate = content;
        htmlTemplatePath = distDir;
        logger.info(`SSR: Loaded HTML template from ${templatePath}`,);
        return content;
    } catch (error) {
        logger.warn('SSR: Could not load index.html template', { error: (error as Error).message, },);
        return null;
    }
}

/** Inject meta HTML into the template's <head> */
function injectMeta(template: string, metaHtml: string,): string {
    // If the template has the explicit marker, replace it
    if (template.includes(META_INJECTION_MARKER,)) {
        return template.replace(META_INJECTION_MARKER, metaHtml,);
    }
    // Otherwise inject right before </head>
    return template.replace('</head>', `        ${metaHtml}\n    </head>`,);
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
 * Main SSR entry point: render a public URL with server-side meta tags.
 * Returns the full HTML response or null if the path should be handled differently.
 */
export async function renderPublicRoute(pathname: string, distDir: string,): Promise<string | null> {
    if (!isPublicRoute(pathname,)) return null;

    // 1. Check for pre-rendered static HTML
    const staticHtml = await getStaticHtml(pathname,);
    if (staticHtml) {
        logger.debug(`SSR: Served static HTML for ${pathname}`,);
        return staticHtml;
    }

    // 2. Check Redis cache
    const cacheKey = `ssr:html:${pathname}`;
    const cached = await cache.get<string>(cacheKey,);
    if (cached) {
        logger.debug(`SSR: Cache hit for ${pathname}`,);
        return cached;
    }

    // 3. Load the base template
    const template = await loadTemplate(distDir,);
    if (!template) return null;

    // 4. Resolve content meta for this route
    let meta;
    try {
        meta = await resolveRouteMeta(pathname,);
    } catch (error) {
        logger.error(`SSR: Failed to resolve meta for ${pathname}`, { error, },);
        return template; // Fall back to plain template
    }

    if (!meta) return template;

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
        return template;
    }
    let html = injectMeta(template, metaHtml,);

    // 5a. Inject the pre-rendered body when the resolver produced one.
    //     Failures here are non-fatal — fall back to the default
    //     loading-shell template so the page still serves.
    try {
        html = injectBody(html, meta.body,);
    } catch (error) {
        logger.error(`SSR: injectBody failed for ${pathname}`, {
            error: (error as Error).message,
        },);
    }

    // 6. Cache the rendered HTML
    await cache.set(cacheKey, html, CACHE_TTL,);

    logger.debug(`SSR: Rendered and cached ${pathname}`,);
    return html;
}

/** Invalidate a single SSR cache entry */
export async function invalidateSsrCache(pathname: string,): Promise<void> {
    await cache.del(`ssr:html:${pathname}`,);
}

/** Invalidate all SSR cache entries */
export async function invalidateAllSsrCache(): Promise<void> {
    await cache.delPattern('ssr:html:*',);
}

/** Reset the cached HTML template (e.g. after rebuild) */
export function resetTemplate(): void {
    htmlTemplate = null;
    htmlTemplatePath = null;
}
