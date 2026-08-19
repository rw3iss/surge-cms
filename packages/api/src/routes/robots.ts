/**
 * robots.txt — served dynamically so the `Sitemap:` line always points at THIS
 * install's domain.
 *
 * It used to be a static file (`packages/cms/public/robots.txt`) with a
 * hardcoded sitemap URL, which shipped to every install and, on surgemedia.us,
 * pointed crawlers at a completely different site's sitemap. A static file can
 * never know its own domain; this route reads `config.frontendUrl`, the same
 * source `services/sitemap.ts` uses, so the two can't drift.
 *
 * Mounted at the site root (crawlers only ever fetch `/robots.txt`) BEFORE the
 * static-file middleware, so it wins over any leftover file on disk.
 */
import { config, } from '../config';
import { defineRoute, } from '../api/defineRoute';

/** Paths that must never be indexed. Kept in step with the `noindex` route list
 *  in `services/ssr/routes.ts` — a crawler shouldn't spend budget on them. */
const DISALLOWED = [
    '/admin',
    '/api/',
    '/login',
    '/join',
    '/subscribe',
    '/search',
    '/profile',
    '/verify',
    '/u/', // one-click unsubscribe tokens
];

export function buildRobotsTxt(siteUrl: string,): string {
    const base = siteUrl.replace(/\/+$/, '',);
    return [
        'User-agent: *',
        'Allow: /',
        ...DISALLOWED.map((p,) => `Disallow: ${p}`),
        '',
        `Sitemap: ${base}/sitemap.xml`,
        '',
    ].join('\n',);
}

export const robotsRoutes = [
    defineRoute({
        method: 'get', path: '/robots.txt', auth: 'public', raw: true,
        summary: 'robots.txt with this install\'s canonical sitemap URL.',
        handler: ({ res, },) => {
            res.set('Content-Type', 'text/plain; charset=utf-8',);
            res.set('Cache-Control', 'public, max-age=3600',);
            res.send(buildRobotsTxt(config.frontendUrl,),);
        },
    },),
];
