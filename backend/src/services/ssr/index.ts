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

    // 5. Build and inject meta tags
    const metaHtml = buildMetaHtml(meta,);
    const html = injectMeta(template, metaHtml,);

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
