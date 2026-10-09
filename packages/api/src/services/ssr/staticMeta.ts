/**
 * Meta for public routes that have no CMS page/post behind them — the app's
 * own screens (/subscribe, /login, /search, …) and the feature detail pages
 * the SPA renders (shop products, events, forms, the video player page).
 *
 * Before this, every one of them got the bare site name and description, so a
 * shared /subscribe or product link previewed as just "Surge Media". Each now
 * gets its own title, description, image, canonical and JSON-LD; account
 * screens are `noindex` (real pages, not search results). Detail pages read
 * their record — and fall back to the generic tags when the feature's tables
 * do not exist or the record is gone (the SPA then shows its own 404).
 */
import { stripMarkdown, } from '@sitesurge/types';
import { query, } from '../../db';
import { buildGenericBody, } from './bodyBuilder';
import type { MetaTags, } from './metaBuilder';
import { buildBreadcrumbSchema, buildWebPageSchema, stripHtml, truncateText, } from './schema';

export interface StaticMetaCtx {
    path: string;
    url: string;
    siteUrl: string;
    siteName: string;
    siteDescription: string;
    logo: string | undefined;
}

interface Entry {
    title: string;
    description: (c: StaticMetaCtx,) => string;
    /** An account/utility screen: real, but not for search results. */
    noindex?: boolean;
}

const ROUTES: Record<string, Entry> = {
    '/subscribe': {
        title: 'Membership',
        description: (c,) => `Membership plans for ${c.siteName} — support independent journalism and get subscriber access.`,
    },
    '/search': {
        title: 'Search',
        description: (c,) => `Search articles, videos and pages on ${c.siteName}.`,
    },
    '/campaigns': {
        title: 'Campaigns',
        description: (c,) => `Support ${c.siteName}'s fundraising campaigns.`,
    },
    '/donate': {
        title: 'Donate',
        description: (c,) => `Support ${c.siteName} with a donation.`,
    },
    '/events': {
        title: 'Events',
        description: (c,) => `Upcoming events from ${c.siteName}.`,
    },
    '/mail': {
        title: 'Newsletter archive',
        description: (c,) => `Past newsletters and emails from ${c.siteName}.`,
    },
    '/login': { title: 'Log in', description: (c,) => `Log in to your ${c.siteName} account.`, noindex: true, },
    '/join': { title: 'Create an account', description: (c,) => `Join ${c.siteName}.`, noindex: true, },
    '/profile': { title: 'Your account', description: (c,) => `Your ${c.siteName} account.`, noindex: true, },
    '/verify': { title: 'Verify your email', description: (c,) => `Confirm your ${c.siteName} email address.`, noindex: true, },
    '/forgot-password': { title: 'Reset your password', description: (c,) => `Reset your ${c.siteName} password.`, noindex: true, },
    '/reset-password': { title: 'Choose a new password', description: (c,) => `Set a new ${c.siteName} password.`, noindex: true, },
    '/setup': { title: 'Setup', description: (c,) => `${c.siteName} setup.`, noindex: true, },
    '/shop/cart': { title: 'Your cart', description: (c,) => `Your ${c.siteName} shopping cart.`, noindex: true, },
    '/shop/checkout': { title: 'Checkout', description: (c,) => `Checkout — ${c.siteName}.`, noindex: true, },
};

/** Prefixes whose pages are private to the visitor (order receipts, tickets). */
const NOINDEX_PREFIXES = ['/shop/orders/', '/orders/', '/tickets/', '/u/', '/lists/',];

const clip = (s: string | null | undefined, n = 200,) => truncateText(stripHtml(stripMarkdown(s ?? '',),).replace(/\s+/g, ' ',).trim(), n,);

function page(c: StaticMetaCtx, title: string, description: string, extra: Partial<MetaTags> = {},): MetaTags {
    return {
        title,
        description,
        canonical: c.url,
        type: 'website',
        image: c.logo,
        siteName: c.siteName,
        aeoSummary: description,
        jsonLd: [
            buildWebPageSchema({ name: title, description, url: c.url, publisherName: c.siteName, },),
            buildBreadcrumbSchema([{ name: 'Home', url: c.siteUrl, }, { name: title, url: c.url, },],),
        ],
        body: buildGenericBody(title, description,),
        ...extra,
    };
}

/** Run a lookup; a missing feature table (or any DB error) → null. */
async function safe<T,>(fn: () => Promise<T | null>,): Promise<T | null> {
    try {
        return await fn();
    } catch {
        return null;
    }
}

async function product(c: StaticMetaCtx, slug: string,): Promise<MetaTags | null> {
    const row = await safe(async () => (await query<{
        id: string; title: string; description: string | null; meta_title: string | null; meta_description: string | null;
        image: string | null; price_cents: number | null;
    }>(
        `SELECT p.id, p.title, p.description, p.meta_title, p.meta_description,
                (SELECT COALESCE(m.url, pm.external_url) FROM shop_product_media pm
                   LEFT JOIN media m ON m.id = pm.media_id
                  WHERE pm.product_id = p.id ORDER BY pm.position LIMIT 1) AS image,
                (SELECT MIN(v.price_cents) FROM shop_variants v WHERE v.product_id = p.id) AS price_cents
           FROM shop_products p WHERE p.slug = $1 AND p.status = 'active'`,
        [slug,],
    )).rows[0] ?? null,);
    if (!row) return null;
    const title = row.meta_title || row.title;
    const description = row.meta_description || clip(row.description,) || `${row.title} — from the ${c.siteName} shop.`;
    return page(c, title, description, {
        type: 'product',
        image: row.image || c.logo,
        imageAlt: row.title,
        jsonLd: [
            {
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: row.title,
                description,
                url: c.url,
                ...(row.image ? { image: row.image, } : {}),
                ...(row.price_cents != null
                    ? { offers: { '@type': 'Offer', price: (row.price_cents / 100).toFixed(2,), priceCurrency: 'USD', url: c.url, availability: 'https://schema.org/InStock', }, }
                    : {}),
            },
            buildBreadcrumbSchema([
                { name: 'Home', url: c.siteUrl, }, { name: 'Shop', url: `${c.siteUrl}/shop`, }, { name: row.title, url: c.url, },
            ],),
        ],
    },);
}

async function shopGroup(c: StaticMetaCtx, kind: 'collections' | 'categories', slug: string,): Promise<MetaTags | null> {
    const table = kind === 'collections' ? 'shop_collections' : 'shop_categories';
    const name = kind === 'collections' ? 'title' : 'name';
    const row = await safe(async () => (await query<{ title: string; description: string | null; }>(
        `SELECT ${name} AS title, description FROM ${table} WHERE slug = $1`, [slug,],
    )).rows[0] ?? null,);
    if (!row) return null;
    return page(c, row.title, clip(row.description,) || `${row.title} — shop ${c.siteName}.`,);
}

async function event(c: StaticMetaCtx, slug: string,): Promise<MetaTags | null> {
    const row = await safe(async () => (await query<{
        title: string; description: string | null; starts_at: string | null; ends_at: string | null; location: string | null;
        featured_image: string | null; url: string | null;
    }>(
        `SELECT title, description, starts_at, ends_at, location, featured_image, url
           FROM events WHERE slug = $1 AND status = 'published'`, [slug,],
    )).rows[0] ?? null,);
    if (!row) return null;
    const description = clip(row.description,) || `${row.title} — an event from ${c.siteName}.`;
    return page(c, row.title, description, {
        image: row.featured_image || c.logo,
        imageAlt: row.title,
        jsonLd: [
            {
                '@context': 'https://schema.org',
                '@type': 'Event',
                name: row.title,
                description,
                url: c.url,
                ...(row.starts_at ? { startDate: new Date(row.starts_at,).toISOString(), } : {}),
                ...(row.ends_at ? { endDate: new Date(row.ends_at,).toISOString(), } : {}),
                ...(row.featured_image ? { image: row.featured_image, } : {}),
                ...(row.location
                    ? { location: { '@type': 'Place', name: row.location, }, eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode', }
                    : row.url ? { location: { '@type': 'VirtualLocation', url: row.url, }, eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode', } : {}),
                organizer: { '@type': 'Organization', name: c.siteName, url: c.siteUrl, },
            },
            buildBreadcrumbSchema([
                { name: 'Home', url: c.siteUrl, }, { name: 'Events', url: `${c.siteUrl}/events`, }, { name: row.title, url: c.url, },
            ],),
        ],
    },);
}

async function form(c: StaticMetaCtx, slug: string,): Promise<MetaTags | null> {
    const row = await safe(async () => (await query<{ title: string; description: string | null; }>(
        `SELECT title, description FROM forms WHERE slug = $1 AND status = 'published'`, [slug,],
    )).rows[0] ?? null,);
    if (!row) return null;
    return page(c, row.title, clip(row.description,) || `${row.title} — ${c.siteName}.`,);
}

async function watch(c: StaticMetaCtx, id: string,): Promise<MetaTags | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id,)) return null;
    const row = await safe(async () => (await query<{ title: string | null; original_name: string; thumbnail_url: string | null; caption: string | null; duration_ms: number | null; created_at: string; }>(
        `SELECT title, original_name, thumbnail_url, caption, duration_ms, created_at FROM media WHERE id = $1 AND mime_type LIKE 'video/%'`, [id,],
    )).rows[0] ?? null,);
    if (!row) return null;
    const title = row.title || row.original_name.replace(/\.[^.]+$/, '',);
    const description = clip(row.caption,) || `Watch “${title}” on ${c.siteName}.`;
    return page(c, title, description, {
        image: row.thumbnail_url || c.logo,
        imageAlt: title,
        jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'VideoObject',
            name: title,
            description,
            ...(row.thumbnail_url ? { thumbnailUrl: row.thumbnail_url, } : {}),
            uploadDate: new Date(row.created_at,).toISOString(),
            ...(row.duration_ms ? { duration: `PT${Math.round(row.duration_ms / 1000,)}S`, } : {}),
            embedUrl: c.url,
        },
    },);
}

async function mailView(c: StaticMetaCtx, id: string,): Promise<MetaTags | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id,)) return null;
    const row = await safe(async () => (await query<{ subject: string | null; }>(
        `SELECT subject FROM mail_send_jobs WHERE id = $1`, [id,],
    )).rows[0] ?? null,);
    if (!row?.subject) return null;
    return page(c, row.subject, `“${row.subject}” — a newsletter from ${c.siteName}.`,);
}

/**
 * Meta for an app route / SPA-rendered detail page, or null when the path is
 * none of them (the caller then 404s or uses its own fallthrough).
 */
export async function resolveStaticMeta(c: StaticMetaCtx,): Promise<MetaTags | null> {
    const { path, } = c;
    const entry = ROUTES[path];
    if (entry) return page(c, entry.title, entry.description(c,), entry.noindex ? { noindex: true, jsonLd: undefined, body: undefined, } : {},);

    if (NOINDEX_PREFIXES.some((p,) => path.startsWith(p,))) {
        return { title: c.siteName, description: c.siteDescription, siteName: c.siteName, image: c.logo, noindex: true, nofollow: true, };
    }

    let m = /^\/shop\/(collections|categories)\/([a-z0-9-]+)$/i.exec(path,);
    if (m) return shopGroup(c, m[1] as 'collections' | 'categories', m[2],);
    m = /^\/shop\/([a-z0-9-]+)$/i.exec(path,);
    if (m) return product(c, m[1],);
    m = /^\/events\/([a-z0-9-]+)$/i.exec(path,);
    if (m) return event(c, m[1],);
    m = /^\/forms\/([a-z0-9-]+)$/i.exec(path,);
    if (m) return form(c, m[1],);
    m = /^\/watch\/([0-9a-f-]+)$/i.exec(path,);
    if (m) return watch(c, m[1],);
    m = /^\/mail\/([0-9a-f-]+)$/i.exec(path,);
    if (m) return mailView(c, m[1],);
    return null;
}
