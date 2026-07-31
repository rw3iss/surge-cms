import type { NextFunction, Request, Response, } from 'express';
import fs from 'fs';
import path from 'path';
import { renderPublicRoute, } from '../services/ssr';
import { applyPublicHtmlCacheHeaders, isCacheablePublicHtml, } from '../utils/cachePolicy';
import { logger, } from '../utils/logger';

/**
 * SSR middleware that serves the frontend HTML with server-rendered meta tags
 * for public routes. Delegates static assets (JS/CSS/images) to express.static.
 */
export function createSsrMiddleware(distDir: string,) {
    const distExists = fs.existsSync(path.join(distDir, 'index.html',),);
    if (!distExists) {
        logger.warn(`SSR: dist directory not found at ${distDir} — SSR disabled`,);
        // Return a no-op middleware
        return (_req: Request, _res: Response, next: NextFunction,) => next();
    }

    logger.info(`SSR: Enabled, serving from ${distDir}`,);

    return async (req: Request, res: Response, next: NextFunction,) => {
        // Only handle GET requests
        if (req.method !== 'GET') return next();

        // Only accept HTML responses (skip AJAX/JSON requests)
        const accept = req.headers.accept || '';
        if (!accept.includes('text/html',) && accept !== '*/*') return next();

        const pathname = req.path;

        // Let express.static handle existing files (JS, CSS, images, etc.)
        const filePath = path.join(distDir, pathname,);
        if (pathname !== '/' && fs.existsSync(filePath,) && fs.statSync(filePath,).isFile()) {
            return next();
        }

        try {
            const html = await renderPublicRoute(pathname, distDir,);
            if (html === null) {
                // Not a public route — let the SPA fallback or other handlers take over
                return next();
            }

            // Anonymous public pages get a short edge micro-cache so a CDN
            // absorbs traffic spikes (origin renders each hot page ~once/TTL).
            // Logged-in/admin/dynamic requests stay no-store (fresh). The CSP is
            // plugin-config-derived (no per-request nonce), so a cached copy is
            // correct for every anonymous visitor; a plugin change propagates
            // within the TTL. Hashed JS/CSS assets are cached separately (1y).
            res.status(200,).setHeader('Content-Type', 'text/html; charset=utf-8',);
            if (isCacheablePublicHtml(req,)) applyPublicHtmlCacheHeaders(res,);
            else res.setHeader('Cache-Control', 'no-store',);
            res.send(html,);
        } catch (error) {
            logger.error('SSR error', { path: pathname, error: (error as Error).message, },);
            // Fall back to SPA (serve raw index.html)
            try {
                const fallback = fs.readFileSync(path.join(distDir, 'index.html',), 'utf-8',);
                res.status(200,)
                    .setHeader('Content-Type', 'text/html',)
                    .setHeader('Cache-Control', 'no-store',)
                    .send(fallback,);
            } catch {
                next();
            }
        }
    };
}
