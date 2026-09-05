import crypto from 'crypto';
import { NextFunction, Request, Response, } from 'express';
import { isCacheablePublicHtml, } from '../utils/cachePolicy';

// Static-asset paths never need a CSRF cookie, and emitting a `Set-Cookie` on
// them stops a CDN (Cloudflare) from caching them at all. Skipping the cookie
// here lets /assets/*, /uploads/*, and hashed static files be edge-cached; real
// HTML documents and API responses (which the SPA reads the token from) still
// get it.
const STATIC_ASSET_EXT = /\.(?:js|mjs|css|map|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico|mp4|webm)$/i;
function isStaticAssetPath(p: string,): boolean {
    return p.startsWith('/assets/',)
        || p.startsWith('/uploads/',)
        || p.startsWith('/avatars/',)
        || STATIC_ASSET_EXT.test(p,);
}

// Generate CSRF token and set as cookie
export function csrfToken(req: Request, res: Response, next: NextFunction,) {
    // Skip on static assets AND edge-cacheable anonymous public HTML — a
    // Set-Cookie would stop the CDN from caching them. Anonymous visitors still
    // pick up the token from their first (uncached) /api call before any POST.
    if (!req.cookies['csrf-token'] && !isStaticAssetPath(req.path,) && !isCacheablePublicHtml(req,)) {
        const token = crypto.randomBytes(32,).toString('hex',);
        res.cookie('csrf-token', token, {
            httpOnly: false, // Must be readable by JS
            sameSite: 'strict',
            secure: process.env.NODE_ENV === 'production',
            path: '/',
        },);
    }
    next();
}

// Verify CSRF token on state-changing requests
export function csrfProtection(req: Request, res: Response, next: NextFunction,) {
    // Skip for safe methods
    if (['GET', 'HEAD', 'OPTIONS',].includes(req.method,)) {
        return next();
    }

    // Skip for Stripe webhooks (they have their own signature verification)
    if (req.path.includes('/payments/webhook',)) {
        return next();
    }

    // Skip for inbound provider webhooks. A print supplier POSTing to us cannot
    // carry our CSRF cookie or token, so the check would 403 every delivery.
    //
    // These do not ride on cookie ambient authority either: the caller is
    // unauthenticated and the endpoint's own credential is the high-entropy
    // token in the path (plus an HMAC signature where the provider offers one),
    // both verified in services/shop/providers/webhooks.ts.
    if (req.path.includes('/shop/webhooks/',)) {
        return next();
    }

    // Header-authenticated requests (Bearer JWT or API key) skip the
    // cookie CSRF check: a cross-site attacker cannot set the
    // Authorization header from a form/img/script tag, so there is no
    // cookie ambient authority to ride. The token itself is still
    // validated by the auth middleware downstream.
    if (req.headers.authorization?.startsWith('Bearer ',)) {
        return next();
    }

    const cookieToken = req.cookies['csrf-token'];
    const headerToken = req.headers['x-csrf-token'];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403,).json({
            success: false,
            error: { code: 'CSRF_ERROR', message: 'Invalid CSRF token', },
        },);
    }

    next();
}
