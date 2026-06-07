import type { NextFunction, Request, Response, } from 'express';
import fs from 'fs';
import path from 'path';
import { renderPublicRoute, } from '../services/ssr';
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

            res.status(200,)
                .setHeader('Content-Type', 'text/html; charset=utf-8',)
                .setHeader('Cache-Control', 'public, max-age=300, s-maxage=300',)
                .send(html,);
        } catch (error) {
            logger.error('SSR error', { path: pathname, error: (error as Error).message, },);
            // Fall back to SPA (serve raw index.html)
            try {
                const fallback = fs.readFileSync(path.join(distDir, 'index.html',), 'utf-8',);
                res.status(200,).setHeader('Content-Type', 'text/html',).send(fallback,);
            } catch {
                next();
            }
        }
    };
}
