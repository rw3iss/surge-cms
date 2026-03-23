import { Request, Response, Router, } from 'express';
import { query, } from '../db';
import { cache, } from '../services/cache';
import { logger, } from '../utils/logger';

const router = Router();

const SITE_URL = 'https://surgemedia.us';
const CACHE_KEY = 'sitemap:xml';
const CACHE_TTL = 3600; // 1 hour

interface SitemapRow {
    slug: string;
    updated_at: string;
}

function escapeXml(str: string,): string {
    return str
        .replace(/&/g, '&amp;',)
        .replace(/</g, '&lt;',)
        .replace(/>/g, '&gt;',)
        .replace(/"/g, '&quot;',)
        .replace(/'/g, '&apos;',);
}

function formatDate(date: string,): string {
    return new Date(date,).toISOString().split('T',)[0];
}

function urlEntry(loc: string, lastmod?: string, changefreq?: string, priority?: number,): string {
    let entry = `  <url>\n    <loc>${escapeXml(loc,)}</loc>\n`;
    if (lastmod) {
        entry += `    <lastmod>${formatDate(lastmod,)}</lastmod>\n`;
    }
    if (changefreq) {
        entry += `    <changefreq>${changefreq}</changefreq>\n`;
    }
    if (priority !== undefined) {
        entry += `    <priority>${priority.toFixed(1,)}</priority>\n`;
    }
    entry += '  </url>\n';
    return entry;
}

async function generateSitemap(): Promise<string> {
    // Query all public content in parallel
    const [pagesResult, postsResult, campaignsResult, formsResult,] = await Promise.all([
        query<SitemapRow>(
            `SELECT slug, updated_at FROM pages WHERE status = 'published' AND is_private = false AND is_homepage = false ORDER BY updated_at DESC`,
        ),
        query<SitemapRow>(
            `SELECT slug, updated_at FROM posts WHERE status = 'published' AND is_private = false ORDER BY updated_at DESC`,
        ),
        query<SitemapRow>(
            `SELECT slug, updated_at FROM campaigns WHERE status = 'active' AND is_published = true ORDER BY updated_at DESC`,
        ),
        query<SitemapRow>(
            `SELECT slug, updated_at FROM forms WHERE status = 'published' ORDER BY updated_at DESC`,
        ),
    ],);

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    // Static pages
    xml += urlEntry(`${SITE_URL}/`, undefined, 'daily', 1.0,);
    xml += urlEntry(`${SITE_URL}/donate`, undefined, 'weekly', 0.8,);
    xml += urlEntry(`${SITE_URL}/contact`, undefined, 'monthly', 0.6,);
    xml += urlEntry(`${SITE_URL}/posts`, undefined, 'daily', 0.8,);
    xml += urlEntry(`${SITE_URL}/join`, undefined, 'monthly', 0.7,);

    // Dynamic pages
    for (const page of pagesResult.rows) {
        xml += urlEntry(`${SITE_URL}/${page.slug}`, page.updated_at, 'weekly', 0.8,);
    }

    // Posts
    for (const post of postsResult.rows) {
        xml += urlEntry(`${SITE_URL}/posts/${post.slug}`, post.updated_at, 'weekly', 0.7,);
    }

    // Campaigns
    for (const campaign of campaignsResult.rows) {
        xml += urlEntry(`${SITE_URL}/campaigns/${campaign.slug}`, campaign.updated_at, 'weekly', 0.6,);
    }

    // Forms
    for (const form of formsResult.rows) {
        xml += urlEntry(`${SITE_URL}/forms/${form.slug}`, form.updated_at, 'monthly', 0.5,);
    }

    xml += '</urlset>';
    return xml;
}

router.get('/sitemap.xml', async (_req: Request, res: Response,) => {
    try {
        // Check cache first
        const cached = await cache.get<string>(CACHE_KEY,);
        if (cached) {
            res.set('Content-Type', 'application/xml',);
            res.send(cached,);
            return;
        }

        const xml = await generateSitemap();

        // Cache for 1 hour
        await cache.set(CACHE_KEY, xml, CACHE_TTL,);

        res.set('Content-Type', 'application/xml',);
        res.send(xml,);
    } catch (error) {
        logger.error('Error generating sitemap', { error, },);
        res.status(500,).set('Content-Type', 'application/xml',).send(
            '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
        );
    }
},);

export default router;
