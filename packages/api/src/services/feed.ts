/**
 * RSS 2.0 feed builder for recent published posts.
 *
 * Pure-ish: `buildFeed()` reads the DB and returns the RSS XML string;
 * `getFeedXml()` adds the Redis cache layer (30-minute TTL) so a heavy
 * aggregator polling every few minutes mostly hits cache, while newly
 * published posts still appear within half an hour without an explicit
 * invalidation hook.
 *
 * The feed surfaces the post's title, link, publication date, author,
 * categories (from `tags`), and a description (excerpt or stripped
 * content). Full content goes in `content:encoded` for readers that
 * render rich HTML; the plain `description` stays a short summary.
 *
 * Lifted out of `routes/feed.ts` so the route handler stays a thin raw
 * XML responder and the generation logic is reusable (CLI, tests).
 */
import { config, } from '../config';
import { query, } from '../db';
import { cache, } from './cache';
import { stripHtml, truncateText, } from './ssr/schema';

const SITE_URL = config.frontendUrl.replace(/\/$/, '',);
const CACHE_KEY = 'feed:rss';
const CACHE_TTL = 1800; // 30 minutes

const FALLBACK_SITE_NAME = 'RW';
const FALLBACK_SITE_DESCRIPTION = 'Independent journalism for the people';

/** Empty-but-valid RSS document. Served on error so aggregators don't
 *  blacklist the URL during a transient DB outage. */
export const EMPTY_FEED_XML =
    '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel></channel></rss>';

interface FeedPost {
    title: string;
    slug: string;
    excerpt: string | null;
    content: string | null;
    author: string | null;
    published_at: string | null;
    updated_at: string;
    tags: string[] | null;
}

interface SiteMeta {
    name: string;
    description: string;
}

function escapeXml(str: string,): string {
    return str
        .replace(/&/g, '&amp;',)
        .replace(/</g, '&lt;',)
        .replace(/>/g, '&gt;',)
        .replace(/"/g, '&quot;',)
        .replace(/'/g, '&apos;',);
}

/** Wrap a string in CDATA so HTML content survives the round-trip
 *  through the XML parser without needing entity-encoding. Strips any
 *  literal `]]>` to avoid breaking the CDATA boundary. */
function cdata(str: string,): string {
    return `<![CDATA[${str.replace(/\]\]>/g, ']]]]><![CDATA[>',)}]]>`;
}

function rfc822Date(date: string | null,): string {
    const d = date ? new Date(date,) : new Date();
    return d.toUTCString();
}

async function getSiteMeta(): Promise<SiteMeta> {
    try {
        const res = await query(
            `SELECT key, value FROM site_settings WHERE key IN ('site_name', 'site_description')`,
        );
        const map: Record<string, unknown> = {};
        for (const row of res.rows) map[row.key] = row.value;
        return {
            name: (map.site_name as string) || FALLBACK_SITE_NAME,
            description: (map.site_description as string) || FALLBACK_SITE_DESCRIPTION,
        };
    } catch {
        return { name: FALLBACK_SITE_NAME, description: FALLBACK_SITE_DESCRIPTION, };
    }
}

/** Build the RSS XML from the database. No caching here — callers
 *  decide whether to cache the result. */
export async function buildFeed(): Promise<string> {
    const site = await getSiteMeta();
    const result = await query<FeedPost>(
        `SELECT p.title, p.slug, p.excerpt, p.content, u.display_name as author,
                p.published_at, p.updated_at, p.tags
         FROM posts p LEFT JOIN users u ON p.author_id = u.id
         WHERE p.status = 'published' AND p.is_private = false
         ORDER BY COALESCE(p.published_at, p.created_at) DESC
         LIMIT 50`,
    );
    const posts = result.rows;

    const lastBuild = posts[0]?.updated_at || new Date().toISOString();

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">\n';
    xml += '  <channel>\n';
    xml += `    <title>${escapeXml(site.name,)}</title>\n`;
    xml += `    <link>${escapeXml(SITE_URL,)}</link>\n`;
    xml += `    <description>${escapeXml(site.description,)}</description>\n`;
    xml += `    <language>en-us</language>\n`;
    xml += `    <lastBuildDate>${rfc822Date(lastBuild,)}</lastBuildDate>\n`;
    // Atom self-link helps validators + makes it explicit which URL
    // is canonical for this feed.
    xml += `    <atom:link href="${escapeXml(`${SITE_URL}/feed.xml`,)}" rel="self" type="application/rss+xml" />\n`;

    for (const post of posts) {
        const url = `${SITE_URL}/posts/${post.slug}`;
        const description = post.excerpt
            || truncateText(stripHtml(post.content || '',), 280,)
            || post.title;
        // Full content goes in the namespaced `content:encoded` field so
        // readers that show full posts (Feedly, NetNewsWire) get rich
        // HTML. Plain `description` stays a short summary so feed lists
        // remain scannable.
        const fullContent = post.content || '';

        xml += '    <item>\n';
        xml += `      <title>${escapeXml(post.title,)}</title>\n`;
        xml += `      <link>${escapeXml(url,)}</link>\n`;
        xml += `      <guid isPermaLink="true">${escapeXml(url,)}</guid>\n`;
        xml += `      <pubDate>${rfc822Date(post.published_at || post.updated_at,)}</pubDate>\n`;
        if (post.author) {
            xml += `      <dc:creator>${escapeXml(post.author,)}</dc:creator>\n`;
        }
        if (Array.isArray(post.tags,)) {
            for (const tag of post.tags) {
                xml += `      <category>${escapeXml(tag,)}</category>\n`;
            }
        }
        xml += `      <description>${cdata(description,)}</description>\n`;
        if (fullContent) {
            xml += `      <content:encoded>${cdata(fullContent,)}</content:encoded>\n`;
        }
        xml += '    </item>\n';
    }

    xml += '  </channel>\n';
    xml += '</rss>';
    return xml;
}

/** Cache-aware feed read. Returns the cached XML if present, otherwise
 *  builds, caches (1800s — public-only data, safe to cache freely),
 *  and returns. */
export async function getFeedXml(): Promise<string> {
    const cached = await cache.get<string>(CACHE_KEY,);
    if (cached) return cached;
    const xml = await buildFeed();
    await cache.set(CACHE_KEY, xml, CACHE_TTL,);
    return xml;
}
