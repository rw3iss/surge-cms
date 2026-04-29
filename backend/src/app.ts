import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Express, json, raw, urlencoded, } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import path from 'path';
import { config, } from './config';
import { csrfProtection, csrfToken, } from './middleware/csrf';
import { errorHandler, notFoundHandler, } from './middleware/error';
import { setupGate, } from './middleware/setupGate';
import { createSsrMiddleware, } from './middleware/ssr';
import routes from './routes';
import setupRoutes from './routes/setup';
import sitemapRoutes from './routes/sitemap';
import feedRoutes from './routes/feed';
import { logger, } from './utils/logger';

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
            contentSecurityPolicy: config.isProduction ?
                {
                    directives: {
                        defaultSrc: ["'self'",],
                        styleSrc: ["'self'", "'unsafe-inline'",],
                        scriptSrc: ["'self'",],
                        imgSrc: ["'self'", 'data:', 'blob:', 'https:',],
                        connectSrc: ["'self'", 'https://api.stripe.com',],
                        frameSrc: ["'self'", 'https://js.stripe.com',],
                    },
                } :
                false,
        },),
    );

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
            return config.isDevelopment
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

        app.use(sitemapRoutes,);
        app.use(`/api/${config.apiVersion}`, sitemapRoutes,);
        app.use(feedRoutes,);
        app.use(`/api/${config.apiVersion}`, feedRoutes,);
        app.use(`/api/${config.apiVersion}`, routes,);
    }

    // Setup routes are always mounted — in setup mode they're the only
    // thing that responds; in running mode they self-reject via
    // ensureSetupAllowed().
    app.use(`/api/${config.apiVersion}/setup`, setupRoutes,);

    // SSR + frontend serving. Same in both modes; the SPA handles its
    // own redirect to /setup based on the status endpoint.
    const distDir = path.resolve(process.cwd(), '../frontend/dist',);
    app.use(createSsrMiddleware(distDir,),);
    app.use(express.static(distDir, { index: false, },),);
    app.get('*', async (req, res, next,) => {
        if (req.path.startsWith('/api/',)) return next();
        try {
            const fs = await import('fs');
            const indexPath = path.join(distDir, 'index.html',);
            if (fs.existsSync(indexPath,)) {
                return res.sendFile(indexPath,);
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
