/**
 * One address per page.
 *
 * Google Search Console reported "Duplicate without user-selected canonical"
 * for this site, and a `<link rel="canonical">` did not settle it — a canonical
 * tag is a HINT the crawler may disregard when two URLs both answer 200 with
 * the same body. A 301 is not a hint.
 *
 * Two duplicates existed, both invisible from the browser because nothing links
 * to them:
 *
 * **`/index.html`** — `express.static` serves the SPA shell by its real
 * filename, ahead of the SSR renderer. So the homepage had a second crawlable
 * address that returned the UNRENDERED shell: title "SiteSurge", no canonical
 * tag, no content. Worse than a plain duplicate, because the copy Google might
 * have kept is the empty one.
 *
 * **Trailing slashes** — `/about/` and `/about` both rendered. The SPA router
 * treats them as one route, so nothing in the app ever noticed.
 *
 * Deliberately in the app and not in nginx: Docker and `@sitesurge/server`
 * consumers have no nginx config of ours, and a canonical-URL rule that only
 * applies to one deployment is a rule that silently does not apply.
 */
import type { NextFunction, Request, Response, } from 'express';

/**
 * Prefixes this middleware must not touch.
 *
 * `/api/` is data, not pages. The rest are static mounts that are registered
 * BEFORE this middleware and so normally never reach it — they are listed
 * anyway, because relying on mount order to protect a redirect rule is exactly
 * the kind of coupling that breaks when someone reorders `app.ts`.
 */
const SKIP_PREFIXES = ['/api/', '/assets/', '/uploads/', '/avatars/',];

/** Strip every trailing slash, but never reduce the path to empty. */
export function canonicalPath(pathname: string,): string {
    if (pathname === '/index.html') return '/';
    if (pathname.length > 1 && pathname.endsWith('/',)) {
        const trimmed = pathname.replace(/\/+$/, '',);
        return trimmed === '' ? '/' : trimmed;
    }
    return pathname;
}

/**
 * Decide the redirect target for a request, or null to leave it alone.
 *
 * Split out from the middleware so the rules are unit-testable without an
 * Express request/response pair.
 */
export function canonicalRedirect(
    method: string,
    originalUrl: string,
): string | null {
    // Only safe methods. A 301 on a POST invites clients to replay it as a GET
    // and lose the body; there is no SEO reason to rewrite one either.
    if (method !== 'GET' && method !== 'HEAD') return null;

    const qIndex = originalUrl.search(/[?#]/,);
    const pathname = qIndex === -1 ? originalUrl : originalUrl.slice(0, qIndex,);
    const suffix = qIndex === -1 ? '' : originalUrl.slice(qIndex,);

    if (SKIP_PREFIXES.some(p => pathname.startsWith(p,),)) return null;

    const next = canonicalPath(pathname,);
    if (next === pathname) return null;
    return next + suffix;
}

/** Express middleware form of {@link canonicalRedirect}. */
export function canonicalUrlMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
): void {
    const target = canonicalRedirect(req.method, req.originalUrl,);
    if (!target) return next();
    // 301, not 302: the whole point is to tell crawlers the old address is not
    // coming back, so link equity consolidates on the canonical one.
    res.redirect(301, target,);
}
