/**
 * Combined authenticator for admin-tier manifest routes: accepts an
 * admin user JWT (cookie or Bearer) OR an `ssk_` API key with
 * sufficient scope for the HTTP method (GET/HEAD → read+, mutations
 * → write+). API-key requests carry no user; downstream audit uses
 * the synthetic actor `api-key:<name>`.
 */
import type { NextFunction, RequestHandler, Response, } from 'express';
import { authenticate, AuthenticatedRequest, requireAdmin, } from '../middleware/auth';
import * as apiKeys from '../services/apiKeys';
import type { ApiKeyRow, } from '../services/apiKeys';

export interface ApiKeyRequest extends AuthenticatedRequest {
    apiKey?: ApiKeyRow;
}

export function adminOrApiKey(): RequestHandler[] {
    const jwtChain = [authenticate(), requireAdmin,];
    const combined = async (req: ApiKeyRequest, res: Response, next: NextFunction,) => {
        try {
            const header = req.headers.authorization;
            const token = header?.startsWith('Bearer ',) ? header.slice(7,) : undefined;

            if (token?.startsWith(apiKeys.KEY_PREFIX,)) {
                const key = await apiKeys.verify(token,);
                if (!key) {
                    return res.status(401,).json({
                        success: false,
                        error: { code: 'UNAUTHORIZED', message: 'Invalid or revoked API key', },
                    },);
                }
                const required = apiKeys.requiredScopeFor(req.method,);
                if (!apiKeys.scopeSatisfies(key.scopes, required,)) {
                    return res.status(403,).json({
                        success: false,
                        error: {
                            code: 'FORBIDDEN',
                            message: `API key lacks the '${required}' scope`,
                        },
                    },);
                }
                req.apiKey = key;
                // Synthetic actor for audit trails (logAudit folds
                // non-UUID actors into new_values.actor).
                req.userId = `api-key:${key.name}`;
                return next();
            }

            // Not an API key — run the standard JWT chain manually.
            jwtChain[0](req, res, (err?: unknown,) => {
                if (err) return next(err,);
                if (res.headersSent) return;
                jwtChain[1](req, res, next,);
            },);
        } catch (err) {
            next(err,);
        }
    };
    return [combined as RequestHandler,];
}

/** Optional-tier authenticator: a valid `ssk_` key authenticates the
 *  request as a machine client (req.apiKey set, synthetic userId);
 *  an invalid key fails loudly with 401 (never silently anonymous);
 *  everything else falls through to optional JWT auth. */
export function optionalOrApiKey(): RequestHandler[] {
    const optionalJwt = authenticate(false,);
    const combined = async (req: ApiKeyRequest, res: Response, next: NextFunction,) => {
        try {
            const header = req.headers.authorization;
            const token = header?.startsWith('Bearer ',) ? header.slice(7,) : undefined;
            if (token?.startsWith(apiKeys.KEY_PREFIX,)) {
                const key = await apiKeys.verify(token,);
                if (!key) {
                    return res.status(401,).json({
                        success: false,
                        error: { code: 'UNAUTHORIZED', message: 'Invalid or revoked API key', },
                    },);
                }
                req.apiKey = key;
                req.userId = `api-key:${key.name}`;
                return next();
            }
            optionalJwt(req, res, next,);
        } catch (err) {
            next(err,);
        }
    };
    return [combined as RequestHandler,];
}
