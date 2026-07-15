import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Express, json, raw, urlencoded, } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import path from 'path';
import { existsSync, } from 'fs';
import { adminDistPath, } from '@sitesurge/admin';
import { config, } from './config';
import { pluginAwareCsp, } from './middleware/csp';
import { csrfProtection, csrfToken, } from './middleware/csrf';
import { errorHandler, notFoundHandler, } from './middleware/error';
import { setupGate, } from './middleware/setupGate';
import { createSsrMiddleware, } from './middleware/ssr';
import { registerModule, } from './api/registry';
import routes from './routes';
import { setupRoutes, } from './routes/setup';
import { sitemapRoutes, } from './routes/sitemap';
import { feedRoutes, } from './routes/feed';
import { unsubscribeRoutes, } from './routes/unsubscribe';
import { logger, } from './utils/logger';

/**
 * Resolve the built admin/public SPA directory.
 * - Installed: the `@sitesurge/admin` static-asset package ships the built SPA.
 * - Monorepo dev/build: fall back to the sibling package's `dist/`.
 */
function resolveAdminDist(): string {
    try {
        const p = adminDistPath();
        if (existsSync(path.join(p, 'index.html',),)) return p;
    } catch {
        // @sitesurge/admin not resolvable — fall through to the monorepo path.
    }
    return path.resolve(process.cwd(), '../cms/dist',);
}

/**
 * Mode-aware app factory.
 *
 * Setup mode mounts only `/api/v1/setup/*` and a CSRF-friendly minimal
 * pipeline; running mode mounts the full route set with crons (started
 * elsewhere). The `setupGate` middleware is always installed so a
 * lingering setup state at runtime still produces a clear 503 instead
 * of a 500 from a service that needed config.
 */

export type AppMode = 'setup' | 'running';

export function createApp(mode: AppMode = 'running',): Express {
    const app = express();

    app.set('trust proxy', 1,);

    app.use(
        helmet({
            crossOriginResourcePolicy: { policy: 'cross-origin', },
            // Helmet defaults COOP to `same-origin`, which severs `window.opener`
            // for any cross-origin popup the page opens. That breaks OAuth-popup
            // sign-in flows for embedded third-party widgets (e.g. the PageLoop
            // plugin): its cross-origin callback page can't postMessage the token
            // back to the opener, so the popup closes and the host never signs in.
            // `same-origin-allow-popups` keeps the opener reference alive for
            // popups this page opens while still isolating us as a popup victim.
            crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups', },
            // CSP is handled separately (pluginAwareCsp) so enabled plugins can
            // extend connect-src/etc. with the origins their widgets need.
            contentSecurityPolicy: false,
        },),
    );
    // Plugin-aware CSP — production only (matches the previous behavior:
    // no CSP in dev). Extended at runtime by enabled plugins.
    if (config.isProduction) app.use(pluginAwareCsp,);

    app.use(
        cors({
            origin: (origin, callback,) => {
                if (!origin) return callback(null, true,);
                if (config.corsOrigins.includes(origin,) || !config.isProduction) {
                    return callback(null, true,);
                }
                logger.warn('CORS blocked request', { origin, },);
                return callback(new Error('Not allowed by CORS',),);
            },
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS',],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token',],
        },),
    );

    app.use(compression(),);
    app.use(cookieParser(),);
    app.use(csrfToken,);

    const limiter = rateLimit({
        windowMs: config.rateLimit.windowMs,
        max: config.rateLimit.maxRequests,
        message: {
            success: false,
            error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later', },
        },
        standardHeaders: true,
        legacyHeaders: false,
        skip: (req,) => {
            // Only rate-limit the API. Static assets and SPA routes are served
            // by the same Node process, and a single page load pulls in dozens
            // of files (the PWA precaches ~130) — counting those would exhaust
            // the window on the first visit. Behind a proxy every client also
            // shares a small set of upstream IPs, so keep the ceiling generous.
            return config.isDevelopment
                || !req.path.startsWith('/api/',)
                || req.path.startsWith('/api/v1/health',)
                || req.path.startsWith('/api/v1/setup',);
        },
    },);
    app.use(limiter,);

    if (mode === 'running') {
        app.use('/api/v1/payments/webhook', raw({ type: 'application/json', },),);
    }
    app.use(json({ limit: '10mb', },),);
    app.use(urlencoded({ extended: true, limit: '10mb', },),);
    app.use(csrfProtection,);

    app.use((req, res, next,) => {
        const start = Date.now();
        res.on('finish', () => {
            const duration = Date.now() - start;
            logger.debug(`${req.method} ${req.path}`, {
                status: res.statusCode,
                duration: `${duration}ms`,
                ip: req.ip,
            },);
        },);
        next();
    },);

    // Setup gate runs BEFORE any business route, so a stale running-mode
    // state still rejects requests cleanly.
    app.use(setupGate,);

    if (mode === 'running') {
        app.use('/uploads', express.static(path.join(process.cwd(), config.upload.dir,),),);
        app.use('/avatars', express.static(path.resolve(config.dataDir, 'avatars',),),);

        // Sitemap routes carry their own literal paths ('/sitemap.xml',
        // '/admin/sitemap/regenerate'), so the canonical mount is the
        // site root — mountPath '' keeps absolutePaths equal to those
        // literals in the manifest. Mounted again under /api/v1 for the
        // aliased external URLs (the /api/v1/sitemap/* alias lives in
        // routes/index.ts as a plain router).
        const sitemapRouter = registerModule('sitemap', sitemapRoutes, { mountPath: '', },);
        app.use(sitemapRouter,);
        app.use(`/api/${config.apiVersion}`, sitemapRouter,);
        // The feed router has one '/' route; mounting it at '/feed.xml'
        // (and the /api/v1 alias) preserves the canonical external URLs.
        // registerModule once records the canonical mountPath in the
        // manifest; the returned router mounts at both external paths.
        const feedRouter = registerModule('feed', feedRoutes, { mountPath: '/feed.xml', },);
        app.use('/feed.xml', feedRouter,);
        app.use(`/api/${config.apiVersion}/feed.xml`, feedRouter,);
        // Token-based unsubscribe + double-opt-in confirmation live at
        // the public root (not under /api/v1) so URLs like
        // /u/<token> and /lists/<slug>/confirm/<token> stay short. Each
        // route carries its full literal path, so mountPath '' keeps the
        // manifest absolutePaths equal to those literals.
        app.use(registerModule('unsubscribe', unsubscribeRoutes, { mountPath: '', },),);
        app.use(`/api/${config.apiVersion}`, routes,);
    }

    // Setup routes are always mounted — in setup mode they're the only
    // thing that responds; in running mode they self-reject via
    // ensureSetupAllowed().
    app.use(`/api/${config.apiVersion}/setup`, registerModule('setup', setupRoutes, { mountPath: `/api/${config.apiVersion}/setup`, },),);

    // SSR + frontend serving. Same in both modes; the SPA handles its
    // own redirect to /setup based on the status endpoint.
    const distDir = resolveAdminDist();
    app.use(createSsrMiddleware(distDir,),);
    app.use(express.static(distDir, { index: false, },),);
    // Express 5 / path-to-regexp 8 no longer accept the bare '*' string route;
    // a RegExp catch-all matches every GET path with identical behavior.
    app.get(/.*/, async (req, res, next,) => {
        if (req.path.startsWith('/api/',)) return next();
        try {
            const fs = await import('fs');
            const indexPath = path.join(distDir, 'index.html',);
            if (fs.existsSync(indexPath,)) {
                // no-store (+ no etag/lastModified so there's no 304 that could
                // replay a stale CSP header): the SPA shell carries the
                // per-plugin CSP and must always be fetched fresh.
                res.setHeader('Cache-Control', 'no-store',);
                return res.sendFile(indexPath, { cacheControl: false, etag: false, lastModified: false, },);
            }
        } catch {
            // Fall through
        }
        next();
    },);

    app.use(notFoundHandler,);
    app.use(errorHandler,);

    return app;
}
