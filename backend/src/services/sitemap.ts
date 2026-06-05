/**
 * Sitemap builder.
 *
 * Pure: takes a config + DB connection (via the shared `query` helper)
 * and returns the sitemap XML string. The HTTP route, the admin
 * regenerate endpoint, and the standalone CLI script all call this
 * single function so the output never drifts between consumers.
 *
 * Cache lifecycle: callers cache the result under `sitemap:xml`.
 * `services/cache.ts` invalidates that key whenever a page, post,
 * campaign, or form is mutated, so the next request rebuilds.
 */
import { config, } from '../config';
import { query, } from '../db';
import { cache, } from './cache';

const CACHE_KEY = 'sitemap:xml';
const CACHE_TTL = 3600; // 1 hour

interface SitemapRow {
    slug: string;
    updated_at: string;
}

const SITE_URL = config.frontendUrl.replace(/\/$/, '',);

function escapeXml(str: string,): string {
    return str
        .replace(/&/g, '&amp;',)
        .replace(/</g, '&lt;',)
        .replace(/>/g, '&gt;',)
        .replace(/"/g, '&quot;',)
        .replace(/'/g, '&apos;',);
}

function formatDate(dateStr: string,): string {
    return new Date(dateStr,).toISOString().split('T',)[0];
}

function urlEntry(loc: string, lastmod?: string, changefreq?: string, priority?: number,): string {
    let entry = `  <url>\n    <loc>${escapeXml(loc,)}</loc>\n`;
    if (lastmod) entry += `    <lastmod>${formatDate(lastmod,)}</lastmod>\n`;
    if (changefreq) entry += `    <changefreq>${changefreq}</changefreq>\n`;
    if (priority !== undefined) entry += `    <priority>${priority.toFixed(1,)}</priority>\n`;
    entry += '  </url>\n';
    return entry;
}

/** Build the full sitemap.xml string from current published content. */
export async function buildSitemap(): Promise<string> {
    const [pagesResult, postsResult, campaignsResult, formsResult,] = await Promise.all([
        query<SitemapRow>(
            `SELECT slug, updated_at FROM pages
             WHERE status = 'published' AND is_private = false AND is_homepage = false
             ORDER BY updated_at DESC`,
        ),
        query<SitemapRow>(
            `SELECT slug, updated_at FROM posts
             WHERE status = 'published' AND is_private = false
             ORDER BY updated_at DESC`,
        ),
        query<SitemapRow>(
            `SELECT slug, updated_at FROM campaigns
             WHERE status = 'active' AND is_published = true
             ORDER BY updated_at DESC`,
        ),
        query<SitemapRow>(
            `SELECT slug, updated_at FROM forms
             WHERE status = 'published'
             ORDER BY updated_at DESC`,
        ),
    ],);

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Static / always-on routes
    xml += urlEntry(`${SITE_URL}/`, undefined, 'daily', 1.0,);
    xml += urlEntry(`${SITE_URL}/donate`, undefined, 'weekly', 0.8,);
    xml += urlEntry(`${SITE_URL}/contact`, undefined, 'monthly', 0.6,);
    xml += urlEntry(`${SITE_URL}/posts`, undefined, 'daily', 0.8,);
    xml += urlEntry(`${SITE_URL}/join`, undefined, 'monthly', 0.7,);

    for (const page of pagesResult.rows) {
        xml += urlEntry(`${SITE_URL}/${page.slug}`, page.updated_at, 'weekly', 0.8,);
    }
    for (const post of postsResult.rows) {
        xml += urlEntry(`${SITE_URL}/posts/${post.slug}`, post.updated_at, 'weekly', 0.7,);
    }
    for (const campaign of campaignsResult.rows) {
        xml += urlEntry(`${SITE_URL}/campaigns/${campaign.slug}`, campaign.updated_at, 'weekly', 0.6,);
    }
    for (const form of formsResult.rows) {
        xml += urlEntry(`${SITE_URL}/forms/${form.slug}`, form.updated_at, 'monthly', 0.5,);
    }

    xml += '</urlset>';
    return xml;
}

/** URL count for the most recent build — handy for the admin
 *  "Regenerate" response so the operator sees how many entries the
 *  fresh sitemap covered. */
export function countSitemapUrls(xml: string,): number {
    return (xml.match(/<url>/g,) || []).length;
}

/** Empty-but-valid urlset, served on error so crawlers don't choke. */
export const EMPTY_SITEMAP_XML =
    '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';

/** Cache-aware sitemap read. Returns cached XML if present, else builds,
 *  caches (3600s — public-only data, safe to cache freely), and returns. */
export async function getSitemapXml(): Promise<string> {
    const cached = await cache.get<string>(CACHE_KEY,);
    if (cached) return cached;
    const xml = await buildSitemap();
    await cache.set(CACHE_KEY, xml, CACHE_TTL,);
    return xml;
}

export interface SitemapRegenerateResult {
    urlCount: number;
    bytes: number;
    regeneratedAt: string;
}

/** Admin: drop the cached sitemap, rebuild now, re-cache, and report
 *  the fresh URL count / byte size. */
export async function regenerateSitemap(): Promise<SitemapRegenerateResult> {
    await cache.invalidateSitemapCache();
    const xml = await buildSitemap();
    await cache.set(CACHE_KEY, xml, CACHE_TTL,);
    return {
        urlCount: countSitemapUrls(xml,),
        bytes: xml.length,
        regeneratedAt: new Date().toISOString(),
    };
}
