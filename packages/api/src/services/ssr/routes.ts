/**
 * Route resolver for SSR meta generation.
 * Matches URLs to content types and builds the appropriate meta tags.
 */
import type { SiteFooterSettings, SiteHeaderSettings, } from '@sitesurge/types';
import { config, } from '../../config';
import { query, } from '../../db';
import { mapRow, } from '../../utils/mapRow';
import { assembleSsrBlockTree, type SsrBlockInput, } from './blocks';
import { buildGenericBody, buildPageBody, buildPostBody, buildPostListBody, } from './bodyBuilder';
import type { MetaTags, } from './metaBuilder';
import { buildSiteNav, } from './navBuilder';
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
import { resolveContentForSsr, } from './templateRuntime';
import { resolveStaticMeta, } from './staticMeta';
import { gateFor, isHiddenFor, tiersById, } from '../postGate/index';
import { samplePostContent, } from '../postGate/samples';

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
        const branding = map.site_branding as { favicon?: { url?: string; }; logo?: { url?: string; }; } | undefined;
        const favicon = branding?.favicon?.url || (map.favicon as string | undefined) || undefined;
        // Same for the logo. This read ONLY the legacy top-level `logo` key,
        // which Settings → Site Branding never writes — so every link preview
        // fell back to a default icon that does not exist on disk.
        const brandingLogo = branding?.logo?.url || (map.logo as string | undefined) || undefined;
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
            publicEmail?: string;
        };
        siteMetaCache = {
            homeTitle: seo.homeTitle || undefined,
            postsTitle: seo.postsTitle || undefined,
            alternateName: seo.alternateName || undefined,
            areaServed: seo.areaServed || undefined,
            name: (map.site_name as string) || FALLBACK_SITE_NAME,
            description: (map.site_description as string) || FALLBACK_SITE_DESCRIPTION,
            // `/logo.png` rather than the stored URL: it is the same image,
            // always a PNG on this site's own origin. Link-preview crawlers
            // (iMessage, Slack, Facebook) will not render an SVG logo, and some
            // refuse a CDN host.
            logo: brandingLogo ? `${siteUrl()}/logo.png` : undefined,
            favicon,
            analyticsId: analytics?.googleAnalyticsId || undefined,
            googleSiteVerification: analytics?.googleSiteVerification || undefined,
            bingSiteVerification: analytics?.bingSiteVerification || undefined,
            sameAs,
            // Deliberately NOT `contact_email`: that is the operator's inbox for
            // form notifications and is often a personal address. Publishing an
            // address in schema.org is only appropriate when it was chosen for
            // publication, so this is a separate, opt-in field.
            contactEmail: seo.publicEmail || undefined,
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
    siteNavCache = null;
    siteNavCacheAt = 0;
}

// ─── Site navigation (SSR) ──────────────────────────────────────────
//
// Read and cached exactly like the site meta above, and invalidated by the
// same call: the header and footer are edited in the same Settings area, and
// two caches with two lifetimes is how a stale nav outlives a fixed one.

let siteNavCache: { header: string; footer: string; } | null = null;
let siteNavCacheAt = 0;

/**
 * The server-rendered header/footer nav fragments.
 *
 * Empty strings on any failure — a nav is an enhancement, and a settings read
 * that fails must not cost the page its body.
 */
export async function getSiteNav(): Promise<{ header: string; footer: string; }> {
    const now = Date.now();
    if (siteNavCache && now - siteNavCacheAt < SITE_META_TTL_MS) return siteNavCache;
    try {
        const res = await query(
            `SELECT key, value FROM site_settings WHERE key IN ('site_header', 'site_footer')`,
        );
        const map: Record<string, unknown> = {};
        for (const row of res.rows) map[row.key] = row.value;
        siteNavCache = buildSiteNav(
            map.site_header as SiteHeaderSettings | undefined,
            map.site_footer as SiteFooterSettings | undefined,
        );
    } catch {
        siteNavCache = { header: '', footer: '', };
    }
    siteNavCacheAt = now;
    return siteNavCache;
}

function siteUrl(): string {
    return config.frontendUrl.replace(/\/$/, '',);
}

function publisherLogo(site: SiteMeta,): string {
    // `/icons/icon-512x512.png` is generated from Site Branding too
    // (routes/siteAssets), so the fallback resolves to a real image.
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
             ORDER BY parent_block_id NULLS FIRST, "order" ASC, created_at ASC, id ASC`,
            [pageId,],
        );
        flatBlocks = blocksRes.rows.map((r,) => ({
            id: r.id,
            parentBlockId: r.parent_block_id,
            type: r.type,
            title: r.title,
            content: r.content,
            settings: r.settings,
        }));
    } catch {
        return assembleSsrBlockTree([],);
    }

    flatBlocks = await Promise.all(flatBlocks.map(async (b,) => ({
        ...b,
        content: await resolveContentForSsr(b.content, templateEntity,),
    })),);
    return assembleSsrBlockTree(flatBlocks,);
}

/**
 * Load a post's content blocks for SSR.
 *
 * Posts do NOT share the pages `blocks` table — `post_content_blocks` uses
 * `sort_order` instead of `"order"`, has no `parent_block_id` (so no nesting),
 * and keeps everything in a `data` JSONB rather than separate `content` /
 * `settings` columns. Hence a second loader rather than a parameter on
 * `loadPageBlocks`.
 *
 * Why this exists at all: `buildPostBody` used to render only the legacy
 * `posts.content` column. Every post authored in the block editor has that
 * column EMPTY, so crawlers received the headline, date and excerpt and none of
 * the article — measured at 45 words of 628 on a live post, while the page's
 * `NewsArticle` schema asserted a full article. The body Google indexes and the
 * structured data describing it disagreed.
 *
 * Errors degrade to an empty list: a missing block row should cost the article
 * its body, not its whole page.
 */
async function loadPostBlocks(
    postId: string,
    templateEntity: Parameters<typeof resolveContentForSsr>[1],
): Promise<SsrBlockInput[]> {
    let flat: SsrBlockInput[] = [];
    try {
        const res = await query<{
            id: string;
            type: string;
            data: Record<string, unknown> | null;
        }>(
            `SELECT id, type, data FROM post_content_blocks
             WHERE post_id = $1
             ORDER BY sort_order ASC, created_at ASC, id ASC`,
            [postId,],
        );
        flat = res.rows.map((r,) => {
            const data = r.data ?? {};
            return {
                id: r.id,
                parentBlockId: null,
                type: r.type,
                title: (data.title as string) ?? null,
                // Post blocks keep their HTML under `data.content`; the shared
                // block renderers read a top-level `content`.
                content: (data.content as string) ?? null,
                settings: data,
            };
        },);
    } catch {
        return [];
    }

    return Promise.all(flat.map(async (b,) => ({
        ...b,
        content: await resolveContentForSsr(b.content, templateEntity,),
    })),);
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
    // Note the homepage keeps its trailing slash. It used to be trimmed, which
    // made the canonical tag say `https://site.us` while the sitemap said
    // `https://site.us/` — two spellings of the home page, given to the crawler
    // by us, in the same crawl. That is precisely the disagreement a canonical
    // exists to settle.
    const url = `${siteUrl()}${path}`;
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
               AND (required_tier_id IS NULL OR gate_hidden = false)
             ORDER BY COALESCE(published_at, created_at) DESC
             LIMIT 30`,
        ).catch(() => null);
        const listItems = listRes?.rows || [];
        const countRes = await query(
            `SELECT COUNT(*)::int AS count FROM posts WHERE status = 'published'`,
        ).catch(() => null);
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
            body: buildPostListBody(
                SITE_NAME,
                listItems.map(r => ({
                    title: r.title,
                    slug: r.slug,
                    excerpt: r.excerpt,
                    publishedAt: r.published_at,
                })),
            ),
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
                    p.meta_title, p.meta_description,
                    p.required_tier_id, p.gate_hidden, p.gate_show_sample, p.gate_sample_percent
             FROM posts p
             LEFT JOIN users u ON u.id = p.author_id
             WHERE p.slug = $1 AND p.status = 'published'`,
            [slug,],
        ).catch(() => null);
        const row = res?.rows[0];
        // A published post with this slug does not exist. SSR owns this
        // route, so the miss is authoritative: 404 rather than handing the
        // SPA a 200 for a URL that resolves to nothing.
        if (!row) return notFoundMeta(SITE_NAME,);
        const post = mapRow(row,) as any;
        // Subscription gate — SSR is anonymous: a hidden gated post does not
        // exist here, and a locked one renders only its sample (or no body),
        // so the full article never reaches the HTML a scraper can read.
        const gate = gateFor(post, null, await tiersById(),);
        if (isHiddenFor(post, gate,)) return notFoundMeta(SITE_NAME,);
        // Resolve any {{ … }} template syntax in the post body (the post itself
        // is exposed as `post` to the templates).
        let resolvedContent = await resolveContentForSsr(post.content, { post, },);
        // The article body. Block-authored posts leave `posts.content` empty,
        // so without this the SSR body is a headline and an excerpt.
        let postBlocks = await loadPostBlocks(post.id, { post, },);
        if (gate.state === 'locked') {
            if (gate.sample) {
                const sample = samplePostContent({
                    ...post,
                    content: resolvedContent,
                    contentBlocks: postBlocks.map((b,) => ({ ...b, data: { ...(b.settings ?? {}), content: b.content, }, })),
                }, post.gateSamplePercent ?? 25,);
                resolvedContent = sample.content;
                postBlocks = sample.blocks.map((b,) => ({ ...(b as unknown as SsrBlockInput), content: String(b.data?.content ?? '',), }));
            } else {
                resolvedContent = '';
                postBlocks = [];
            }
        }
        const blocksHtml = postBlocks.map((b,) => b.content || '').join(' ',);
        const description = post.metaDescription || post.excerpt ||
            truncateText(stripHtml(resolvedContent || blocksHtml || '',), 200,) ||
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
                    ...(gate.state === 'public' ? {} : { isAccessibleForFree: false, }),
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
                blocks: postBlocks,
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
        ).catch(() => null);
        const row = res?.rows[0];
        // A published post with this slug does not exist. SSR owns this
        // route, so the miss is authoritative: 404 rather than handing the
        // SPA a 200 for a URL that resolves to nothing.
        if (!row) return notFoundMeta(SITE_NAME,);
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
    // NOTE: /contact is deliberately NOT here — it is a CMS page now, so it
    // falls through to the dynamic-page branch and takes its title,
    // description and indexable body from the page and its blocks.
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

    // ─── App screens + SPA-rendered detail pages ───
    // /subscribe, /search, /events…, shop products, events, forms, /watch:
    // their own title, description, image and JSON-LD (services/ssr/staticMeta);
    // account screens (/login, /join, /profile, cart, tickets…) are noindex.
    // Before the CMS-page lookup: these routes win in the SPA router too.
    const appMeta = await resolveStaticMeta({
        path, url, siteUrl: siteUrl(), siteName: SITE_NAME, siteDescription: SITE_DESCRIPTION, logo,
    },);
    if (appMeta) return appMeta;

    // ─── Dynamic CMS pages (catch-all) ───
    // Try to match as a CMS page slug (also handles /donate, etc. when stored as a page)
    const slug = path.slice(1,);
    if (slug && !slug.includes('/',)) {
        const res = await query(
            `SELECT id, title, slug, description, meta_title, meta_description,
                    meta_keywords, og_image, updated_at, title_alignment, show_title
             FROM pages WHERE slug = $1 AND status = 'published'`,
            [slug,],
        ).catch(() => null);
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
                     ORDER BY parent_block_id NULLS FIRST, "order" ASC, created_at ASC, id ASC`,
                    [page.id,],
                );
                flatBlocks = blocksRes.rows.map((r,) => ({
                    id: r.id,
                    parentBlockId: r.parent_block_id,
                    type: r.type,
                    title: r.title,
                    content: r.content,
                    settings: r.settings,
                }));
            } catch { /* ignore — fall through to title-only body */ }

            // Resolve any {{ … }} template syntax in block content (flat, before
            // tree assembly) so crawlers see real content — including nested
            // blocks. The `page` entity is exposed to the templates.
            flatBlocks = await Promise.all(flatBlocks.map(async (b,) => ({
                ...b,
                content: await resolveContentForSsr(b.content, { page, },),
            })),);
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

    // ─── Nothing matched ───
    //
    // A route the SPA genuinely serves gets generic meta; anything else is a
    // 404. Previously EVERYTHING landed here with a self-referencing canonical
    // and `index, follow`, so every typo, scraped link and probe became an
    // indexable page — an unbounded soft-404 surface on a site with ~18 real
    // URLs.
    if (STATIC_PUBLIC_ROUTES.has(path,) || SPA_OWNED_PREFIXES.some((p,) => path.startsWith(p,))) {
        return {
            title: SITE_NAME,
            description: SITE_DESCRIPTION,
            canonical: url,
            type: 'website',
            image: logo,
            siteName: SITE_NAME,
        };
    }

    return notFoundMeta(SITE_NAME,);
}

/**
 * Public SPA routes that always exist, with no CMS entity behind them.
 *
 * These must never 404: there is no row to look up, so the "nothing matched"
 * fallthrough would otherwise condemn the sign-in page.
 */
const STATIC_PUBLIC_ROUTES: ReadonlySet<string> = new Set([
    '/',
    '/login',
    '/join',
    '/subscribe',
    '/search',
    '/profile',
    '/verify',
    '/posts',
    '/campaigns',
    '/donate',
    '/events',
    '/shop',
    '/setup',
    '/forgot-password',
    '/reset-password',
    '/mail',
],);

/**
 * Prefixes the SPA resolves CLIENT-side and SSR does not own.
 *
 * SSR cannot tell whether `/shop/some-product` exists — it has no product
 * resolver — so it must not guess. Left at 200 deliberately: a false 404 on a
 * real product is far worse than a soft 200 on a fake one, and these are the
 * routes to give their own resolvers next (see the SEO audit).
 *
 * The prefixes SSR DOES own (`/posts/`, `/campaigns/`) are absent on purpose —
 * a miss there is a genuine, verified 404.
 */
const SPA_OWNED_PREFIXES: readonly string[] = [
    '/shop/',
    '/events/',
    '/forms/',
    '/u/',
    '/lists/',
    '/orders/',
    // Player page for video direct links (resolved by the SPA via playback).
    '/watch/',
    '/tickets/',
    '/mail/',
    // NOT /members/ or /forum/: staticMeta resolves those authoritatively (a
    // disabled forum, an unknown thread or a hidden member page is a real 404).
];

/**
 * Meta for a URL that resolves to nothing.
 *
 * `noindex, nofollow` AND no canonical — a canonical on a 404 invites the
 * crawler to treat the URL as real. The body is deliberately absent so the SPA
 * renders its own styled not-found page.
 */
function notFoundMeta(siteName: string,): MetaTags {
    return {
        title: 'Page Not Found',
        description: 'The page you are looking for could not be found.',
        noindex: true,
        nofollow: true,
        notFound: true,
        siteName,
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
    if (path === '/favicon.ico' || path === '/robots.txt' || path === '/sitemap.xml' || path === '/feed.xml') {
        return false;
    }
    if (path === '/manifest.webmanifest' || path === '/sw.js') return false;
    // Static asset extensions
    if (/\.(js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot|map|json)$/i.test(path,)) return false;
    return true;
}
