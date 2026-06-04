# Headless API Foundation Implementation Plan (Phase 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the typed route-manifest framework (defineRoute/registry), centralize the API contract in `@rw/shared`, fix CSRF for Bearer clients, and convert the **posts** module end-to-end (service + manifest routes + normalized paths + frontend update) as the pilot that all later modules copy.

**Architecture:** Routes become declarative `defineRoute()` manifests that a registry mounts onto Express and can emit as a machine-readable manifest. All business logic moves into `backend/src/services/<module>.ts` (evolved from the old `sdk/` modules — the `cms.*` aggregate survives as a re-export). All wire types live in `@rw/shared` under `shared/src/api/`. Errors funnel exclusively through the central error middleware.

**Tech Stack:** Express 4, zod, vitest + supertest (new devDeps), TypeScript, npm workspaces (`shared` → `@rw/shared`).

**Spec:** `docs/superpowers/specs/2026-06-04-headless-api-design.md`. This plan covers spec Phase 1 only. Phases 2 (API keys), 3 (module sweep), 4 (docs generation) get their own plans after this one lands, copying the pilot pattern.

**Conventions for this codebase (read before starting):**
- Trailing commas inside call/type argument lists — match the existing style (`fn(arg,)`, `z.string().min(1,)`). Mimic surrounding code.
- 4-space indentation in backend/shared TS.
- No ORM; repositories own SQL. Services own cache invalidation, audit logging, sanitization, orchestration.
- Build commands: `npm run build -w shared`, `npm run build -w backend`, `npm run build -w frontend` (run from repo root `/home/rw3iss/Sites/rw/rw-cms`).
- Tests: `npm test -w backend -- --run` (vitest; `--run` disables watch mode).
- Commit after every task. Brief commit messages, no Co-Authored-By lines.

---

### Task 1: Shared API contract module (`shared/src/api/`)

Centralize all wire-format types. The existing `shared/src/types/api.ts` moves to `shared/src/api/contract.ts` (same exported names — frontend imports keep working), plus a new `ErrorCode` union and auth-tier types.

**Files:**
- Create: `shared/src/api/contract.ts`
- Create: `shared/src/api/auth.ts`
- Create: `shared/src/api/index.ts`
- Create: `shared/src/api/routes/posts.ts`
- Delete: `shared/src/types/api.ts`
- Modify: `shared/src/types/index.ts` (remove the `./api` export)
- Modify: `shared/src/index.ts`

- [ ] **Step 1: Create `shared/src/api/contract.ts`**

Content = everything currently in `shared/src/types/api.ts`, with `ApiErrorCode` replaced by the canonical `ErrorCode` (keep an `ApiErrorCode` alias so nothing breaks):

```ts
/**
 * Wire contract shared by the backend, the bundled frontend, and any
 * future client SDK. Every /api/v1 endpoint responds in this envelope.
 */

export interface ApiResponse<T = unknown,> {
    success: boolean;
    data?: T;
    error?: ApiError;
    meta?: ApiMeta;
}

export interface ApiError {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
}

export interface ApiMeta {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
}

export interface PaginationParams {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

export interface SearchParams extends PaginationParams {
    query?: string;
    filters?: Record<string, unknown>;
}

export interface CacheInfo {
    cached: boolean;
    cachedAt?: Date;
    expiresAt?: Date;
    etag?: string;
}

/**
 * Every error code the API emits. Clients switch on these — adding a
 * code is fine, renaming or removing one is a breaking change.
 *
 * Note: the old `DUPLICATE` and `REFERENCE_ERROR` codes (emitted by the
 * legacy per-route handler) are consolidated into `CONFLICT` and
 * `BAD_REQUEST` as routes migrate to the manifest framework.
 */
export const ERROR_CODES = [
    'UNAUTHORIZED',
    'FORBIDDEN',
    'NOT_FOUND',
    'VALIDATION_ERROR',
    'CONFLICT',
    'RATE_LIMITED',
    'BAD_REQUEST',
    'INTERNAL_ERROR',
    'SERVICE_UNAVAILABLE',
    'CSRF_ERROR',
    'CONTENT_LOCKED',
    'SERVICE_NOT_CONFIGURED',
    'ALREADY_INSTALLED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/** @deprecated use ErrorCode */
export type ApiErrorCode = ErrorCode;

export interface ValidationError {
    field: string;
    message: string;
    code: string;
}
```

Note: `ApiError.code` is now typed `ErrorCode` instead of `string`. If the backend build later complains about a legacy route assigning an arbitrary string, widen at the assignment site with `as ErrorCode` — do NOT widen the shared type.

- [ ] **Step 2: Create `shared/src/api/auth.ts`**

```ts
/**
 * Auth tiers every API route declares. The route framework enforces
 * them; the docs generator and client SDK read them.
 *
 *   public   — no auth.
 *   optional — anon OK; response is shaped by role when a user is present
 *              (admins see drafts, members unlock gated content).
 *   user     — any authenticated user (Bearer JWT or cookie).
 *   admin    — admin/sysadmin role required.
 *   apiKey   — admin-equivalent access for standalone clients via API
 *              key (Phase 2). Until then it behaves like `admin`.
 */
export const AUTH_TIERS = ['public', 'optional', 'user', 'admin', 'apiKey',] as const;

export type AuthTier = (typeof AUTH_TIERS)[number];

export const API_KEY_SCOPES = ['read', 'write', 'admin',] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
```

- [ ] **Step 3: Create `shared/src/api/routes/posts.ts`** (per-endpoint DTO types the future client SDK imports)

```ts
/**
 * Wire DTOs for the /posts module. Plain types only — the zod schemas
 * that validate them live next to the route definitions in
 * `backend/src/routes/posts.ts`.
 */

/** Query accepted by GET /posts. */
export interface PostListQuery {
    page?: number;
    limit?: number;
    /** public filters */
    tag?: string;
    category?: string;
    search?: string;
    /** ISO dates — published-before / published-after */
    before?: string;
    after?: string;
    /** comma-separated post ids (pinned feeds) */
    ids?: string;
    /** '1' | 'true' to include content blocks in list items */
    withBlocks?: string;
    /** admin-only: presence of status or sort switches to the admin
     *  (all-statuses) listing. 'all' or '' means no status filter. */
    status?: string;
    sort?: string;
}

/** details payload on a CONTENT_LOCKED error from GET /posts/slug/:slug */
export interface ContentLockedDetails {
    locked: true;
    accessLevel: string;
    preview: {
        title: string;
        description: string | null;
        featuredImage: string | null;
    };
}
```

- [ ] **Step 4: Create `shared/src/api/index.ts`**

```ts
export * from './auth';
export * from './contract';
export * from './routes/posts';
```

- [ ] **Step 5: Move the old file out**

Delete `shared/src/types/api.ts`. In `shared/src/types/index.ts`, remove the line exporting `'./api'` (keep all other exports). In `shared/src/index.ts`, add the api export:

```ts
export * from './api';
export * from './types';
export * from './utils';
```

- [ ] **Step 6: Build shared + dependents to verify nothing broke**

Run: `npm run build -w shared && npm run build -w backend && npm run build -w frontend`
Expected: all three compile. If the backend errors on `ApiError.code` strictness, fix the offending assignment with a cast as described in Step 1.

- [ ] **Step 7: Commit**

```bash
git add shared/src backend frontend
git commit -m "feat(shared): centralize API contract — shared/src/api with ErrorCode + AuthTier"
```

---

### Task 2: Move SDK context types to `services/types.ts`

The service layer becomes canonical; `sdk/types.ts` becomes a re-export shim so the ~10 existing `from './types'` imports inside `sdk/` and any `from '../sdk'` imports keep compiling during the sweep.

**Files:**
- Create: `backend/src/services/types.ts`
- Modify: `backend/src/sdk/types.ts` (reduce to a shim)

- [ ] **Step 1: Create `backend/src/services/types.ts`**

Copy the ENTIRE current content of `backend/src/sdk/types.ts` (the `PaginationOpts`, `ListResult`, `AuditContext`, `auditFromRequest`, `Service` definitions) into `backend/src/services/types.ts` unchanged.

- [ ] **Step 2: Reduce `backend/src/sdk/types.ts` to a shim**

Replace its entire content with:

```ts
/**
 * Shim — the canonical service-layer contract now lives in
 * `services/types.ts`. This re-export keeps legacy `sdk/` imports
 * compiling while modules migrate (spec: 2026-06-04-headless-api-design).
 */
export * from '../services/types';
```

- [ ] **Step 3: Build + commit**

Run: `npm run build -w backend`
Expected: compiles (the shim preserves every export).

```bash
git add backend/src/services/types.ts backend/src/sdk/types.ts
git commit -m "refactor(backend): service-layer contract types move to services/types.ts"
```

---

### Task 3: Test harness + CSRF Bearer exemption (TDD)

vitest is in backend devDeps but has no config and zero tests. Set it up, then fix CSRF test-first.

**Files:**
- Create: `backend/vitest.config.ts`
- Create: `backend/src/middleware/csrf.test.ts`
- Modify: `backend/src/middleware/csrf.ts:19-41`

- [ ] **Step 1: Install supertest (used in Task 4) and create vitest config**

Run: `npm install -D supertest @types/supertest -w backend`

Create `backend/vitest.config.ts`:

```ts
import { defineConfig, } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts',],
    },
},);
```

- [ ] **Step 2: Write the failing test** — `backend/src/middleware/csrf.test.ts`

```ts
import { describe, expect, it, vi, } from 'vitest';
import { csrfProtection, } from './csrf';

function run(req: Record<string, unknown>,) {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), };
    const next = vi.fn();
    csrfProtection(req as never, res as never, next,);
    return { res, next, };
}

describe('csrfProtection', () => {
    it('skips the cookie check for Bearer-authenticated requests', () => {
        const { res, next, } = run({
            method: 'POST',
            path: '/api/v1/posts',
            headers: { authorization: 'Bearer some-jwt-or-api-key', },
            cookies: {},
        },);
        expect(next,).toHaveBeenCalledOnce();
        expect(res.status,).not.toHaveBeenCalled();
    },);

    it('still blocks cookie-auth clients without a CSRF token', () => {
        const { res, next, } = run({
            method: 'POST',
            path: '/api/v1/posts',
            headers: {},
            cookies: {},
        },);
        expect(next,).not.toHaveBeenCalled();
        expect(res.status,).toHaveBeenCalledWith(403,);
    },);

    it('passes cookie-auth clients with matching tokens', () => {
        const { next, } = run({
            method: 'POST',
            path: '/api/v1/posts',
            headers: { 'x-csrf-token': 'tok', },
            cookies: { 'csrf-token': 'tok', },
        },);
        expect(next,).toHaveBeenCalledOnce();
    },);

    it('skips safe methods', () => {
        const { next, } = run({ method: 'GET', path: '/x', headers: {}, cookies: {}, },);
        expect(next,).toHaveBeenCalledOnce();
    },);
},);
```

- [ ] **Step 3: Run to verify the first test fails**

Run: `npm test -w backend -- --run src/middleware/csrf.test.ts`
Expected: FAIL — "skips the cookie check for Bearer-authenticated requests" (csrf currently 403s it); other three PASS.

- [ ] **Step 4: Implement the exemption** in `backend/src/middleware/csrf.ts`

Insert after the webhook skip (after line 28, before `const cookieToken = …`):

```ts
    // Header-authenticated requests (Bearer JWT or API key) skip the
    // cookie CSRF check: a cross-site attacker cannot set the
    // Authorization header from a form/img/script tag, so there is no
    // cookie ambient authority to ride. The token itself is still
    // validated by the auth middleware downstream.
    if (req.headers.authorization?.startsWith('Bearer ',)) {
        return next();
    }
```

- [ ] **Step 5: Run tests to verify all pass**

Run: `npm test -w backend -- --run src/middleware/csrf.test.ts`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/vitest.config.ts backend/src/middleware/csrf.test.ts backend/src/middleware/csrf.ts backend/package.json package-lock.json
git commit -m "feat(backend): vitest harness; CSRF exempts Bearer-authenticated requests"
```

---

### Task 4: Route framework — defineRoute, registry, manifest (TDD)

**Files:**
- Create: `backend/src/api/types.ts`
- Create: `backend/src/api/defineRoute.ts`
- Create: `backend/src/api/registry.ts`
- Create: `backend/src/api/registry.test.ts`

- [ ] **Step 1: Create `backend/src/api/types.ts`**

```ts
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
```

- [ ] **Step 2: Create `backend/src/api/defineRoute.ts`**

```ts
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
    raw?: boolean;
    handler: (ctx: HandlerCtx<z.infer<P>, z.infer<Q>, z.infer<B>>,) => Promise<unknown> | unknown;
},): RouteDef {
    return def as unknown as RouteDef;
}

export { reply, } from './types';
```

- [ ] **Step 3: Create `backend/src/api/registry.ts`**

```ts
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
```

- [ ] **Step 4: Write the framework tests** — `backend/src/api/registry.test.ts`

These use only `public` routes so the auth middleware (which queries Postgres) never runs — no DB needed.

```ts
import express from 'express';
import request from 'supertest';
import { describe, expect, it, } from 'vitest';
import { z, } from 'zod';
import { NotFoundError, } from '../core/errors';
import { errorHandler, } from '../middleware/error';
import { defineRoute, reply, } from './defineRoute';
import { buildRouter, manifest, registerModule, } from './registry';

function appFor(defs: Parameters<typeof buildRouter>[0],) {
    const app = express();
    app.use(express.json(),);
    app.use(buildRouter(defs,),);
    app.use(errorHandler,);
    return app;
}

describe('route framework', () => {
    it('shapes plain returns into { success, data }', async () => {
        const app = appFor([defineRoute({
            method: 'get', path: '/hello', auth: 'public', summary: 't',
            handler: () => ({ hi: true, }),
        },),],);
        const res = await request(app,).get('/hello',);
        expect(res.status,).toBe(200,);
        expect(res.body,).toEqual({ success: true, data: { hi: true, }, },);
    },);

    it('honors reply() meta and status', async () => {
        const app = appFor([defineRoute({
            method: 'post', path: '/things', auth: 'public', summary: 't',
            handler: () => reply({ id: 1, }, { status: 201, meta: { page: 1, limit: 10, total: 1, totalPages: 1, }, },),
        },),],);
        const res = await request(app,).post('/things',);
        expect(res.status,).toBe(201,);
        expect(res.body.meta.total,).toBe(1,);
    },);

    it('rejects invalid input with VALIDATION_ERROR and field details', async () => {
        const app = appFor([defineRoute({
            method: 'post', path: '/things', auth: 'public', summary: 't',
            input: { body: z.object({ name: z.string().min(1,), },), },
            handler: ({ body, },) => body,
        },),],);
        const res = await request(app,).post('/things',).send({},);
        expect(res.status,).toBe(400,);
        expect(res.body.error.code,).toBe('VALIDATION_ERROR',);
        expect(res.body.error.details.errors[0].field,).toBe('name',);
    },);

    it('funnels thrown AppErrors into the shared envelope', async () => {
        const app = appFor([defineRoute({
            method: 'get', path: '/missing', auth: 'public', summary: 't',
            handler: () => { throw new NotFoundError('Post',); },
        },),],);
        const res = await request(app,).get('/missing',);
        expect(res.status,).toBe(404,);
        expect(res.body,).toEqual({
            success: false,
            error: { code: 'NOT_FOUND', message: 'Post not found', },
        },);
    },);

    it('parses and coerces query params through the schema', async () => {
        const app = appFor([defineRoute({
            method: 'get', path: '/list', auth: 'public', summary: 't',
            input: { query: z.object({ page: z.coerce.number().int().default(1,), },), },
            handler: ({ query, },) => ({ page: query.page, },),
        },),],);
        const res = await request(app,).get('/list?page=3',);
        expect(res.body.data.page,).toBe(3,);
    },);

    it('registers modules in the manifest', () => {
        registerModule('test-module', [defineRoute({
            method: 'get', path: '/x', auth: 'public', summary: 'example',
        handler: () => null,
        },),],);
        const entry = manifest().find((m,) => m.module === 'test-module',);
        expect(entry?.routes[0],).toEqual({
            method: 'GET', path: '/x', auth: 'public', summary: 'example',
        },);
    },);
},);
```

- [ ] **Step 5: Run tests — expect failures only if implementation has typos; fix until green**

Run: `npm test -w backend -- --run src/api/registry.test.ts`
Expected: 6 passed. (Note: `error.details` on NotFoundError is `undefined`, so it's absent from JSON — the strict `toEqual` in test 4 relies on that.)

- [ ] **Step 6: Build + commit**

Run: `npm run build -w backend`

```bash
git add backend/src/api backend/package.json package-lock.json
git commit -m "feat(backend): typed route framework — defineRoute, registry, manifest"
```

---

### Task 5: Pure bulk-action helper

`handleBulkAction` writes to `res` directly, which the framework forbids. Extract a pure core; keep the old wrapper for the 5+ unconverted routes that still call it (deleted in Phase 3).

**Files:**
- Modify: `backend/src/utils/bulkActions.ts`

- [ ] **Step 1: Refactor `backend/src/utils/bulkActions.ts`**

Keep `bulkActionSchema` and `BulkActionConfig` exactly as they are. Replace `handleBulkAction` with a pure function + a thin legacy wrapper:

```ts
export interface BulkActionResult {
    updated: number;
    action: 'delete' | 'status';
}

/** Validate + run a bulk action. Throws (ZodError / ValidationError) on
 *  bad input — callers in the route framework let the central error
 *  middleware shape the response. */
export async function performBulkAction(
    body: unknown,
    config: BulkActionConfig,
): Promise<BulkActionResult> {
    const { ids, action, value, } = bulkActionSchema.parse(body,);

    if (action === 'status') {
        if (!value) throw new ValidationError('status value is required',);
        if (config.allowedStatuses && !config.allowedStatuses.includes(value,)) {
            throw new ValidationError(`invalid status: ${value}`,);
        }
        await query(
            `UPDATE ${config.table} SET status = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])`,
            [value, ids,],
        );
    } else if (action === 'delete') {
        if (config.softDelete !== false) {
            await query(
                `UPDATE ${config.table} SET status = 'deleted', updated_at = NOW() WHERE id = ANY($1::uuid[])`,
                [ids,],
            );
        } else {
            await query(
                `DELETE FROM ${config.table} WHERE id = ANY($1::uuid[])`,
                [ids,],
            );
        }
    }

    if (config.onInvalidate) await config.onInvalidate();
    return { updated: ids.length, action, };
}

/** @deprecated legacy Express-coupled wrapper — used by routes not yet
 *  on the manifest framework. Removed in Phase 3 (module sweep). */
export async function handleBulkAction(
    res: Response,
    body: unknown,
    config: BulkActionConfig,
): Promise<void> {
    try {
        const result = await performBulkAction(body, config,);
        sendSuccess(res, result,);
    } catch (error) {
        handleRouteError(res, error, 'bulk action',);
    }
}
```

- [ ] **Step 2: Build + commit**

Run: `npm run build -w backend`
Expected: compiles; legacy callers (pages.ts etc.) are untouched.

```bash
git add backend/src/utils/bulkActions.ts
git commit -m "refactor(backend): extract pure performBulkAction from Express wrapper"
```

---

### Task 6: Posts service — `backend/src/services/posts.ts`

The pilot service. Start from the current `backend/src/sdk/posts.ts` and absorb ALL logic the route file currently holds: cached public listing, slug fetch with access gating, revision snapshot on update, revision ops, bulk, block reorder.

**Files:**
- Create: `backend/src/services/posts.ts`
- Modify: `backend/src/sdk/posts.ts` (reduce to shim)
- Modify: `backend/src/sdk/index.ts` (import posts from services)

- [ ] **Step 1: Create `backend/src/services/posts.ts`**

Copy everything from `backend/src/sdk/posts.ts`, change the two relative imports (`'../services/audit'` → `'./audit'`, `'../services/cache'` → `'./cache'`, and `'./types'` → `'./types'` stays), then ADD the following (new imports at top, new functions appended in the matching sections):

New imports:

```ts
import type { Post, User, } from '@rw/shared';
import { AppError, NotFoundError, UnauthorizedError, } from '../core/errors';
import { checkContentAccess, ContentAccessLevel, } from '../middleware/content-access';
import * as revisionsRepo from '../repositories/revisions.repo';
import { performBulkAction, } from '../utils/bulkActions';
import type { BulkActionResult, } from '../utils/bulkActions';
```

New read — cached public listing (logic moved verbatim from the old `GET /public` route):

```ts
export interface PublicListOptions {
    filters: repo.PostFilters;
    pagination: PaginationOpts;
    /** anonymous requests read and write the Redis cache */
    anonymous: boolean;
    /** admins get drafts back when requesting an id-restricted feed
     *  (the post-list block picker lets them pin drafts; the preview
     *  must resolve them). Date/search filters keep the public gate. */
    isAdmin: boolean;
}

export async function listPublicCached(opts: PublicListOptions,): Promise<ListResult<Post>> {
    const { filters, pagination, anonymous, isAdmin, } = opts;
    const page = pagination.page ?? 1;
    const limit = pagination.limit ?? 10;

    const cacheKey = `posts:public:${page}:${limit}:${filters.tag || ''}:${filters.category || ''}:${
        filters.search || ''}:${filters.publishedBefore || ''}:${filters.publishedAfter || ''}:${
        filters.ids ? filters.ids.join('|',) : ''}:${filters.withContentBlocks ? 'b' : ''}`;

    if (anonymous) {
        // NOTE: check services/cache.ts — if `get` is not generic,
        // use `await cache.get(cacheKey,) as ListResult<Post> | null`.
        const cached = await cache.get<ListResult<Post>>(cacheKey,);
        if (cached) return cached;
    }

    const result = await repo.findPublicPosts(
        { ...filters, includeNonPublishedForIds: isAdmin, },
        { page, limit, },
    );

    const out: ListResult<Post> = {
        data: result.data,
        meta: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit,), },
    };

    if (anonymous) await cache.set(cacheKey, out, 300,);
    return out;
}
```

New read — slug fetch with privacy + access gating (moved from `GET /slug/:slug`; the locked case becomes a typed error instead of a bespoke envelope):

```ts
/**
 * Public-side slug fetch. Enforces privacy and membership gating:
 *   - missing → NotFoundError
 *   - private + anonymous → UnauthorizedError
 *   - gated + insufficient access → AppError(403, CONTENT_LOCKED) whose
 *     `details` carries `ContentLockedDetails` from @rw/shared.
 * Caches public, non-private posts for anonymous readers.
 */
export async function getPublicBySlug(
    slug: string,
    user: User | undefined,
    adminPreview = false,
): Promise<repo.PostWithBlocks> {
    const cacheKey = `post:slug:${slug}`;

    if (!user) {
        const cached = await cache.get<repo.PostWithBlocks>(cacheKey,);
        if (cached) return cached;
    }

    const post = adminPreview ?
        await repo.findPostBySlugAnyStatus(slug,) :
        await repo.findPostBySlug(slug,);
    if (!post) throw new NotFoundError('Post',);

    if (post.isPrivate && !user) throw new UnauthorizedError('Authentication required',);

    const accessLevel = (post.accessLevel || 'public') as ContentAccessLevel;
    if (accessLevel !== 'public') {
        const accessCheck = await checkContentAccess(accessLevel, user,);
        if (!accessCheck.allowed) {
            throw new AppError(403, 'CONTENT_LOCKED', accessCheck.reason || 'Access denied', {
                locked: true,
                accessLevel,
                preview: {
                    title: post.title,
                    description: post.excerpt || post.metaDescription || null,
                    featuredImage: post.featuredImage || null,
                },
            },);
        }
    }

    if (!post.isPrivate && accessLevel === 'public') {
        await cache.set(cacheKey, post, 300,);
    }

    return post;
}
```

Modify the existing `update` to snapshot a revision first (moved from the old `PUT /:id` route — semantics preserved: snapshot failure never blocks the save). Insert at the top of `update`'s body:

```ts
    try {
        const existing = await repo.findPostById(id,);
        await revisionsRepo.createRevision('post', id, existing as never, ctx.userId || null,);
        await revisionsRepo.pruneRevisions('post', id, 50,);
    } catch {
        // Don't fail the save if the revision snapshot fails.
    }
```

New revisions section (moved from the three revision routes):

```ts
// ─── Revisions ────────────────────────────────────────────────────

export async function listRevisions(postId: string,) {
    return revisionsRepo.listRevisions('post', postId,);
}

export async function getRevision(postId: string, version: number,) {
    return revisionsRepo.getRevision('post', postId, version,);
}

/** Restore a revision, snapshotting current state first. */
export async function restoreRevision(
    postId: string,
    version: number,
    ctx: AuditContext,
): Promise<repo.PostWithBlocks> {
    const revision = await revisionsRepo.getRevision('post', postId, version,);
    const snap = revision.snapshot as Record<string, unknown>;
    const current = await repo.findPostById(postId,);
    await revisionsRepo.createRevision(
        'post',
        postId,
        current as never,
        ctx.userId || null,
        `Pre-restore snapshot (restoring v${version})`,
    );
    const restored = await repo.updatePost(postId, {
        title: snap.title,
        slug: snap.slug,
        excerpt: snap.excerpt,
        content: snap.content,
        status: snap.status,
        accessLevel: snap.accessLevel,
        tags: snap.tags,
        contentBlocks: snap.contentBlocks,
        publishAt: snap.publishAt,
    },);
    await cache.invalidatePostCache(postId,);
    return restored;
}
```

New bulk + reorder section (moved from `POST /bulk` and `PUT /:postId/blocks/reorder`):

```ts
// ─── Bulk + block order ───────────────────────────────────────────

export async function bulk(body: unknown,): Promise<BulkActionResult> {
    return performBulkAction(body, {
        table: 'posts',
        allowedStatuses: ['draft', 'published', 'scheduled', 'archived', 'deleted',],
        softDelete: true,
        onInvalidate: () => cache.invalidatePostCache(),
    },);
}

export async function reorderContentBlocks(postId: string, blockIds: string[],): Promise<void> {
    await repo.reorderContentBlocks(postId, blockIds,);
    await cache.invalidatePostCache(postId,);
}
```

- [ ] **Step 2: Shim `backend/src/sdk/posts.ts`**

Replace its entire content with:

```ts
/** Shim — canonical module moved to services/posts.ts (headless spec). */
export * from '../services/posts';
```

- [ ] **Step 3: Verify `backend/src/sdk/index.ts` still compiles unchanged**

It imports `* as posts from './posts'` — the shim preserves the surface, so `cms.posts` keeps working for any other caller. No edit needed.

- [ ] **Step 4: Build + commit**

Run: `npm run build -w backend`
Expected: compiles. (If `checkContentAccess`'s signature expects a non-optional user, check `backend/src/middleware/content-access.ts` — the old route passed `req.user` which is `User | undefined`, so it already accepts undefined.)

```bash
git add backend/src/services/posts.ts backend/src/sdk/posts.ts
git commit -m "feat(backend): posts service absorbs route logic (cached lists, gating, revisions, bulk)"
```

---

### Task 7: Posts routes as a manifest (normalized paths)

Replace `backend/src/routes/posts.ts` wholesale. Path changes: `GET /public` merges into `GET /` (optional auth; admin view triggers when `status` or `sort` is present — both admin UIs already send `sort`). Everything else keeps its path but loses all inline logic.

**Files:**
- Rewrite: `backend/src/routes/posts.ts`
- Modify: `backend/src/routes/index.ts:19,31`

- [ ] **Step 1: Rewrite `backend/src/routes/posts.ts`**

Full new content:

```ts
import { z, } from 'zod';
import { defineRoute, reply, } from '../api/defineRoute';
import { NotFoundError, } from '../core/errors';
import * as posts from '../services/posts';

// ─── Schemas ──────────────────────────────────────────────────────

const contentBlockSchema = z.object({
    id: z.string().optional(),
    type: z.enum([
        'text', 'rich_text', 'social', 'image', 'video',
        'document', 'url_link', 'hero', 'html', 'campaign', 'form', 'post', 'post_list',
        'gallery', 'carousel', 'spacer',
    ],),
    sort_order: z.number().int().min(0,),
    data: z.record(z.unknown(),).default({},),
},);

const postSchema = z.object({
    slug: z.string().min(1,).max(255,).regex(/^[a-z0-9-]+$/,),
    title: z.string().min(1,).max(255,),
    excerpt: z.string().optional(),
    content: z.string().optional().default('',),
    featuredImage: z.string().url().optional(),
    status: z.enum(['draft', 'published', 'scheduled', 'archived', 'deleted',],).optional(),
    publishAt: z.string().datetime().nullable().optional(),
    isPrivate: z.boolean().optional(),
    accessLevel: z.enum(['public', 'member', 'patron',],).optional(),
    tags: z.array(z.string(),).optional(),
    categories: z.array(z.string(),).optional(),
    metaTitle: z.string().max(255,).optional(),
    metaDescription: z.string().optional(),
    publishedAt: z.string().datetime().optional(),
    contentBlocks: z.array(contentBlockSchema,).optional(),
},);

const idParams = z.object({ id: z.string(), },);

const listQuery = z.object({
    page: z.coerce.number().int().min(1,).default(1,),
    limit: z.coerce.number().int().min(1,).max(100,).default(10,),
    tag: z.string().optional(),
    category: z.string().optional(),
    search: z.string().optional(),
    before: z.string().optional(),
    after: z.string().optional(),
    ids: z.string().optional(),
    withBlocks: z.string().optional(),
    status: z.string().optional(),
    sort: z.string().optional(),
},);

const isAdminRole = (role?: string,) => role === 'admin' || role === 'sysadmin';

// ─── Routes ───────────────────────────────────────────────────────
// Order matters: literal paths (/search, /slug/:slug, /bulk) must be
// declared before the /:id catch-all.

export const postsRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'optional',
        summary: 'List posts. Public gate by default; admins passing status/sort get the all-statuses listing.',
        input: { query: listQuery, },
        handler: async ({ user, query, },) => {
            const isAdmin = isAdminRole(user?.role,);

            // Admin view is explicit: only when an admin sends status or
            // sort. An admin browsing the public site sends neither and
            // gets the public gate like everyone else.
            if (isAdmin && (query.status !== undefined || query.sort !== undefined)) {
                const status = query.status && query.status !== 'all' ? query.status : undefined;
                const result = await posts.list(
                    { status, search: query.search, sort: query.sort, },
                    { page: query.page, limit: query.limit, },
                );
                return reply(result.data, { meta: result.meta, },);
            }

            const idList = query.ids?.trim() ?
                query.ids.split(',',).map((s,) => s.trim(),).filter(Boolean,) :
                undefined;

            const result = await posts.listPublicCached({
                filters: {
                    tag: query.tag,
                    category: query.category,
                    search: query.search,
                    publishedBefore: query.before,
                    publishedAfter: query.after,
                    ids: idList,
                    withContentBlocks: query.withBlocks === '1' || query.withBlocks === 'true',
                },
                pagination: { page: query.page, limit: query.limit, },
                anonymous: !user,
                isAdmin,
            },);
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/search', auth: 'public',
        summary: 'Full-text search over published posts.',
        input: {
            query: z.object({
                q: z.string().min(1,),
                page: z.coerce.number().int().min(1,).default(1,),
                limit: z.coerce.number().int().min(1,).max(100,).default(10,),
            },),
        },
        handler: async ({ query, },) => {
            const result = await posts.search(query.q, { page: query.page, limit: query.limit, },);
            return reply(result.data, { meta: result.meta, },);
        },
    },),

    defineRoute({
        method: 'get', path: '/slug/:slug', auth: 'optional',
        summary: 'Fetch a post by slug. Gated content yields CONTENT_LOCKED with a preview in error.details.',
        input: {
            params: z.object({ slug: z.string(), },),
            query: z.object({ preview: z.string().optional(), },),
        },
        handler: ({ params, query, user, },) => {
            const adminPreview = query.preview === 'admin' && isAdminRole(user?.role,);
            return posts.getPublicBySlug(params.slug, user, adminPreview,);
        },
    },),

    defineRoute({
        method: 'post', path: '/bulk', auth: 'admin',
        summary: 'Bulk status change / soft-delete by id list.',
        handler: ({ body, },) => posts.bulk(body,),
    },),

    defineRoute({
        method: 'get', path: '/:id', auth: 'admin',
        summary: 'Fetch a post by id (any status).',
        input: { params: idParams, },
        handler: async ({ params, },) => {
            const post = await posts.getById(params.id,);
            if (!post) throw new NotFoundError('Post',);
            return post;
        },
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create a post.',
        input: { body: postSchema, },
        handler: async ({ body, audit, },) => {
            const post = await posts.create(body, audit(),);
            return reply(post, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'put', path: '/:id', auth: 'admin',
        summary: 'Update a post. Snapshots a revision first.',
        input: { params: idParams, body: postSchema.partial(), },
        handler: ({ params, body, audit, },) => posts.update(params.id, body, audit(),),
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Delete a post.',
        input: { params: idParams, },
        handler: async ({ params, audit, },) => {
            await posts.remove(params.id, audit(),);
            return { message: 'Post deleted', };
        },
    },),

    defineRoute({
        method: 'get', path: '/:id/revisions', auth: 'admin',
        summary: 'List a post\'s saved revisions.',
        input: { params: idParams, },
        handler: ({ params, },) => posts.listRevisions(params.id,),
    },),

    defineRoute({
        method: 'get', path: '/:id/revisions/:version', auth: 'admin',
        summary: 'Fetch one revision snapshot.',
        input: { params: z.object({ id: z.string(), version: z.coerce.number().int(), },), },
        handler: ({ params, },) => posts.getRevision(params.id, params.version,),
    },),

    defineRoute({
        method: 'post', path: '/:id/revisions/:version/restore', auth: 'admin',
        summary: 'Restore a revision (snapshots current state first).',
        input: { params: z.object({ id: z.string(), version: z.coerce.number().int(), },), },
        handler: ({ params, audit, },) => posts.restoreRevision(params.id, params.version, audit(),),
    },),

    defineRoute({
        method: 'put', path: '/:id/blocks/reorder', auth: 'admin',
        summary: 'Reorder a post\'s content blocks.',
        input: {
            params: idParams,
            body: z.object({ blockIds: z.array(z.string(),), },),
        },
        handler: async ({ params, body, },) => {
            await posts.reorderContentBlocks(params.id, body.blockIds,);
            return { message: 'Blocks reordered', };
        },
    },),
];
```

Behavioral notes (deliberate, from the spec):
- The old `DELETE /:id` returned `{ message }` — preserved.
- The old delete didn't 404 on missing ids (repo delete was fire-and-forget); `posts.remove` returns null silently — same outward behavior.
- The locked-post response changes shape (bespoke top-level `locked` → `error.code === 'CONTENT_LOCKED'` with `error.details`). Frontend updated in Task 8.
- `GET /public` is GONE. Frontend updated in Task 8.

- [ ] **Step 2: Mount via the registry** in `backend/src/routes/index.ts`

Replace line 19 (`import postsRoutes from './posts';`) with:

```ts
import { registerModule, } from '../api/registry';
import { postsRoutes, } from './posts';
```

Replace line 31 (`router.use('/posts', postsRoutes,);`) with:

```ts
router.use('/posts', registerModule('posts', postsRoutes,),);
```

(Keep the import block alphabetized to match the file's style; `registerModule` import goes above the route imports.)

- [ ] **Step 3: Build + run all backend tests**

Run: `npm run build -w backend && npm test -w backend -- --run`
Expected: build clean, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/posts.ts backend/src/routes/index.ts
git commit -m "feat(backend): posts module on manifest framework; GET /posts merges /public"
```

---

### Task 8: Frontend call-site updates

**Files:**
- Modify: `frontend/src/services/api.ts:238`
- Modify: `frontend/src/services/postsService.ts:114` (and its line-5 comment)
- Modify: `frontend/src/pages/Post.tsx:44-56` (locked-content handling)
- Modify: `frontend/src/services/requestCache.ts:10` (comment only)
- Modify: `frontend/src/components/admin/blocks/types/PostListBlock.tsx:85` (comment only)

- [ ] **Step 1: Point list fetches at `GET /posts`**

In `frontend/src/services/api.ts` line 238:

```ts
    return api.get(`/posts?${searchParams.toString()}`,);
```

In `frontend/src/services/postsService.ts` line 114:

```ts
        const response = await api.get<PostWithBlocks[]>(`/posts?${queryString}`,);
```

Also update the stale comments: `postsService.ts:5` ("Wraps `GET /posts/public`" → "Wraps `GET /posts`"), `requestCache.ts:10` example, and `PostListBlock.tsx:85` ("The public `/posts/public?ids=`" → "The public `/posts?ids=`").

Note: neither caller sends `status` or `sort`, so logged-in admins hitting these stay on the public gate — by design.

- [ ] **Step 2: Update locked-content handling in `frontend/src/pages/Post.tsx`**

Read the file around lines 40-60 first. The current code checks `raw.locked` on a top-level field of the (failed) response. The new contract is `error.code === 'CONTENT_LOCKED'` with the payload in `error.details`. Replace the `if (raw.locked) { ... }` branch with:

```ts
                if (raw.error?.code === 'CONTENT_LOCKED' && raw.error.details) {
                    const d = raw.error.details as { accessLevel: ContentAccessLevel; preview: LockedContent['preview']; };
                    setLockedContent({
                        accessLevel: d.accessLevel,
                        preview: d.preview,
                    },);
                    return null;
                }
```

Adapt the exact variable names to what's in the file (the setter is `setLockedContent`; keep the surrounding control flow — only the field paths change from `raw.locked` / `raw.accessLevel` / `raw.preview` to `raw.error.details.*`).

- [ ] **Step 3: Sweep for stragglers**

Run: `grep -rn "posts/public" frontend/src --include='*.ts' --include='*.tsx'`
Expected: no matches.
Run: `grep -rn "'DUPLICATE'" frontend/src --include='*.ts' --include='*.tsx'`
If any hits check error-code handling: the new framework emits `CONFLICT` for unique-violations on converted (posts) endpoints. Update those checks to accept both codes (legacy routes still emit `DUPLICATE` until Phase 3): `code === 'CONFLICT' || code === 'DUPLICATE'`.

- [ ] **Step 4: Build + commit**

Run: `npm run build -w frontend`
Expected: clean build.

```bash
git add frontend/src
git commit -m "fix(frontend): posts list uses GET /posts; locked posts read error.details"
```

---

### Task 9: Manual smoke verification

**Files:** none (verification only)

- [ ] **Step 1: Boot the dev stack**

Run: `npm run dev` (or just `npm run dev:backend` if frontend dev server is already running). Wait for "server listening" output. Requires local Postgres + Redis per `.env`.

- [ ] **Step 2: Verify public listing, envelope shape, and meta**

Run: `curl -s http://localhost:3001/api/v1/posts | head -c 400`
Expected: `{"success":true,"data":[...],"meta":{"page":1,"limit":10,...}}` — published posts only.

- [ ] **Step 3: Verify validation error shape**

Run: `curl -s 'http://localhost:3001/api/v1/posts?page=zero'`
Expected: 400, `{"success":false,"error":{"code":"VALIDATION_ERROR",...,"details":{"errors":[{"field":"page",...}]}}}`

- [ ] **Step 4: Verify admin guard**

Run: `curl -s -X POST http://localhost:3001/api/v1/posts -H 'Content-Type: application/json' -d '{}'`
Expected: 401 UNAUTHORIZED (not CSRF_ERROR — no cookie, no Bearer → auth runs first? No: csrf runs before auth in the app chain. With neither cookie nor Authorization header, the CSRF check fires → 403 CSRF_ERROR is ALSO acceptable here; with `-H 'Authorization: Bearer bogus'` expect 401 UNAUTHORIZED "Invalid token", which proves the Bearer CSRF exemption works.)

Run: `curl -s -X POST http://localhost:3001/api/v1/posts -H 'Authorization: Bearer bogus' -H 'Content-Type: application/json' -d '{}'`
Expected: 401 `{"code":"UNAUTHORIZED","message":"Invalid token"}` — proves Bearer requests pass CSRF and die at auth, not at CSRF.

- [ ] **Step 5: Verify the admin app still works**

Open `http://localhost:3000/admin/posts` — list renders (it sends `sort`, so the admin view triggers and drafts appear). Open the public `http://localhost:3000/posts` — published posts render. Open a single post page.

- [ ] **Step 6: No commit (nothing changed). Fix anything broken before proceeding.**

---

### Task 10: Docs sync

**Files:**
- Modify: `CLAUDE.md` (Backend architecture + key patterns sections)
- Modify: `backend/src/sdk/README.md` (pointer note)

- [ ] **Step 1: Update `CLAUDE.md`**

In the Backend → Architecture tree, add under `backend/src/`:

```
├── api/             # Route framework: defineRoute(), registry (mount + manifest), auth tiers
```

Add a "Key Patterns" bullet (and adjust the SOLID architecture description):

```
- **Route manifest framework** — new/converted modules declare endpoints with `defineRoute({ method, path, auth, summary, input(zod), handler })` in `routes/<module>.ts` and mount via `registerModule()` (`backend/src/api/`). Auth tiers: `public | optional | user | admin | apiKey` (shared `AuthTier`). Handlers return data (or `reply(data, {meta,status})`); errors throw and funnel to `middleware/error.ts`. Business logic lives in `services/<module>.ts` (the old `sdk/` modules are shims). `manifest()` emits the machine-readable route list for docs/SDK generation. Converted so far: posts. CSRF is skipped for Bearer-authenticated requests.
- Posts listing is unified: `GET /posts` (optional auth) serves the public gate by default; admins sending `status`/`sort` get the all-statuses admin view. `/posts/public` is gone.
```

Also update the routes table row for `/posts`: auth "public + admin" stays accurate; no change needed unless wording references `/public`.

- [ ] **Step 2: Note the move in `backend/src/sdk/README.md`**

Add at the top, under the title:

```md
> **Note (2026-06):** capability modules are migrating to
> `backend/src/services/<module>.ts` as part of the headless API work
> (see `docs/superpowers/specs/2026-06-04-headless-api-design.md`).
> The `cms.*` aggregate and these docs remain valid — files under
> `sdk/` re-export from `services/` during the transition.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md backend/src/sdk/README.md
git commit -m "docs: route-manifest framework + posts normalization in CLAUDE.md/sdk README"
```

---

## Follow-up plans (not in this document)

- **Phase 2 — API keys:** `api_keys` migration, `ssk_` key issuance (hash at rest), `authMiddlewaresFor('apiKey')` gains real key verification with scopes, admin CRUD endpoints + Settings panel, synthetic audit actor.
- **Phase 3 — module sweep:** convert the remaining 26 route files in batches (content → commerce → engagement → platform → mail → misc), delete `handleRouteError`/`handleBulkAction`/sdk shims when the last caller migrates, normalize `/public` suffixes everywhere, update frontend per batch.
- **Phase 4 — docs generation:** `scripts/generate-api-docs.ts` rendering `manifest()` → `docs/API.md` + `docs/api-manifest.json`, README "Headless Mode" section, final CLAUDE.md sync.
