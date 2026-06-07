import { Router, } from 'express';
import type { NextFunction, RequestHandler, Response, } from 'express';
import type { AuthTier, } from '@rw/cms-shared';
import { authenticate, AuthenticatedRequest, } from '../middleware/auth';
import { auditFromRequest, } from '../services/types';
import { adminOrApiKey, optionalOrApiKey, } from './apiKeyAuth';
import type { ApiKeyRequest, } from './apiKeyAuth';
import { isReply, } from './types';
import type { RouteDef, } from './types';

interface ModuleEntry {
    module: string;
    mountPath: string;
    defs: RouteDef[];
}

const registry: ModuleEntry[] = [];

/** Middlewares enforcing each auth tier. The `admin` and `apiKey` tiers
 *  both accept either an admin user JWT (cookie or Bearer) or a scoped
 *  `ssk_` API key via `adminOrApiKey()`; `apiKey` remains a semantic
 *  marker in the manifest for routes designed for machine clients. */
export function authMiddlewaresFor(tier: AuthTier,): RequestHandler[] {
    switch (tier) {
        case 'public': return [];
        case 'optional': return optionalOrApiKey();
        case 'user': return [authenticate(),];
        case 'admin': return adminOrApiKey();
        case 'apiKey': return adminOrApiKey();
    }
}

function wrap(def: RouteDef,): RequestHandler {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction,) => {
        try {
            const ctx = {
                req,
                res,
                user: req.user,
                userId: req.userId,
                params: def.input?.params ? def.input.params.parse(req.params,) : req.params,
                query: def.input?.query ? def.input.query.parse(req.query,) : req.query,
                body: def.input?.body ? def.input.body.parse(req.body,) : req.body,
                audit: () => auditFromRequest(req,),
                apiKey: (req as ApiKeyRequest).apiKey,
            };
            const result = await def.handler(ctx as never,);
            // Two escape hatches. `def.raw` is the declared opt-out: the
            // handler owns the response (streams, redirects, XML, webhooks)
            // and we never shape it. `res.headersSent` is the defensive
            // catch for a non-raw handler that wrote to res anyway — bail
            // rather than crash with ERR_HTTP_HEADERS_SENT.
            if (def.raw || res.headersSent) return;
            if (result === undefined) {
                return next(new Error(
                    `Handler for ${def.method.toUpperCase()} ${def.path} returned undefined; raw handlers must set raw: true`,
                ),);
            }
            if (isReply(result,)) {
                const payload: Record<string, unknown> = { success: true, data: result.data, };
                if (result.meta) payload.meta = result.meta;
                return res.status(result.status ?? 200,).json(payload,);
            }
            res.json({ success: true, data: result, },);
        } catch (err) {
            // Everything funnels into middleware/error.ts — the single
            // place that maps AppError / ZodError / pg codes to the
            // shared ApiResponse error envelope.
            next(err,);
        }
    };
}

/** Build an Express router from route definitions WITHOUT registering
 *  them in the global manifest. Exposed for tests. */
export function buildRouter(defs: RouteDef[],): Router {
    const router = Router();
    for (const def of defs) {
        router[def.method](def.path, ...authMiddlewaresFor(def.auth,), ...(def.pre ?? []), wrap(def,),);
    }
    return router;
}

/** Mount a module's routes and record them in the manifest.
 *
 *  `mountPath` is the absolute prefix the returned router is mounted
 *  under (e.g. '/api/v1/posts', or '/feed.xml' for the root-mounted
 *  raw modules). It can't be inferred — `routes/index.ts` mounts each
 *  router with its own `router.use(prefix, …)`, and app.ts mounts the
 *  raw modules at the site root — so the caller passes it and the
 *  manifest emits absolute paths from it.
 *
 *  Registration is idempotent by module name: re-registering a module
 *  REPLACES its entry rather than appending a duplicate. createApp can
 *  run more than once (tests, setup mode), and setup registers inside
 *  createApp, so without the dedupe the manifest would grow phantom
 *  duplicate entries. */
export function registerModule(module: string, defs: RouteDef[], opts: { mountPath: string, },): Router {
    const entry: ModuleEntry = { module, mountPath: opts.mountPath, defs, };
    const existing = registry.findIndex((e,) => e.module === module,);
    if (existing >= 0) {
        registry[existing] = entry;
    } else {
        registry.push(entry,);
    }
    return buildRouter(defs,);
}

/** Machine-readable manifest — consumed by the docs generator (Phase 4)
 *  and the client SDK generator (follow-up project). Input schemas are
 *  intentionally omitted from the emitted shape for now, but the registry
 *  retains the full RouteDefs (including live zod schemas), so those
 *  generators can read them later without rework. */
export function manifest() {
    return registry.map((entry,) => ({
        module: entry.module,
        mountPath: entry.mountPath,
        routes: entry.defs.map((d,) => ({
            method: d.method.toUpperCase(),
            path: d.path,
            // Absolute path = mountPath + the route's own path. A route
            // path of '/' contributes nothing (so a module mounted at
            // '/api/v1/posts' with a '/' route yields '/api/v1/posts',
            // not '/api/v1/posts/'); every other path appends verbatim
            // ('/slug/:slug' → '/api/v1/posts/slug/:slug').
            absolutePath: entry.mountPath + (d.path === '/' ? '' : d.path),
            auth: d.auth,
            summary: d.summary,
        })),
    }));
}
