import type { RequestHandler, } from 'express';
import type { z, ZodType, } from 'zod';
import type { AuthTier, } from '@rw/shared';
import type { HandlerCtx, HttpMethod, RouteDef, } from './types';

/**
 * Declare one API endpoint. Identity at runtime — the generics exist so
 * the handler's `params` / `query` / `body` are typed from the zod
 * schemas without manual annotation:
 *
 *   defineRoute({
 *       method: 'get', path: '/', auth: 'optional',
 *       summary: 'List posts',
 *       input: { query: listQuerySchema },
 *       handler: async ({ query, user }) => { ... },  // query is z.infer<typeof listQuerySchema>
 *   })
 */
export function defineRoute<
    P extends ZodType = ZodType<Record<string, string>>,
    Q extends ZodType = ZodType<Record<string, unknown>>,
    B extends ZodType = ZodType<unknown>,
>(def: {
    method: HttpMethod;
    path: string;
    auth: AuthTier;
    summary: string;
    input?: { params?: P; query?: Q; body?: B; };
    pre?: RequestHandler[];
    raw?: boolean;
    handler: (ctx: HandlerCtx<z.infer<P>, z.infer<Q>, z.infer<B>>,) => Promise<unknown> | unknown;
},): RouteDef {
    // Safe: the inline parameter type already structurally constrains the
    // input. This double cast only erases the generic-to-`never` variance
    // so the value can be stored in the non-generic RouteDef.
    return def as unknown as RouteDef;
}

export { reply, } from './types';
