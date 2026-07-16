/**
 * Route resolver for SSR meta generation.
 * Matches URLs to content types and builds the appropriate meta tags.
 */
import { config, } from '../../config';
import { query, } from '../../db';
import { mapRow, } from '../../utils/mapRow';
import {
    buildGenericBody,
    buildPageBody,
    buildPostBody,
    buildPostListBody,
} from './bodyBuilder';
import type { MetaTags, } from './metaBuilder';
import {
    buildArticleSchema,
    buildBreadcrumbSchema,
    buildCollectionPageSchema,
    buildDonationSchema,
    buildOrganizationSchema,
    buildWebPageSchema,
    stripHtml,
    truncateText,
} from './schema';

const FALLBACK_SITE_NAME = 'RW';
const FALLBACK_SITE_DESCRIPTION = 'Independent journalism for the people';

interface SiteMeta {
    name: string;
    description: string;
    logo?: string;
    favicon?: string;
}

let siteMetaCache: SiteMeta | null = null;
let siteMetaCacheAt = 0;
const SITE_META_TTL_MS = 60 * 1000;

async function getSiteMeta(): Promise<SiteMeta> {
    const now = Date.now();
    if (siteMetaCache && now - siteMetaCacheAt < SITE_META_TTL_MS) {
        return siteMetaCache;
    }
    try {
        const res = await query(
            `SELECT key, value FROM site_settings WHERE key IN ('site_name', 'site_description', 'logo', 'favicon', 'site_branding')`,
        );
        const map: Record<string, unknown> = {};
        for (const row of res.rows) map[row.key] = row.value;
        // Favicon lives inside the `site_branding` JSON (favicon.url); the
        // legacy top-level `favicon` key is a fallback. Mirrors the resolution
        // in services/settings.ts getPublicSettings().
        const branding = map.site_branding as { favicon?: { url?: string; }; } | undefined;
        const favicon = branding?.favicon?.url || (map.favicon as string | undefined) || undefined;
        siteMetaCache = {
            name: (map.site_name as string) || FALLBACK_SITE_NAME,
            description: (map.site_description as string) || FALLBACK_SITE_DESCRIPTION,
            logo: (map.logo as string) || undefined,
            favicon,
        };
    } catch {
        siteMetaCache = {
            name: FALLBACK_SITE_NAME,
            description: FALLBACK_SITE_DESCRIPTION,
        };
    }
    siteMetaCacheAt = now;
    return siteMetaCache;
}

/** The configured site favicon URL (or undefined). Used by the SSR head
 *  injector so the operator's favicon renders on first paint / for bots. */
export async function getSiteFavicon(): Promise<string | undefined> {
    return (await getSiteMeta()).favicon;
}

/** Manually clear the site meta cache — call from settings update handlers. */
export function invalidateSiteMetaCache(): void {
    siteMetaCache = null;
    siteMetaCacheAt = 0;
}

function siteUrl(): string {
    return config.frontendUrl.replace(/\/$/, '',);
}

function publisherLogo(site: SiteMeta,): string {
    return site.logo || `${siteUrl()}/icons/icon-512x512.png`;
}

/**
 * Resolve a URL path to its meta tags by looking up the content in the DB.
 * Returns null if the path is not a known public route (let the SPA handle it).
 */
export async function resolveRouteMeta(pathname: string,): Promise<MetaTags | null> {
    const path = pathname.split('?',)[0].replace(/\/+$/, '',) || '/';
    const url = `${siteUrl()}${path === '/' ? '' : path}`;
    const site = await getSiteMeta();
    const SITE_NAME = site.name;
    const SITE_DESCRIPTION = site.description;
    const logo = publisherLogo(site,);

    // ─── Home ───
    if (path === '/' || path === '') {
        return {
            title: 'Home',
            description: SITE_DESCRIPTION ||
                'Independent, community-focused journalism covering the stories that matter.',
            canonical: url,
            type: 'website',
            image: logo,
            siteName: SITE_NAME,
            aeoSummary:
                `${SITE_NAME} — ${SITE_DESCRIPTION}. Independent journalism, investigative reporting, and community stories.`,
            aeoEntityType: 'NewsMediaOrganization',
            jsonLd: buildOrganizationSchema({
                name: SITE_NAME,
                url: siteUrl(),
                logo,
                description: SITE_DESCRIPTION,
            },),
            body: buildGenericBody(SITE_NAME, SITE_DESCRIPTION,),
        };
    }

    // ─── Posts listing ───
    if (path === '/posts') {
        // One query for count + summaries — bots indexing /posts get
        // titles + excerpts + dates so each linked post is
        // discoverable from this page even without JS.
        const listRes = await query<{
            title: string;
            slug: string;
            excerpt: string | null;
            published_at: string | null;
        }>(
            `SELECT title, slug, excerpt, published_at FROM posts
             WHERE status = 'published' AND is_private = false
             ORDER BY COALESCE(published_at, created_at) DESC
             LIMIT 30`,
        ).catch(() => null,);
        const listItems = listRes?.rows || [];
        const countRes = await query(
            `SELECT COUNT(*)::int AS count FROM posts WHERE status = 'published'`,
        ).catch(() => null,);
        const count = countRes?.rows[0]?.count || 0;
        return {
            title: 'Blog',
            description: `Latest news, stories, and investigative reporting from ${SITE_NAME}.`,
            canonical: url,
            type: 'website',
            image: logo,
            siteName: SITE_NAME,
            aeoSummary: `Browse the latest blog posts, news articles, and reporting from ${SITE_NAME}.`,
            aeoEntityType: 'Blog',
            jsonLd: buildCollectionPageSchema({
                name: 'Blog',
                description: `Latest news and articles from ${SITE_NAME}`,
                url,
                itemCount: count,
            },),
            body: buildPostListBody(SITE_NAME, listItems.map(r => ({
                title: r.title,
                slug: r.slug,
                excerpt: r.excerpt,
                publishedAt: r.published_at,
            }),),),
        };
    }

    // ─── Post detail ───
    const postMatch = path.match(/^\/posts\/([a-z0-9-]+)$/i,);
    if (postMatch) {
        const slug = postMatch[1];
        const res = await query(
            `SELECT id, title, slug, excerpt, content, featured_image, author, published_at,
                    updated_at, categories, tags, meta_title, meta_description
             FROM posts WHERE slug = $1 AND status = 'published'`,
            [slug,],
        ).catch(() => null,);
        const row = res?.rows[0];
        if (!row) return null;
        const post = mapRow(row,) as any;
        const description = post.metaDescription || post.excerpt ||
            truncateText(stripHtml(post.content || '',), 200,) ||
            `${post.title} — published by ${SITE_NAME}`;
        const section = Array.isArray(post.categories,) ? post.categories[0] : undefined;
        const image = post.featuredImage || logo;

        return {
            title: post.metaTitle || post.title,
            description,
            canonical: url,
            type: 'article',
            image,
            imageAlt: post.title,
            publishedAt: post.publishedAt,
            modifiedAt: post.updatedAt,
            author: post.author,
            section,
            tags: post.tags,
            keywords: post.tags,
            siteName: SITE_NAME,
            aeoSummary: truncateText(stripHtml(description,), 280,),
            aeoEntityType: 'NewsArticle',
            jsonLd: [
                buildArticleSchema({
                    headline: post.title,
                    description,
                    url,
                    image,
                    datePublished: post.publishedAt,
                    dateModified: post.updatedAt,
                    authorName: post.author,
                    publisherName: SITE_NAME,
                    publisherLogo: logo,
                    articleSection: section,
                    keywords: post.tags,
                },),
                buildBreadcrumbSchema([
                    { name: 'Home', url: siteUrl(), },
                    { name: 'Posts', url: `${siteUrl()}/posts`, },
                    { name: post.title, url, },
                ],),
            ],
            body: buildPostBody({
                title: post.title,
                excerpt: post.excerpt,
                content: post.content,
                author: post.author,
                publishedAt: post.publishedAt,
                tags: post.tags,
                featuredImage: post.featuredImage,
            },),
        };
    }

    // ─── Campaign detail ───
    const campaignMatch = path.match(/^\/campaigns\/([a-z0-9-]+)$/i,);
    if (campaignMatch) {
        const slug = campaignMatch[1];
        const res = await query(
            `SELECT id, title, slug, description, short_description, featured_image,
                    goal_amount_cents, current_amount_cents
             FROM campaigns WHERE slug = $1 AND is_published = true`,
            [slug,],
        ).catch(() => null,);
        const row = res?.rows[0];
        if (!row) return null;
        const campaign = mapRow(row,) as any;
        const description = campaign.shortDescription ||
            truncateText(stripHtml(campaign.description || '',), 200,) ||
            `${campaign.title} is a fundraising campaign from ${SITE_NAME}.`;
        const image = campaign.featuredImage || logo;

        return {
            title: campaign.title,
            description,
            canonical: url,
            type: 'website',
            image,
            imageAlt: campaign.title,
            siteName: SITE_NAME,
            aeoSummary: description,
            aeoEntityType: 'DonateAction',
            jsonLd: [
                buildDonationSchema({
                    name: campaign.title,
                    description,
                    url,
                    image,
                    goalAmount: campaign.goalAmountCents,
                    publisherName: SITE_NAME,
                },),
                buildBreadcrumbSchema([
                    { name: 'Home', url: siteUrl(), },
                    { name: 'Donate', url: `${siteUrl()}/donate`, },
                    { name: campaign.title, url, },
                ],),
            ],
            body: buildGenericBody(campaign.title, description,),
        };
    }

    // ─── Static routes (no auth needed) ───
    if (path === '/contact') {
        const description = `Get in touch with ${SITE_NAME}. Send us a message, question, or story tip.`;
        return {
            title: 'Contact',
            description,
            canonical: url,
            type: 'website',
            image: logo,
            siteName: SITE_NAME,
            aeoSummary: `Contact page for ${SITE_NAME} — send a message or story tip to our team.`,
            aeoEntityType: 'ContactPage',
            jsonLd: buildWebPageSchema({
                name: 'Contact',
                description: `Contact ${SITE_NAME}`,
                url,
                publisherName: SITE_NAME,
            },),
            body: buildGenericBody('Contact', description,),
        };
    }
    if (path === '/shop') {
        const description = `Support independent journalism with official ${SITE_NAME} merchandise.`;
        return {
            title: 'Shop',
            description,
            canonical: url,
            type: 'website',
            image: logo,
            siteName: SITE_NAME,
            aeoSummary: `Shop official ${SITE_NAME} merchandise to support independent journalism.`,
            jsonLd: buildWebPageSchema({
                name: 'Shop',
                description: 'Official merchandise',
                url,
                publisherName: SITE_NAME,
            },),
            body: buildGenericBody('Shop', description,),
        };
    }

    // ─── Noindex routes ───
    const noindexRoutes = ['/login', '/join', '/subscribe', '/search', '/forms',];
    if (noindexRoutes.some((p,) => path === p || path.startsWith(`${p}/`,),)) {
        const names: Record<string, string> = {
            '/login': 'Sign In',
            '/join': 'Join',
            '/subscribe': 'Subscribe',
            '/search': 'Search',
            '/forms': 'Form',
        };
        const base = Object.keys(names,).find((k,) => path === k || path.startsWith(`${k}/`,),);
        return {
            title: base ? names[base] : SITE_NAME,
            description: SITE_DESCRIPTION,
            canonical: url,
            image: logo,
            noindex: true,
            nofollow: true,
            siteName: SITE_NAME,
        };
    }

    // ─── Dynamic CMS pages (catch-all) ───
    // Try to match as a CMS page slug (also handles /donate, etc. when stored as a page)
    const slug = path.slice(1,);
    if (slug && !slug.includes('/',)) {
        const res = await query(
            `SELECT id, title, slug, description, meta_title, meta_description,
                    meta_keywords, og_image, updated_at, title_alignment, show_title
             FROM pages WHERE slug = $1 AND status = 'published'`,
            [slug,],
        ).catch(() => null,);
        const row = res?.rows[0];
        if (row) {
            const page = mapRow(row,) as any;
            const title = page.metaTitle || page.title;
            const description = page.metaDescription || page.description ||
                `${page.title} — ${SITE_NAME}`;
            const image = page.ogImage || logo;

            // Fetch the page's blocks for SSR body rendering. We
            // only need text-relevant fields; the body builder
            // skips dynamic block types it can't index anyway.
            // Errors fall back to a title-only body so SSR never
            // breaks for a page that's missing its blocks row.
            let blocks: Array<{ type: string; title: string | null; content: string | null; settings: Record<string, unknown> | null; }> = [];
            try {
                const blocksRes = await query<{
                    type: string;
                    title: string | null;
                    content: string | null;
                    settings: Record<string, unknown> | null;
                }>(
                    `SELECT type, title, content, settings FROM blocks
                     WHERE page_id = $1 AND is_visible = true
                     ORDER BY "order" ASC`,
                    [page.id,],
                );
                blocks = blocksRes.rows;
            } catch { /* ignore — fall through to title-only body */ }

            return {
                title,
                description,
                canonical: url,
                type: 'website',
                image,
                imageAlt: page.title,
                modifiedAt: page.updatedAt,
                keywords: page.metaKeywords,
                siteName: SITE_NAME,
                aeoSummary: truncateText(stripHtml(description,), 280,) || undefined,
                aeoEntityType: 'WebPage',
                jsonLd: [
                    buildWebPageSchema({
                        name: title,
                        description,
                        url,
                        publisherName: SITE_NAME,
                    },),
                    buildBreadcrumbSchema([
                        { name: 'Home', url: siteUrl(), },
                        { name: page.title, url, },
                    ],),
                ],
                body: buildPageBody({
                    title: page.title,
                    showTitle: page.showTitle !== false,
                    description: page.description,
                    blocks,
                },),
            };
        }
    }

    // Unknown route — return generic meta (let the SPA handle rendering)
    return {
        title: SITE_NAME,
        description: SITE_DESCRIPTION,
        canonical: url,
        type: 'website',
        image: logo,
        siteName: SITE_NAME,
    };
}

/** Should this request path be handled by SSR? (Skip API, static assets, admin, etc.) */
export function isPublicRoute(path: string,): boolean {
    if (path.startsWith('/api/',)) return false;
    if (path.startsWith('/admin',)) return false;
    if (path.startsWith('/uploads/',)) return false;
    if (path.startsWith('/avatars/',)) return false;
    if (path.startsWith('/assets/',)) return false;
    if (path.startsWith('/icons/',)) return false;
    if (path === '/favicon.ico' || path === '/robots.txt' || path === '/sitemap.xml' || path === '/feed.xml') return false;
    if (path === '/manifest.webmanifest' || path === '/sw.js') return false;
    // Static asset extensions
    if (/\.(js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot|map|json)$/i.test(path,)) return false;
    return true;
}
