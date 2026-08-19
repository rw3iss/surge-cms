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
import { assembleSsrBlockTree, type SsrBlockInput, } from './blocks';
import type { MetaTags, } from './metaBuilder';
import { resolveContentForSsr, } from './templateRuntime';
import {
    buildArticleSchema,
    buildBreadcrumbSchema,
    buildCollectionPageSchema,
    buildDonationSchema,
    buildOrganizationSchema,
    buildWebPageSchema,
    buildWebSiteSchema,
    stripHtml,
    truncateText,
} from './schema';

const FALLBACK_SITE_NAME = 'RW';
/**
 * Titles for the two routes with no editable page behind them. Operators can
 * override via the `seo` settings row (homeTitle / postsTitle); these defaults
 * only describe the site generically, since the CMS ships to many installs.
 */
const DEFAULT_HOME_TITLE = 'Home';
const DEFAULT_POSTS_TITLE = 'News';
const FALLBACK_SITE_DESCRIPTION = 'Independent journalism for the people';

interface SiteMeta {
    name: string;
    description: string;
    logo?: string;
    favicon?: string;
    /** Google tag / GA4 measurement id (Admin → Settings → General), if set. */
    analyticsId?: string;
    /** Search Console / Bing Webmaster ownership tokens, emitted as meta tags. */
    googleSiteVerification?: string;
    bingSiteVerification?: string;
    /** Canonical profile URLs (social accounts) for schema.org `sameAs`. */
    sameAs?: string[];
    contactEmail?: string;
    /** Editable SEO copy (Admin → the `seo` settings row). */
    homeTitle?: string;
    postsTitle?: string;
    /** Other names the outlet trades under — emitted as schema.org
     *  `alternateName`, which helps searches for either name resolve here. */
    alternateName?: string;
    /** e.g. "Philadelphia, Pennsylvania" — a locality signal. */
    areaServed?: string;
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
            `SELECT key, value FROM site_settings
             WHERE key IN ('site_name', 'site_description', 'logo', 'favicon',
                           'site_branding', 'analytics', 'social_links', 'contact_email', 'seo')`,
        );
        const map: Record<string, unknown> = {};
        for (const row of res.rows) map[row.key] = row.value;
        // Favicon lives inside the `site_branding` JSON (favicon.url); the
        // legacy top-level `favicon` key is a fallback. Mirrors the resolution
        // in services/settings.ts getPublicSettings().
        const branding = map.site_branding as { favicon?: { url?: string; }; } | undefined;
        const favicon = branding?.favicon?.url || (map.favicon as string | undefined) || undefined;
        const analytics = map.analytics as {
            googleAnalyticsId?: string;
            googleSiteVerification?: string;
            bingSiteVerification?: string;
        } | undefined;
        // `sameAs` ties this site to the outlet's other profiles so search
        // engines resolve them to ONE brand entity — the main lever available
        // when several unrelated companies share the site's name.
        const social = (map.social_links ?? {}) as Record<string, string | undefined>;
        const sameAs = Object.values(social,)
            .map((v,) => (v ?? '').trim())
            .filter((v,) => v.startsWith('http',));
        const seo = (map.seo ?? {}) as {
            homeTitle?: string;
            postsTitle?: string;
            alternateName?: string;
            areaServed?: string;
        };
        siteMetaCache = {
            homeTitle: seo.homeTitle || undefined,
            postsTitle: seo.postsTitle || undefined,
            alternateName: seo.alternateName || undefined,
            areaServed: seo.areaServed || undefined,
            name: (map.site_name as string) || FALLBACK_SITE_NAME,
            description: (map.site_description as string) || FALLBACK_SITE_DESCRIPTION,
            logo: (map.logo as string) || undefined,
            favicon,
            analyticsId: analytics?.googleAnalyticsId || undefined,
            googleSiteVerification: analytics?.googleSiteVerification || undefined,
            bingSiteVerification: analytics?.bingSiteVerification || undefined,
            sameAs,
            contactEmail: (map.contact_email as string) || undefined,
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

/** The configured Google tag / GA4 measurement id (or undefined). Used by the
 *  SSR head injector to emit the gtag snippet on public pages. */
export async function getSiteAnalyticsId(): Promise<string | undefined> {
    return (await getSiteMeta()).analyticsId;
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
 * Load a page's visible blocks, resolve `{{ }}` templates, and assemble them
 * into a tree so container blocks (group / group_item) recurse.
 *
 * Shared by the dynamic-page route AND the home route. The home route used to
 * emit only the site name + tagline — about 58 characters — because it never
 * looked at the homepage's blocks at all. On a block-built homepage that meant
 * crawlers saw an essentially empty document, with none of the words the site
 * actually wants to rank for. Errors fall back to an empty list so SSR degrades
 * to a title-only body rather than failing the request.
 */
async function loadPageBlocks(
    pageId: string,
    templateEntity: Parameters<typeof resolveContentForSsr>[1],
): Promise<ReturnType<typeof assembleSsrBlockTree>> {
    let flatBlocks: SsrBlockInput[] = [];
    try {
        const blocksRes = await query<{
            id: string;
            parent_block_id: string | null;
            type: string;
            title: string | null;
            content: string | null;
            settings: Record<string, unknown> | null;
        }>(
            // Include id + parent_block_id and order by parent first so the tree
            // assembler can nest children (group/group_item).
            `SELECT id, parent_block_id, type, title, content, settings FROM blocks
             WHERE page_id = $1 AND is_visible = true
             ORDER BY parent_block_id NULLS FIRST, "order" ASC`,
            [pageId,],
        );
        flatBlocks = blocksRes.rows.map((r,) => ({
            id: r.id,
            parentBlockId: r.parent_block_id,
            type: r.type,
            title: r.title,
            content: r.content,
            settings: r.settings,
        }),);
    } catch {
        return assembleSsrBlockTree([],);
    }

    flatBlocks = await Promise.all(flatBlocks.map(async (b,) => ({
        ...b,
        content: await resolveContentForSsr(b.content, templateEntity,),
    }),),);
    return assembleSsrBlockTree(flatBlocks,);
}


/**
 * The home page's indexable body. Renders the CMS homepage's blocks when one is
 * configured (`pages.is_homepage`), so the words on the page are actually in the
 * HTML; falls back to the site name + tagline when there is no homepage row.
 */
async function buildHomeBody(siteName: string, siteDescription: string,): Promise<string> {
    try {
        const res = await query(
            `SELECT id, title, description, show_title
             FROM pages WHERE is_homepage = true AND status = 'published' LIMIT 1`,
        );
        const row = res.rows[0];
        if (!row) return buildGenericBody(siteName, siteDescription,);
        const page = mapRow(row,) as any;
        const blocks = await loadPageBlocks(page.id, { page, },);
        const body = buildPageBody({
            // The homepage's own <h1> is the site name — the page title is
            // usually something internal like "home".
            title: siteName,
            showTitle: true,
            description: page.description || siteDescription,
            blocks,
        },);
        return body || buildGenericBody(siteName, siteDescription,);
    } catch {
        return buildGenericBody(siteName, siteDescription,);
    }
}

/**
 * Resolve a URL path to its meta tags by looking up the content in the DB.
 * Returns null if the path is not a known public route (let the SPA handle it).
 */
export async function resolveRouteMeta(pathname: string,): Promise<MetaTags | null> {
    const resolved = await resolveRouteMetaInner(pathname,);
    if (!resolved) return null;
    // Ownership tokens ride on every page: the verifier may fetch any URL, and
    // the home page alone isn't guaranteed to be the one it checks.
    const s = await getSiteMeta();
    return {
        ...resolved,
        ...(s.googleSiteVerification ? { googleSiteVerification: s.googleSiteVerification, } : {}),
        ...(s.bingSiteVerification ? { bingSiteVerification: s.bingSiteVerification, } : {}),
    };
}

async function resolveRouteMetaInner(pathname: string,): Promise<MetaTags | null> {
    const path = pathname.split('?',)[0].replace(/\/+$/, '',) || '/';
    const url = `${siteUrl()}${path === '/' ? '' : path}`;
    const site = await getSiteMeta();
    const SITE_NAME = site.name;
    const SITE_DESCRIPTION = site.description;
    const logo = publisherLogo(site,);
    const HOME_TITLE = site.homeTitle || DEFAULT_HOME_TITLE;
    const POSTS_TITLE = site.postsTitle || DEFAULT_POSTS_TITLE;

    // ─── Home ───
    if (path === '/' || path === '') {
        return {
            // A homepage title is the site's single most important; "Home" says
            // nothing. Lead with what the outlet covers and where.
            title: HOME_TITLE,
            description: SITE_DESCRIPTION ||
                'Independent, community-focused journalism covering the stories that matter.',
            canonical: url,
            type: 'website',
            image: logo,
            siteName: SITE_NAME,
            aeoSummary:
                `${SITE_NAME} — ${SITE_DESCRIPTION}. Independent journalism, investigative reporting, and community stories.`,
            aeoEntityType: 'NewsMediaOrganization',
            jsonLd: [
                buildOrganizationSchema({
                    name: SITE_NAME,
                    url: siteUrl(),
                    logo,
                    description: SITE_DESCRIPTION,
                    sameAs: site.sameAs,
                    email: site.contactEmail,
                    alternateName: site.alternateName,
                    areaServed: site.areaServed,
                },),
                buildWebSiteSchema({
                    name: SITE_NAME,
                    url: siteUrl(),
                    description: SITE_DESCRIPTION,
                },),
            ],
            body: await buildHomeBody(SITE_NAME, SITE_DESCRIPTION,),
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
            title: POSTS_TITLE,
            description: `Latest news, stories, and investigative reporting from ${SITE_NAME}.`,
            canonical: url,
            type: 'website',
            image: logo,
            siteName: SITE_NAME,
            aeoSummary: `Browse the latest news articles, commentary, and reporting from ${SITE_NAME}.`,
            aeoEntityType: 'Blog',
            jsonLd: buildCollectionPageSchema({
                name: POSTS_TITLE,
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
            // `posts.author` is the legacy free-text column and is empty on
            // modern rows — the real author is `author_id -> users.display_name`
            // (services/feed.ts already joins it this way). Without the join the
            // byline, `article:author` and the NewsArticle `author` node were all
            // blank, which costs a news site real credibility signals.
            `SELECT p.id, p.title, p.slug, p.excerpt, p.content, p.featured_image,
                    COALESCE(NULLIF(BTRIM(p.author), ''), u.display_name) AS author,
                    p.published_at, p.updated_at, p.categories, p.tags,
                    p.meta_title, p.meta_description
             FROM posts p
             LEFT JOIN users u ON u.id = p.author_id
             WHERE p.slug = $1 AND p.status = 'published'`,
            [slug,],
        ).catch(() => null,);
        const row = res?.rows[0];
        if (!row) return null;
        const post = mapRow(row,) as any;
        // Resolve any {{ … }} template syntax in the post body (the post itself
        // is exposed as `post` to the templates).
        const resolvedContent = await resolveContentForSsr(post.content, { post, },);
        const description = post.metaDescription || post.excerpt ||
            truncateText(stripHtml(resolvedContent || '',), 200,) ||
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
                content: resolvedContent,
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
            let flatBlocks: SsrBlockInput[] = [];
            try {
                const blocksRes = await query<{
                    id: string;
                    parent_block_id: string | null;
                    type: string;
                    title: string | null;
                    content: string | null;
                    settings: Record<string, unknown> | null;
                }>(
                    // Include id + parent_block_id and order by parent first so
                    // the tree assembler can nest children (group/group_item).
                    `SELECT id, parent_block_id, type, title, content, settings FROM blocks
                     WHERE page_id = $1 AND is_visible = true
                     ORDER BY parent_block_id NULLS FIRST, "order" ASC`,
                    [page.id,],
                );
                flatBlocks = blocksRes.rows.map((r,) => ({
                    id: r.id,
                    parentBlockId: r.parent_block_id,
                    type: r.type,
                    title: r.title,
                    content: r.content,
                    settings: r.settings,
                }),);
            } catch { /* ignore — fall through to title-only body */ }

            // Resolve any {{ … }} template syntax in block content (flat, before
            // tree assembly) so crawlers see real content — including nested
            // blocks. The `page` entity is exposed to the templates.
            flatBlocks = await Promise.all(flatBlocks.map(async (b,) => ({
                ...b,
                content: await resolveContentForSsr(b.content, { page, },),
            }),),);
            // Assemble the flat list into a tree so container blocks recurse.
            const blocks = assembleSsrBlockTree(flatBlocks,);

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
