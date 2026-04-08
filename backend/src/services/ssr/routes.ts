/**
 * Route resolver for SSR meta generation.
 * Matches URLs to content types and builds the appropriate meta tags.
 */
import { config, } from '../../config';
import { query, } from '../../db';
import { mapRow, } from '../../utils/mapRow';
import { logger, } from '../../utils/logger';
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

const SITE_NAME = 'Surge Media';

function siteUrl(): string {
    return config.frontendUrl.replace(/\/$/, '',);
}

function publisherLogo(): string {
    return `${siteUrl()}/icons/icon-512x512.png`;
}

/**
 * Resolve a URL path to its meta tags by looking up the content in the DB.
 * Returns null if the path is not a known public route (let the SPA handle it).
 */
export async function resolveRouteMeta(pathname: string,): Promise<MetaTags | null> {
    const path = pathname.split('?',)[0].replace(/\/+$/, '',) || '/';
    const url = `${siteUrl()}${path === '/' ? '' : path}`;

    // ─── Home ───
    if (path === '/' || path === '') {
        return {
            title: `${SITE_NAME} — Independent Journalism`,
            description: 'Independent, community-focused journalism covering the stories that matter to Philadelphia and beyond.',
            canonical: url,
            type: 'website',
            image: publisherLogo(),
            siteName: SITE_NAME,
            aeoSummary: `${SITE_NAME} is an independent Philadelphia-based news organization delivering community-focused journalism, investigative reporting, and local stories.`,
            aeoEntityType: 'NewsMediaOrganization',
            jsonLd: buildOrganizationSchema({
                name: SITE_NAME,
                url: siteUrl(),
                logo: publisherLogo(),
                description: 'Philadelphia-based independent news organization',
            },),
        };
    }

    // ─── Posts listing ───
    if (path === '/posts') {
        const countRes = await query(
            `SELECT COUNT(*)::int AS count FROM posts WHERE status = 'published'`,
        ).catch(() => null,);
        const count = countRes?.rows[0]?.count || 0;
        return {
            title: 'Blog',
            description: 'Latest news, stories, and investigative reporting from Surge Media.',
            canonical: url,
            type: 'website',
            siteName: SITE_NAME,
            aeoSummary: `Browse the latest blog posts, news articles, and reporting from ${SITE_NAME}.`,
            aeoEntityType: 'Blog',
            jsonLd: buildCollectionPageSchema({
                name: 'Blog',
                description: 'Latest news and articles from Surge Media',
                url,
                itemCount: count,
            },),
        };
    }

    // ─── Post detail ───
    const postMatch = path.match(/^\/posts\/([a-z0-9-]+)$/i,);
    if (postMatch) {
        const slug = postMatch[1];
        const res = await query(
            `SELECT id, title, slug, excerpt, content, featured_image, author, published_at,
                    updated_at, category, tags, meta_title, meta_description
             FROM posts WHERE slug = $1 AND status = 'published'`,
            [slug,],
        ).catch(() => null,);
        const row = res?.rows[0];
        if (!row) return null;
        const post = mapRow(row,) as any;
        const description = post.metaDescription || post.excerpt ||
            truncateText(stripHtml(post.content || '',), 200,);

        return {
            title: post.metaTitle || post.title,
            description,
            canonical: url,
            type: 'article',
            image: post.featuredImage,
            imageAlt: post.title,
            publishedAt: post.publishedAt,
            modifiedAt: post.updatedAt,
            author: post.author,
            section: post.category,
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
                    image: post.featuredImage,
                    datePublished: post.publishedAt,
                    dateModified: post.updatedAt,
                    authorName: post.author,
                    publisherName: SITE_NAME,
                    publisherLogo: publisherLogo(),
                    articleSection: post.category,
                    keywords: post.tags,
                },),
                buildBreadcrumbSchema([
                    { name: 'Home', url: siteUrl(), },
                    { name: 'Posts', url: `${siteUrl()}/posts`, },
                    { name: post.title, url, },
                ],),
            ],
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
            truncateText(stripHtml(campaign.description || '',), 200,);

        return {
            title: campaign.title,
            description,
            canonical: url,
            type: 'website',
            image: campaign.featuredImage,
            imageAlt: campaign.title,
            siteName: SITE_NAME,
            aeoSummary: description ||
                `${campaign.title} is a fundraising campaign from ${SITE_NAME}.`,
            aeoEntityType: 'DonateAction',
            jsonLd: [
                buildDonationSchema({
                    name: campaign.title,
                    description,
                    url,
                    image: campaign.featuredImage,
                    goalAmount: campaign.goalAmountCents,
                    publisherName: SITE_NAME,
                },),
                buildBreadcrumbSchema([
                    { name: 'Home', url: siteUrl(), },
                    { name: 'Donate', url: `${siteUrl()}/donate`, },
                    { name: campaign.title, url, },
                ],),
            ],
        };
    }

    // ─── Static routes (no auth needed) ───
    if (path === '/donate' || path === '/contact' || path === '/shop') {
        // Donate is a CMS page (/donate is a dynamic page slug)
        if (path === '/contact') {
            return {
                title: 'Contact',
                description: 'Get in touch with Surge Media. Send us a message, question, or story tip.',
                canonical: url,
                type: 'website',
                siteName: SITE_NAME,
                aeoSummary: `Contact page for ${SITE_NAME} — send a message or story tip to our team.`,
                aeoEntityType: 'ContactPage',
                jsonLd: buildWebPageSchema({
                    name: 'Contact',
                    description: 'Contact Surge Media',
                    url,
                    publisherName: SITE_NAME,
                },),
            };
        }
        if (path === '/shop') {
            return {
                title: 'Shop',
                description: 'Support independent journalism with official Surge Media merchandise.',
                canonical: url,
                type: 'website',
                siteName: SITE_NAME,
                aeoSummary: `Shop official ${SITE_NAME} merchandise to support independent journalism.`,
                jsonLd: buildWebPageSchema({
                    name: 'Shop',
                    description: 'Official merchandise',
                    url,
                    publisherName: SITE_NAME,
                },),
            };
        }
        // Fall through — /donate is a CMS page
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
            title: base ? names[base] : 'Surge Media',
            canonical: url,
            noindex: true,
            nofollow: true,
            siteName: SITE_NAME,
        };
    }

    // ─── Dynamic CMS pages (catch-all) ───
    // Try to match as a CMS page slug
    const slug = path.slice(1,);
    if (slug && !slug.includes('/',)) {
        const res = await query(
            `SELECT id, title, slug, description, meta_title, meta_description,
                    meta_keywords, og_image, updated_at, title_alignment
             FROM pages WHERE slug = $1 AND status = 'published'`,
            [slug,],
        ).catch(() => null,);
        const row = res?.rows[0];
        if (row) {
            const page = mapRow(row,) as any;
            const title = page.metaTitle || page.title;
            const description = page.metaDescription || page.description || '';
            return {
                title,
                description,
                canonical: url,
                type: 'website',
                image: page.ogImage,
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
            };
        }
    }

    // Unknown route — return generic meta (let the SPA handle rendering)
    return {
        title: SITE_NAME,
        description: 'Independent journalism for the people',
        canonical: url,
        type: 'website',
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
    if (path === '/favicon.ico' || path === '/robots.txt' || path === '/sitemap.xml') return false;
    if (path === '/manifest.webmanifest' || path === '/sw.js') return false;
    // Static asset extensions
    if (/\.(js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot|map|json)$/i.test(path,)) return false;
    return true;
}
