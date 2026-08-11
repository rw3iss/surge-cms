import type { Request, Response, } from 'express';

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

/** Cache-Control for an anonymous public HTML document.
 *
 *  `no-cache` = a shared cache (Cloudflare) / browser MAY store the document but
 *  MUST revalidate with the origin before serving it. Crucially it NEVER serves a
 *  STALE copy — which is what broke hard refreshes: the previous policy let the
 *  CDN serve a stale HTML shell (with the PREVIOUS build's hashed `<script>` src)
 *  for up to 10 min after a deploy; because the deploy replaces `dist/assets`
 *  (old hashes gone), that shell's entry-module import 404s, the module never
 *  runs, and #root keeps only the SSR body (a blank/minimal page) until a manual
 *  reload fetched the fresh shell. Revalidating every time keeps the shell in
 *  lockstep with the assets it references. (Hashed JS/CSS assets stay
 *  `immutable`, 1y — they never change under a fixed hash.) If a heavier edge
 *  micro-cache is wanted later, pair a short `s-maxage` with a Cloudflare
 *  cache-purge on deploy so a stale shell is never served past a release. */
export const PUBLIC_HTML_CACHE_CONTROL = 'no-cache';

/** Apply the public-HTML edge-cache headers to a response.
 *  Also collapses `Vary` to just `Accept-Encoding`: the CORS middleware adds
 *  `Vary: Origin`, and a CDN (Cloudflare) treats any Vary other than
 *  Accept-Encoding as uncacheable. Anonymous public HTML is same-origin
 *  navigation, so Origin-varying is unnecessary on these responses. */
export function applyPublicHtmlCacheHeaders(res: Response,): void {
    res.setHeader('Cache-Control', PUBLIC_HTML_CACHE_CONTROL,);
    res.setHeader('Vary', 'Accept-Encoding',);
}
