/**
 * sitemap.xml + admin regenerate.
 *
 * Mounted at the site root (so crawlers find `/sitemap.xml`), at
 * `/api/v1`, and under `/api/v1/sitemap` (routes/index.ts) — every
 * external URL is preserved. The cache + regenerate logic lives in
 * `services/sitemap.ts`; the GET handler is a raw XML responder, the
 * POST is a normal admin JSON handler.
 */
import { defineRoute, } from '../api/defineRoute';
import { EMPTY_SITEMAP_XML, getSitemapXml, regenerateSitemap, } from '../services/sitemap';
import { logger, } from '../utils/logger';

export const sitemapRoutes = [

    defineRoute({
        method: 'get', path: '/sitemap.xml', auth: 'public', raw: true,
        summary: 'sitemap.xml (application/xml) of published content.',
        handler: async ({ res, },) => {
            try {
                const xml = await getSitemapXml();
                res.set('Content-Type', 'application/xml',);
                res.send(xml,);
            } catch (error) {
                logger.error('Error generating sitemap', { error, },);
                res.status(500,).set('Content-Type', 'application/xml',).send(EMPTY_SITEMAP_XML,);
            }
        },
    },),

    defineRoute({
        method: 'post', path: '/admin/sitemap/regenerate', auth: 'admin',
        summary: 'Drop the cached sitemap, rebuild, and return the URL count.',
        handler: () => regenerateSitemap(),
    },),
];
