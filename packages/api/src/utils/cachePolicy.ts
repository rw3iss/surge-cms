import type { Request, } from 'express';

/**
 * Edge-cache policy for public HTML documents (see docs/deploy cache rules).
 *
 * A short micro-cache of anonymous public pages lets a CDN (Cloudflare) absorb
 * traffic spikes so the origin only renders each hot page ~once per TTL. Two
 * things must agree for it to work, so both read THIS predicate:
 *   1. The CSRF middleware must NOT emit a `Set-Cookie` on a cacheable page — a
 *      Set-Cookie makes the CDN refuse to cache, and a cached page must never
 *      carry one user's cookie.
 *   2. The SSR/SPA response must send a cacheable `Cache-Control` (not no-store).
 *
 * Cacheable == anonymous (no auth cookie / Authorization header) GET to a public
 * route that isn't personalized or state-changing. Logged-in users, admin, API,
 * auth flows, cart/checkout, search and account pages stay `no-store`. The CSP
 * carried by the document is plugin-config-derived (deterministic, no per-request
 * nonce), so a cached copy is correct for every anonymous visitor; a plugin change
 * propagates within the TTL.
 */

// Prefixes that are dynamic/personalized/state-changing even for anonymous users.
const DYNAMIC_PREFIXES = [
    '/api/',
    '/admin',
    '/setup',
    '/shop/cart',
    '/shop/checkout',
    '/shop/orders',
    '/account',
    '/profile',
    '/u/', // token unsubscribe
];

// Exact public paths that are query/state driven — not worth caching (and could
// cache-poison on query strings).
const DYNAMIC_EXACT = new Set(['/login', '/join', '/search',],);

/** Anonymous public HTML GET that is safe to edge-cache for a short TTL. */
export function isCacheablePublicHtml(req: Request,): boolean {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    if (req.headers.authorization) return false; // machine / API-key client
    if (req.cookies?.['accessToken']) return false; // logged-in → personalized, keep fresh
    const p = req.path;
    if (DYNAMIC_EXACT.has(p,)) return false;
    if (DYNAMIC_PREFIXES.some((pre,) => p === pre || p.startsWith(pre,))) return false;
    return true;
}

/** Cache-Control for an edge-cacheable anonymous public HTML document.
 *  Browser always revalidates (max-age=0) but the CDN serves a 60s edge copy
 *  and can serve stale for up to 10 min while it revalidates in the background. */
export const PUBLIC_HTML_CACHE_CONTROL = 'public, max-age=0, s-maxage=60, stale-while-revalidate=600';
