import type { AuthTier, ApiMeta, User, } from '@rw/shared';
import type { Request, Response, } from 'express';
import type { ZodType, } from 'zod';
import type { AuditContext, } from '../services/types';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** zod schemas validating the three request channels. Each is optional —
 *  an omitted channel passes through unvalidated (params default to
 *  Express's string map). */
export interface RouteInput {
    params?: ZodType;
    query?: ZodType;
    body?: ZodType;
}

/** What a route handler receives. Parsed inputs, the authenticated
 *  user (when the tier provides one), and an audit-context factory. */
export interface HandlerCtx<P = Record<string, string>, Q = Record<string, unknown>, B = unknown,> {
    req: Request;
    res: Response;
    user?: User;
    userId?: string;
    params: P;
    query: Q;
    body: B;
    audit: () => AuditContext;
}

const REPLY = Symbol('apiReply',);

/** Wrapper for handlers that need meta (pagination) or a non-200 status. */
export interface ApiReply<T = unknown,> {
    [REPLY]: true;
    data: T;
    meta?: ApiMeta;
    status?: number;
}

export function reply<T,>(data: T, opts: { meta?: ApiMeta; status?: number; } = {},): ApiReply<T> {
    return { [REPLY]: true, data, ...opts, };
}

export function isReply(value: unknown,): value is ApiReply {
    return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[REPLY] === true;
}

/** One declared endpoint. The registry mounts it AND emits it in the
 *  machine-readable manifest the docs generator / SDK generator read. */
export interface RouteDef {
    method: HttpMethod;
    path: string;
    auth: AuthTier;
    /** one-line human description, surfaced in docs/API.md */
    summary: string;
    input?: RouteInput;
    /** raw handlers write to `res` themselves (streams, redirects,
     *  XML, webhooks). The wrapper skips response shaping but still
     *  catches errors and registers the route in the manifest. */
    raw?: boolean;
    handler: (ctx: HandlerCtx<never, never, never>,) => Promise<unknown> | unknown;
}
