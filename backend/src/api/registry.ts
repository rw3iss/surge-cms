import { Router, } from 'express';
import type { NextFunction, RequestHandler, Response, } from 'express';
import type { AuthTier, } from '@rw/shared';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import { auditFromRequest, } from '../services/types';
import { isReply, } from './types';
import type { RouteDef, } from './types';

interface ModuleEntry {
    module: string;
    defs: RouteDef[];
}

const registry: ModuleEntry[] = [];

/** Middlewares enforcing each auth tier. `apiKey` is admin-equivalent
 *  until Phase 2 lands real API-key verification. */
export function authMiddlewaresFor(tier: AuthTier,): RequestHandler[] {
    switch (tier) {
        case 'public': return [];
        case 'optional': return [authenticate(false,),];
        case 'user': return [authenticate(),];
        case 'admin': return [authenticate(), requireAdmin,];
        case 'apiKey': return [authenticate(), requireAdmin,];
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
            };
            const result = await def.handler(ctx as never,);
            if (def.raw || res.headersSent) return;
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
        router[def.method](def.path, ...authMiddlewaresFor(def.auth,), wrap(def,),);
    }
    return router;
}

/** Mount a module's routes and record them in the manifest. */
export function registerModule(module: string, defs: RouteDef[],): Router {
    registry.push({ module, defs, },);
    return buildRouter(defs,);
}

/** Machine-readable manifest — consumed by the docs generator (Phase 4)
 *  and the client SDK generator (follow-up project). */
export function manifest() {
    return registry.map((entry,) => ({
        module: entry.module,
        routes: entry.defs.map((d,) => ({
            method: d.method.toUpperCase(),
            path: d.path,
            auth: d.auth,
            summary: d.summary,
        })),
    }));
}
