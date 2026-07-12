# @sitesurge/client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@sitesurge/client` in full — a typed, zero-runtime-dependency, framework-agnostic headless client exposing every SiteSurge API ability through per-module namespaces, with token lifecycle + auto-load, an SWR client cache over a pluggable adapter, standardized errors with a consumer error bus, an optional SolidJS adapter, full docs, and tests.

**Architecture:** Three layers — `core/` (request funnel, auth, cache, errors, events; framework-free), `modules/` (thin typed namespaces over `ModuleBase`), `adapters/solid.ts` (opt-in). DTOs come from `@sitesurge/types`; the method surface is fixed by `docs/superpowers/plans/2026-06-08-cms-client-methodmap.md` and `docs/api-manifest.json`.

**Tech Stack:** TypeScript (strict), tsup (dual ESM+CJS+.d.ts build, devDep), vitest (mocked fetch). No runtime deps.

**Spec:** `docs/superpowers/specs/2026-06-08-cms-client-design.md`. **Method-map (authoritative surface):** `docs/superpowers/plans/2026-06-08-cms-client-methodmap.md`. **Drift allowlist** (never exposed): payments/webhook, OAuth callbacks (`auth/patreon/callback`, `connections/:provider/oauth/callback`), unsubscribe HTML (`/u/:token*`, `/lists/:slug/confirm/:token`) — feed/sitemap exposed as raw string helpers.

**Conventions:** 4-space indent, trailing commas (NOT after rest params) — matches the repo. The package's tsconfig stub already extends `config/cms-client/tsconfig.json`. Tests live beside source as `*.test.ts`. Build verified per task with `npm run build -w packages/cms-client` and `npm test -w packages/cms-client -- --run`. Path-scoped commits; no Co-Authored-By; commits direct to `main`. The shared package is `@sitesurge/types` (already a workspace dep).

**Key facts from the survey:**
- `@sitesurge/types` exports: `ApiResponse<T>`, `ApiError`, `ApiMeta`, `ErrorCode` (members: UNAUTHORIZED, FORBIDDEN, NOT_FOUND, VALIDATION_ERROR, CONFLICT, RATE_LIMITED, BAD_REQUEST, INTERNAL_ERROR, SERVICE_UNAVAILABLE, CSRF_ERROR, CONTENT_LOCKED, SERVICE_NOT_CONFIGURED, ALREADY_INSTALLED, DUPLICATE, REFERENCE_ERROR, NO_FILE, NETWORK_ERROR, UPLOAD_ERROR, TIMEOUT, UNKNOWN_ERROR), `AuthTier`, `ApiKeyScope`, `ContentLockedDetails`, `AuthResponse` (`{ user, accessToken, refreshToken, expiresAt }`), `LoginCredentials` (`{ email, password }`), `User`, and all `routes/<module>` DTOs.
- Backend supports Bearer tokens in the response body (login/refresh return `AuthResponse`) AND httpOnly cookies. The new client defaults to **Bearer mode with localStorage persistence** (the web app currently uses cookie mode — the client supersedes it).
- Refresh: `POST /api/v1/auth/refresh` accepts `{ refreshToken }` in body; returns `AuthResponse`. 401 on expiry carries `error.code === 'UNAUTHORIZED'`, message `Token expired` / `Invalid token`.
- API base path is `/api/v1`; raw routes (`/feed.xml`, `/sitemap.xml`, `/u/...`) sit at site root (no `/api/v1`).

---

### Task 1: Package scaffold + dual build tooling

**Files:**
- Modify: `packages/cms-client/package.json`
- Create: `config/cms-client/tsup.config.ts`
- Modify: `config/cms-client/tsconfig.json` (add DOM + ES2022 libs for IndexedDB/fetch types)
- Create: `config/cms-client/vitest.config.ts`
- Modify: `packages/cms-client/src/index.ts` (placeholder export stays until Task 10)

- [ ] **Step 1: Update `packages/cms-client/package.json`**

```json
{
    "name": "@sitesurge/client",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "sideEffects": false,
    "main": "dist/index.cjs",
    "module": "dist/index.js",
    "types": "dist/index.d.ts",
    "exports": {
        ".": {
            "types": "./dist/index.d.ts",
            "import": "./dist/index.js",
            "require": "./dist/index.cjs"
        },
        "./solid": {
            "types": "./dist/solid.d.ts",
            "import": "./dist/solid.js",
            "require": "./dist/solid.cjs"
        }
    },
    "files": ["dist"],
    "scripts": {
        "build": "tsup --config ../../config/cms-client/tsup.config.ts",
        "typecheck": "tsc --noEmit",
        "test": "vitest --config ../../config/cms-client/vitest.config.ts run",
        "test:watch": "vitest --config ../../config/cms-client/vitest.config.ts"
    },
    "dependencies": {
        "@sitesurge/types": "file:../shared"
    },
    "peerDependencies": {
        "solid-js": ">=1.8.0"
    },
    "peerDependenciesMeta": {
        "solid-js": { "optional": true }
    },
    "devDependencies": {
        "typescript": "^5.3.3",
        "tsup": "^8.0.0",
        "vitest": "^1.1.3",
        "solid-js": "^1.8.0",
        "fake-indexeddb": "^5.0.2"
    }
}
```

- [ ] **Step 2: Create `config/cms-client/tsup.config.ts`**

```ts
import { defineConfig, } from 'tsup';

export default defineConfig({
    entry: {
        index: '../../packages/cms-client/src/index.ts',
        solid: '../../packages/cms-client/src/adapters/solid.ts',
    },
    outDir: '../../packages/cms-client/dist',
    format: ['esm', 'cjs',],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    external: ['@sitesurge/types', 'solid-js',],
},);
```

- [ ] **Step 3: Update `config/cms-client/tsconfig.json` libs** — change the `"lib"` line to include DOM (for `fetch`, `IndexedDB`, `localStorage`, `FormData` types):

```json
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
```

(Leave the rest of the file unchanged.)

- [ ] **Step 4: Create `config/cms-client/vitest.config.ts`**

```ts
import { resolve, } from 'path';
import { defineConfig, } from 'vitest/config';

export default defineConfig({
    root: resolve(__dirname, '../../packages/cms-client',),
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts',],
    },
},);
```

- [ ] **Step 5: Create a placeholder solid adapter so the build has its entry** — `packages/cms-client/src/adapters/solid.ts`:

```ts
/** SolidJS bindings — populated in Task 17. */
export {};
```

- [ ] **Step 6: Install + build + test harness**

Run: `npm install` (from repo root — links the new devDeps).
Run: `npm run build -w packages/cms-client` → emits `dist/index.{js,cjs,d.ts}` + `dist/solid.{js,cjs,d.ts}`.
Run: `npm test -w packages/cms-client -- --run` → "no test files" is acceptable (exit 0 with `--passWithNoTests`? vitest v1 exits 1 on no tests — add `--passWithNoTests` to the test script OR accept that the first real test arrives in Task 2; for THIS step just confirm build works and `npx vitest run --passWithNoTests` exits 0).

Adjust: append `--passWithNoTests` to the `test` script in package.json so an empty run is green.

- [ ] **Step 7: Commit**

```bash
git add packages/cms-client/package.json packages/cms-client/src/adapters/solid.ts config/cms-client/ package-lock.json
git commit -m "build(cms-client): dual ESM+CJS+dts via tsup, vitest harness, exports map"
```

---

### Task 2: Error hierarchy (TDD)

**Files:**
- Create: `packages/cms-client/src/core/errors.ts`
- Create: `packages/cms-client/src/core/errors.test.ts`

- [ ] **Step 1: Write the failing test** — `errors.test.ts`:

```ts
import { describe, expect, it, } from 'vitest';
import {
    CmsError, NetworkError, NotFoundError, RateLimitedError,
    UnauthorizedError, ValidationError, ContentLockedError, errorFromEnvelope,
} from './errors';

describe('errorFromEnvelope', () => {
    it('maps NOT_FOUND → NotFoundError with status/code', () => {
        const e = errorFromEnvelope(404, { code: 'NOT_FOUND', message: 'Post not found', },);
        expect(e,).toBeInstanceOf(NotFoundError,);
        expect(e,).toBeInstanceOf(CmsError,);
        expect(e.code,).toBe('NOT_FOUND',);
        expect(e.status,).toBe(404,);
        expect(e.message,).toBe('Post not found',);
    },);

    it('maps VALIDATION_ERROR and exposes fieldErrors', () => {
        const e = errorFromEnvelope(400, {
            code: 'VALIDATION_ERROR', message: 'Invalid request data',
            details: { errors: [{ field: 'slug', message: 'Required', code: 'invalid', },], },
        },) as ValidationError;
        expect(e,).toBeInstanceOf(ValidationError,);
        expect(e.fieldErrors,).toEqual({ slug: 'Required', },);
    },);

    it('maps CONTENT_LOCKED and carries the preview details', () => {
        const e = errorFromEnvelope(403, {
            code: 'CONTENT_LOCKED', message: 'Access denied',
            details: { locked: true, accessLevel: 'patron',
                preview: { title: 'T', description: null, featuredImage: null, }, },
        },) as ContentLockedError;
        expect(e,).toBeInstanceOf(ContentLockedError,);
        expect(e.accessLevel,).toBe('patron',);
        expect(e.preview.title,).toBe('T',);
    },);

    it('maps RATE_LIMITED and carries retryAfter', () => {
        const e = errorFromEnvelope(429, { code: 'RATE_LIMITED', message: 'slow down', }, 12,) as RateLimitedError;
        expect(e,).toBeInstanceOf(RateLimitedError,);
        expect(e.retryAfter,).toBe(12,);
    },);

    it('maps UNAUTHORIZED → UnauthorizedError', () => {
        expect(errorFromEnvelope(401, { code: 'UNAUTHORIZED', message: 'x', },),).toBeInstanceOf(UnauthorizedError,);
    },);

    it('unknown code falls back to CmsError', () => {
        const e = errorFromEnvelope(418, { code: 'WEIRD' as never, message: 'teapot', },);
        expect(e.constructor.name,).toBe('CmsError',);
        expect(e.code,).toBe('WEIRD',);
    },);

    it('NetworkError is a CmsError with NETWORK_ERROR code', () => {
        const e = new NetworkError('offline',);
        expect(e,).toBeInstanceOf(CmsError,);
        expect(e.code,).toBe('NETWORK_ERROR',);
    },);
},);
```

- [ ] **Step 2: Run → fail** (`npm test -w packages/cms-client -- --run src/core/errors.test.ts`). Expected: module not found.

- [ ] **Step 3: Implement `errors.ts`**

```ts
import type { ApiError, ContentLockedDetails, ErrorCode, } from '@sitesurge/types';

/** Base class for every error the client throws. Carries the wire code,
 *  HTTP status, and raw details so callers can switch on `code` or
 *  instanceof a subclass. Also emitted on the client error bus. */
export class CmsError extends Error {
    readonly code: ErrorCode | string;
    readonly status: number;
    readonly details?: Record<string, unknown>;
    readonly requestId?: string;

    constructor(
        message: string,
        opts: { code: ErrorCode | string; status: number; details?: Record<string, unknown>; requestId?: string; },
    ) {
        super(message,);
        this.name = new.target.name;
        this.code = opts.code;
        this.status = opts.status;
        this.details = opts.details;
        this.requestId = opts.requestId;
        Object.setPrototypeOf(this, new.target.prototype,);
    }
}

export class BadRequestError extends CmsError {}
export class UnauthorizedError extends CmsError {}
export class ForbiddenError extends CmsError {}
export class NotFoundError extends CmsError {}
export class ConflictError extends CmsError {}
export class ServiceUnavailableError extends CmsError {}
export class InternalError extends CmsError {}

export class ValidationError extends CmsError {
    /** field → first message, derived from details.errors[]. */
    readonly fieldErrors: Record<string, string>;
    constructor(message: string, opts: { status: number; details?: Record<string, unknown>; requestId?: string; },) {
        super(message, { code: 'VALIDATION_ERROR', ...opts, },);
        this.fieldErrors = ValidationError.extractFieldErrors(opts.details,);
    }
    private static extractFieldErrors(details?: Record<string, unknown>,): Record<string, string> {
        const out: Record<string, string> = {};
        const errors = (details?.errors ?? []) as Array<{ field?: string; message?: string; }>;
        for (const e of errors) {
            if (e.field && !(e.field in out)) out[e.field] = e.message ?? 'Invalid';
        }
        return out;
    }
}

export class RateLimitedError extends CmsError {
    readonly retryAfter?: number;
    constructor(message: string, opts: { status: number; details?: Record<string, unknown>; retryAfter?: number; },) {
        super(message, { code: 'RATE_LIMITED', status: opts.status, details: opts.details, },);
        this.retryAfter = opts.retryAfter;
    }
}

export class ContentLockedError extends CmsError {
    readonly accessLevel: string;
    readonly preview: ContentLockedDetails['preview'];
    constructor(message: string, opts: { status: number; details?: Record<string, unknown>; },) {
        super(message, { code: 'CONTENT_LOCKED', status: opts.status, details: opts.details, },);
        const d = (opts.details ?? {}) as Partial<ContentLockedDetails>;
        this.accessLevel = d.accessLevel ?? 'unknown';
        this.preview = d.preview ?? { title: '', description: null, featuredImage: null, };
    }
}

/** Transport-level errors (no HTTP envelope). */
export class NetworkError extends CmsError {
    constructor(message = 'Network request failed',) { super(message, { code: 'NETWORK_ERROR', status: 0, },); }
}
export class TimeoutError extends CmsError {
    constructor(message = 'Request timed out',) { super(message, { code: 'TIMEOUT', status: 0, },); }
}
export class AbortError extends CmsError {
    constructor(message = 'Request aborted',) { super(message, { code: 'UNKNOWN_ERROR', status: 0, },); }
}

/** Build the right subclass from an HTTP status + error envelope. */
export function errorFromEnvelope(status: number, error: ApiError, retryAfter?: number,): CmsError {
    const { code, message, details, } = error;
    const requestId = (details?.requestId as string | undefined);
    const base = { status, details, requestId, };
    switch (code) {
        case 'BAD_REQUEST':
        case 'REFERENCE_ERROR':
        case 'NO_FILE':
            return new BadRequestError(message, { code, ...base, },);
        case 'UNAUTHORIZED':
        case 'CSRF_ERROR':
            return new UnauthorizedError(message, { code, ...base, },);
        case 'FORBIDDEN':
            return new ForbiddenError(message, { code, ...base, },);
        case 'NOT_FOUND':
            return new NotFoundError(message, { code, ...base, },);
        case 'VALIDATION_ERROR':
            return new ValidationError(message, base,);
        case 'CONFLICT':
        case 'DUPLICATE':
        case 'ALREADY_INSTALLED':
            return new ConflictError(message, { code, ...base, },);
        case 'RATE_LIMITED':
            return new RateLimitedError(message, { status, details, retryAfter, },);
        case 'CONTENT_LOCKED':
            return new ContentLockedError(message, base,);
        case 'SERVICE_UNAVAILABLE':
        case 'SERVICE_NOT_CONFIGURED':
            return new ServiceUnavailableError(message, { code, ...base, },);
        case 'INTERNAL_ERROR':
            return new InternalError(message, { code, ...base, },);
        default:
            return new CmsError(message, { code, ...base, },);
    }
}
```

- [ ] **Step 4: Run → pass** (7 tests). **Step 5: Commit** `feat(cms-client): typed error hierarchy + envelope mapping`.

---

### Task 3: Event emitter + error bus (TDD)

**Files:** Create `packages/cms-client/src/core/events.ts` + `events.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it, vi, } from 'vitest';
import { Emitter, } from './events';

describe('Emitter', () => {
    it('subscribes and emits typed events', () => {
        const em = new Emitter<{ ping: number; },>();
        const cb = vi.fn();
        em.on('ping', cb,);
        em.emit('ping', 42,);
        expect(cb,).toHaveBeenCalledWith(42,);
    },);
    it('unsubscribe stops delivery', () => {
        const em = new Emitter<{ ping: number; },>();
        const cb = vi.fn();
        const off = em.on('ping', cb,);
        off();
        em.emit('ping', 1,);
        expect(cb,).not.toHaveBeenCalled();
    },);
    it('once fires a single time', () => {
        const em = new Emitter<{ ping: number; },>();
        const cb = vi.fn();
        em.once('ping', cb,);
        em.emit('ping', 1,); em.emit('ping', 2,);
        expect(cb,).toHaveBeenCalledTimes(1,);
    },);
    it('a throwing handler does not break other handlers', () => {
        const em = new Emitter<{ ping: number; },>();
        const good = vi.fn();
        em.on('ping', () => { throw new Error('boom',); },);
        em.on('ping', good,);
        expect(() => em.emit('ping', 1,),).not.toThrow();
        expect(good,).toHaveBeenCalled();
    },);
},);
```

- [ ] **Step 2: Run → fail. Step 3: Implement `events.ts`**

```ts
type Handler<T,> = (payload: T,) => void;

/** Minimal typed event emitter. Handlers are isolated — one throwing
 *  never blocks the others (errors are swallowed; the error bus is the
 *  place to observe failures). */
export class Emitter<Events extends Record<string, unknown>,> {
    private handlers: { [K in keyof Events]?: Set<Handler<Events[K]>>; } = {};

    on<K extends keyof Events,>(event: K, handler: Handler<Events[K]>,): () => void {
        (this.handlers[event] ??= new Set()).add(handler,);
        return () => { this.handlers[event]?.delete(handler,); };
    }

    once<K extends keyof Events,>(event: K, handler: Handler<Events[K]>,): () => void {
        const off = this.on(event, (payload,) => { off(); handler(payload,); },);
        return off;
    }

    emit<K extends keyof Events,>(event: K, payload: Events[K],): void {
        for (const handler of this.handlers[event] ?? []) {
            try { handler(payload,); } catch { /* isolated */ }
        }
    }
}
```

- [ ] **Step 4: Run → pass. Step 5: Commit** `feat(cms-client): typed event emitter`.

---

### Task 4: Config + defaults

**Files:** Create `packages/cms-client/src/core/types.ts` + `packages/cms-client/src/core/config.ts` + `config.test.ts`.

- [ ] **Step 1: Create `types.ts`** (public option types referenced everywhere):

```ts
import type { CmsError, } from './errors';

export type AuthMode = 'bearer' | 'apiKey' | 'cookie';

export interface AuthTokens {
    accessToken: string;
    refreshToken: string;
    /** ISO string or epoch ms; used to pre-empt refresh. Optional. */
    expiresAt?: string | number;
}

export interface TokenStore {
    load(): AuthTokens | null | Promise<AuthTokens | null>;
    save(tokens: AuthTokens,): void | Promise<void>;
    clear(): void | Promise<void>;
}

export interface RetryPolicy {
    /** max attempts (1 = no retry). */
    attempts: number;
    /** base backoff ms (exponential). */
    backoffMs: number;
    /** cap on backoff ms. */
    maxBackoffMs: number;
    /** statuses that trigger retry (besides network errors). */
    retryStatuses: number[];
}

export interface TtlMap {
    list: number;
    entity: number;
    settings: number;
    [resource: string]: number;
}

export type CacheAdapterKind = 'auto' | 'indexeddb' | 'localstorage' | 'memory';

export interface CacheAdapter {
    get<T,>(key: string,): Promise<CacheEntry<T> | null>;
    set<T,>(key: string, entry: CacheEntry<T>,): Promise<void>;
    delete(key: string,): Promise<void>;
    /** delete every key matching the prefix (for module invalidation). */
    deletePrefix(prefix: string,): Promise<void>;
    clear(): Promise<void>;
}

export interface CacheEntry<T,> {
    value: T;
    /** epoch ms when written. */
    storedAt: number;
    /** epoch ms after which the entry is stale. */
    expiresAt: number;
}

export interface QueryOptions {
    /** false → bypass cache for this read. */
    cache?: boolean;
    /** override TTL (ms) for this read. */
    ttl?: number;
    /** AbortSignal to cancel. */
    signal?: AbortSignal;
}

export interface MutationOptions {
    /** opt a write into retry (off by default). */
    retry?: boolean;
    /** forward-compat idempotency key header. */
    idempotencyKey?: string;
    signal?: AbortSignal;
}

export interface CmsClientConfig {
    baseUrl: string;
    auth?: {
        mode?: AuthMode;
        apiKey?: string;
        tokens?: AuthTokens;
        store?: TokenStore | null;
        /** localStorage key for the default store. */
        storageKey?: string;
    };
    cache?: boolean | {
        adapter?: CacheAdapter | CacheAdapterKind;
        ttl?: Partial<TtlMap>;
        namespace?: string;
    };
    fetch?: typeof fetch;
    timeoutMs?: number;
    retry?: Partial<RetryPolicy>;
    headers?: Record<string, string>;
    onError?: (e: CmsError,) => void;
}

export interface ResolvedConfig {
    baseUrl: string;
    apiBase: string;
    authMode: AuthMode;
    apiKey?: string;
    initialTokens?: AuthTokens;
    storageKey: string;
    customStore?: TokenStore | null;
    cacheEnabled: boolean;
    cacheAdapter: CacheAdapter | CacheAdapterKind;
    ttl: TtlMap;
    namespace: string;
    fetchImpl: typeof fetch;
    timeoutMs: number;
    retry: RetryPolicy;
    headers: Record<string, string>;
    onError?: (e: CmsError,) => void;
}

export const DEFAULT_TTL: TtlMap = { list: 30_000, entity: 60_000, settings: 300_000, };
export const DEFAULT_RETRY: RetryPolicy = {
    attempts: 3, backoffMs: 300, maxBackoffMs: 5_000, retryStatuses: [429, 500, 502, 503, 504,],
};
```

- [ ] **Step 2: Failing test `config.test.ts`** — assert defaults + normalization:

```ts
import { describe, expect, it, } from 'vitest';
import { resolveConfig, } from './config';

describe('resolveConfig', () => {
    it('requires baseUrl and derives apiBase', () => {
        const c = resolveConfig({ baseUrl: 'https://cms.example.com/', },);
        expect(c.baseUrl,).toBe('https://cms.example.com',); // trailing slash trimmed
        expect(c.apiBase,).toBe('https://cms.example.com/api/v1',);
    },);
    it('defaults: bearer mode, cache enabled, default ttl/retry/timeout', () => {
        const c = resolveConfig({ baseUrl: 'http://x', },);
        expect(c.authMode,).toBe('bearer',);
        expect(c.cacheEnabled,).toBe(true,);
        expect(c.ttl.list,).toBe(30_000,);
        expect(c.retry.attempts,).toBe(3,);
        expect(c.timeoutMs,).toBe(30_000,);
        expect(c.storageKey,).toBe('cms.auth',);
    },);
    it('cache:false disables caching', () => {
        expect(resolveConfig({ baseUrl: 'http://x', cache: false, },).cacheEnabled,).toBe(false,);
    },);
    it('apiKey presence selects apiKey mode unless mode set', () => {
        const c = resolveConfig({ baseUrl: 'http://x', auth: { apiKey: 'ssk_1', }, },);
        expect(c.authMode,).toBe('apiKey',);
        expect(c.apiKey,).toBe('ssk_1',);
    },);
    it('merges partial ttl and retry over defaults', () => {
        const c = resolveConfig({ baseUrl: 'http://x', cache: { ttl: { list: 5, }, }, retry: { attempts: 1, }, },);
        expect(c.ttl.list,).toBe(5,);
        expect(c.ttl.entity,).toBe(60_000,);
        expect(c.retry.attempts,).toBe(1,);
        expect(c.retry.backoffMs,).toBe(300,);
    },);
},);
```

- [ ] **Step 3: Implement `config.ts`**

```ts
import {
    type CmsClientConfig, type ResolvedConfig, DEFAULT_RETRY, DEFAULT_TTL,
} from './types';

function resolveFetch(injected?: typeof fetch,): typeof fetch {
    if (injected) return injected;
    if (typeof globalThis.fetch === 'function') return globalThis.fetch.bind(globalThis,);
    throw new Error('No fetch implementation available — pass `fetch` in the client config (Node < 18).',);
}

export function resolveConfig(config: CmsClientConfig,): ResolvedConfig {
    if (!config.baseUrl) throw new Error('cms-client: `baseUrl` is required.',);
    const baseUrl = config.baseUrl.replace(/\/+$/, '',);
    const cacheOpt = config.cache;
    const cacheEnabled = cacheOpt !== false;
    const cacheObj = (typeof cacheOpt === 'object' && cacheOpt !== null) ? cacheOpt : {};
    const authMode = config.auth?.mode ?? (config.auth?.apiKey ? 'apiKey' : 'bearer');

    return {
        baseUrl,
        apiBase: `${baseUrl}/api/v1`,
        authMode,
        apiKey: config.auth?.apiKey,
        initialTokens: config.auth?.tokens,
        storageKey: config.auth?.storageKey ?? 'cms.auth',
        customStore: config.auth?.store,
        cacheEnabled,
        cacheAdapter: cacheObj.adapter ?? 'auto',
        ttl: { ...DEFAULT_TTL, ...cacheObj.ttl, },
        namespace: cacheObj.namespace ?? 'cms',
        fetchImpl: resolveFetch(config.fetch,),
        timeoutMs: config.timeoutMs ?? 30_000,
        retry: { ...DEFAULT_RETRY, ...config.retry, },
        headers: config.headers ?? {},
        onError: config.onError,
    };
}
```

- [ ] **Step 4: Run → pass. Step 5: Commit** `feat(cms-client): config resolution + public option types`.

---

### Task 5: HTTP request core (TDD)

The funnel: URL build, query/params, body/FormData, timeout, envelope unwrap, raw passthrough, error throw. Auth + retry + cache are injected as collaborators in later tasks; here `request()` takes an explicit `headers` map and a `fetchImpl`.

**Files:** Create `packages/cms-client/src/core/url.ts`, `packages/cms-client/src/core/request.ts`, and `request.test.ts`.

- [ ] **Step 1: Create `url.ts`** (pure helpers, easy to unit-test):

```ts
/** Replace :param tokens in a path with encoded values. */
export function interpolatePath(path: string, params?: Record<string, string | number>,): string {
    if (!params) return path;
    return path.replace(/:([A-Za-z0-9_]+)/g, (_, key,) => {
        const v = params[key];
        if (v === undefined) throw new Error(`Missing path param ":${key}" for ${path}`,);
        return encodeURIComponent(String(v,),);
    },);
}

/** Serialize a query object to a string; drops undefined/null; numbers→strings. */
export function buildQuery(query?: Record<string, unknown>,): string {
    if (!query) return '';
    const sp = new URLSearchParams();
    for (const [k, v,] of Object.entries(query,)) {
        if (v === undefined || v === null) continue;
        if (Array.isArray(v,)) { for (const item of v) sp.append(k, String(item,),); }
        else sp.append(k, String(v,),);
    }
    const s = sp.toString();
    return s ? `?${s}` : '';
}

export function joinUrl(base: string, path: string, query?: Record<string, unknown>,): string {
    const p = path.startsWith('/',) ? path : `/${path}`;
    return `${base}${p}${buildQuery(query,)}`;
}
```

- [ ] **Step 2: Failing test `request.test.ts`** (covers url + request behavior with a mocked fetch):

```ts
import { describe, expect, it, vi, } from 'vitest';
import { interpolatePath, buildQuery, } from './url';
import { performRequest, } from './request';
import { NotFoundError, TimeoutError, } from './errors';

function jsonResponse(status: number, body: unknown,) {
    return new Response(JSON.stringify(body,), { status, headers: { 'content-type': 'application/json', }, },);
}

describe('url helpers', () => {
    it('interpolates params', () => {
        expect(interpolatePath('/posts/:id/revisions/:v', { id: 'a', v: 3, },),).toBe('/posts/a/revisions/3',);
    },);
    it('builds query, dropping nullish, numbers as strings', () => {
        expect(buildQuery({ page: 2, q: undefined, tag: 'x', },),).toBe('?page=2&tag=x',);
    },);
});

describe('performRequest', () => {
    const base = 'http://api/api/v1';

    it('unwraps the envelope and returns data', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, data: { id: '1', }, },),);
        const data = await performRequest({
            fetchImpl, method: 'GET', url: `${base}/posts/1`, headers: {}, timeoutMs: 1000,
        },);
        expect(data,).toEqual({ id: '1', },);
        expect(fetchImpl,).toHaveBeenCalledOnce();
    },);

    it('throws a typed error from a failure envelope', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            jsonResponse(404, { success: false, error: { code: 'NOT_FOUND', message: 'nope', }, },),);
        await expect(performRequest({
            fetchImpl, method: 'GET', url: `${base}/posts/x`, headers: {}, timeoutMs: 1000,
        },),).rejects.toBeInstanceOf(NotFoundError,);
    },);

    it('sends JSON body with content-type', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { success: true, data: { ok: true, }, },),);
        await performRequest({
            fetchImpl, method: 'POST', url: `${base}/posts`, headers: {}, body: { title: 'T', }, timeoutMs: 1000,
        },);
        const init = fetchImpl.mock.calls[0][1];
        expect(init.headers['Content-Type'],).toBe('application/json',);
        expect(JSON.parse(init.body,),).toEqual({ title: 'T', },);
    },);

    it('passes FormData without forcing content-type', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, { success: true, data: {}, },),);
        const fd = new FormData();
        await performRequest({
            fetchImpl, method: 'POST', url: `${base}/media`, headers: {}, body: fd, timeoutMs: 1000,
        },);
        const init = fetchImpl.mock.calls[0][1];
        expect(init.headers['Content-Type'],).toBeUndefined();
        expect(init.body,).toBe(fd,);
    },);

    it('raw:true returns the response text untouched', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(
            new Response('<rss/>', { status: 200, headers: { 'content-type': 'application/rss+xml', }, },),);
        const out = await performRequest({
            fetchImpl, method: 'GET', url: 'http://api/feed.xml', headers: {}, raw: true, timeoutMs: 1000,
        },);
        expect(out,).toBe('<rss/>',);
    },);

    it('maps an abort/timeout to TimeoutError', async () => {
        const fetchImpl = vi.fn().mockImplementation((_, init,) => new Promise((_res, rej,) => {
            init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted',), { name: 'AbortError', },)),);
        }),);
        await expect(performRequest({
            fetchImpl, method: 'GET', url: `${base}/slow`, headers: {}, timeoutMs: 5,
        },),).rejects.toBeInstanceOf(TimeoutError,);
    },);
},);
```

- [ ] **Step 3: Implement `request.ts`**

```ts
import type { ApiResponse, } from '@sitesurge/types';
import { AbortError, CmsError, errorFromEnvelope, NetworkError, TimeoutError, } from './errors';

export interface RequestSpec {
    fetchImpl: typeof fetch;
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
    /** true → return the raw text body, skip envelope unwrap (feed/sitemap). */
    raw?: boolean;
    timeoutMs: number;
    signal?: AbortSignal;
}

function isFormData(v: unknown,): v is FormData {
    return typeof FormData !== 'undefined' && v instanceof FormData;
}

/** Single network attempt. Builds init, enforces timeout, unwraps the
 *  ApiResponse envelope (or returns raw text), throws a typed CmsError. */
export async function performRequest<T,>(spec: RequestSpec,): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), spec.timeoutMs,);
    // Chain an external signal if provided.
    if (spec.signal) {
        if (spec.signal.aborted) controller.abort();
        else spec.signal.addEventListener('abort', () => controller.abort(), { once: true, },);
    }

    const headers: Record<string, string> = { ...spec.headers, };
    let body: BodyInit | undefined;
    if (spec.body !== undefined) {
        if (isFormData(spec.body,)) { body = spec.body; /* let fetch set the boundary */ }
        else { headers['Content-Type'] = 'application/json'; body = JSON.stringify(spec.body,); }
    }

    let res: Response;
    try {
        res = await spec.fetchImpl(spec.url, {
            method: spec.method, headers, body, signal: controller.signal, credentials: 'include',
        } as RequestInit,);
    } catch (err) {
        clearTimeout(timeout,);
        const name = (err as { name?: string; }).name;
        if (name === 'AbortError') {
            throw spec.signal?.aborted ? new AbortError() : new TimeoutError(`Request to ${spec.url} timed out`,);
        }
        throw new NetworkError((err as Error).message || 'Network request failed',);
    }
    clearTimeout(timeout,);

    if (spec.raw) {
        const text = await res.text();
        if (!res.ok) throw new CmsError(`Request failed (${res.status})`, { code: 'UNKNOWN_ERROR', status: res.status, },);
        return text as unknown as T;
    }

    let payload: ApiResponse<T>;
    try { payload = await res.json() as ApiResponse<T>; }
    catch { throw new CmsError(`Invalid JSON from ${spec.url} (${res.status})`, { code: 'UNKNOWN_ERROR', status: res.status, },); }

    if (res.ok && payload.success) return payload.data as T;

    const retryAfterHeader = res.headers.get('retry-after',);
    const retryAfter = retryAfterHeader ? Number(retryAfterHeader,) : undefined;
    const error = payload.error ?? { code: 'UNKNOWN_ERROR', message: `Request failed (${res.status})`, } as never;
    throw errorFromEnvelope(res.status, error, retryAfter,);
}
```

- [ ] **Step 4: Run → pass. Step 5: Commit** `feat(cms-client): request core — url build, envelope unwrap, raw, timeout`.

---

### Task 6: Retry policy (TDD)

Wrap `performRequest` with retry. GETs retry by default; non-GET only when `retry: true`.

**Files:** Create `packages/cms-client/src/core/retry.ts` + `retry.test.ts`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it, vi, } from 'vitest';
import { withRetry, } from './retry';
import { DEFAULT_RETRY, } from './types';
import { NetworkError, RateLimitedError, } from './errors';

const policy = { ...DEFAULT_RETRY, backoffMs: 1, maxBackoffMs: 2, };

describe('withRetry', () => {
    it('retries a GET on NetworkError then succeeds', async () => {
        const attempt = vi.fn()
            .mockRejectedValueOnce(new NetworkError(),)
            .mockResolvedValueOnce('ok',);
        const out = await withRetry(attempt, { method: 'GET', retryEnabled: true, policy, },);
        expect(out,).toBe('ok',);
        expect(attempt,).toHaveBeenCalledTimes(2,);
    },);
    it('does NOT retry a POST by default', async () => {
        const attempt = vi.fn().mockRejectedValue(new NetworkError(),);
        await expect(withRetry(attempt, { method: 'POST', retryEnabled: false, policy, },),).rejects.toBeInstanceOf(NetworkError,);
        expect(attempt,).toHaveBeenCalledTimes(1,);
    },);
    it('retries a POST when retryEnabled', async () => {
        const attempt = vi.fn().mockRejectedValueOnce(new NetworkError(),).mockResolvedValueOnce('ok',);
        const out = await withRetry(attempt, { method: 'POST', retryEnabled: true, policy, },);
        expect(out,).toBe('ok',);
    },);
    it('gives up after `attempts` and rethrows the last error', async () => {
        const attempt = vi.fn().mockRejectedValue(new NetworkError('down',),);
        await expect(withRetry(attempt, { method: 'GET', retryEnabled: true, policy: { ...policy, attempts: 2, }, },),)
            .rejects.toThrow('down',);
        expect(attempt,).toHaveBeenCalledTimes(2,);
    },);
    it('retries on a retryable status error (RateLimited 429)', async () => {
        const attempt = vi.fn()
            .mockRejectedValueOnce(new RateLimitedError('slow', { status: 429, },),)
            .mockResolvedValueOnce('ok',);
        const out = await withRetry(attempt, { method: 'GET', retryEnabled: true, policy, },);
        expect(out,).toBe('ok',);
    },);
    it('does not retry a non-retryable error (404)', async () => {
        const e = Object.assign(new Error('nf',), { status: 404, },);
        const attempt = vi.fn().mockRejectedValue(e,);
        await expect(withRetry(attempt, { method: 'GET', retryEnabled: true, policy, },),).rejects.toBe(e,);
        expect(attempt,).toHaveBeenCalledTimes(1,);
    },);
},);
```

- [ ] **Step 2: Run → fail. Step 3: Implement `retry.ts`**

```ts
import type { RetryPolicy, } from './types';
import { CmsError, NetworkError, TimeoutError, } from './errors';

interface RetryContext { method: string; retryEnabled: boolean; policy: RetryPolicy; }

function isRetryable(err: unknown, policy: RetryPolicy,): boolean {
    if (err instanceof NetworkError || err instanceof TimeoutError) return true;
    const status = (err as CmsError).status;
    return typeof status === 'number' && policy.retryStatuses.includes(status,);
}

const sleep = (ms: number,) => new Promise<void>((r,) => setTimeout(r, ms,),);

/** Run `attempt` with the retry policy. GET retries by default; other
 *  methods only when `retryEnabled`. Exponential backoff honoring a
 *  RateLimitedError.retryAfter when present. */
export async function withRetry<T,>(attempt: () => Promise<T>, ctx: RetryContext,): Promise<T> {
    const canRetry = ctx.method === 'GET' || ctx.method === 'HEAD' || ctx.retryEnabled;
    const maxAttempts = canRetry ? ctx.policy.attempts : 1;
    let lastErr: unknown;
    for (let i = 0; i < maxAttempts; i++) {
        try { return await attempt(); }
        catch (err) {
            lastErr = err;
            if (i === maxAttempts - 1 || !isRetryable(err, ctx.policy,)) throw err;
            const retryAfter = (err as { retryAfter?: number; }).retryAfter;
            const backoff = retryAfter !== undefined
                ? retryAfter * 1000
                : Math.min(ctx.policy.backoffMs * 2 ** i, ctx.policy.maxBackoffMs,);
            await sleep(backoff,);
        }
    }
    throw lastErr;
}
```

- [ ] **Step 4: Run → pass. Step 5: Commit** `feat(cms-client): retry policy (GET auto, writes opt-in, backoff)`.

---

### Task 7: Token store + AuthManager (TDD)

**Files:** Create `packages/cms-client/src/core/auth/tokenStore.ts`, `packages/cms-client/src/core/auth/authManager.ts`, `authManager.test.ts`.

- [ ] **Step 1: Implement `tokenStore.ts`** (no test needed beyond the manager's — it's thin):

```ts
import type { AuthTokens, TokenStore, } from '../types';

/** localStorage-backed store (browser). Falls back to an in-memory map
 *  when localStorage is unavailable (Node/SSR). */
export function createDefaultTokenStore(storageKey: string,): TokenStore {
    const hasLs = (() => {
        try { return typeof localStorage !== 'undefined' && localStorage !== null; } catch { return false; }
    })();
    if (!hasLs) {
        let mem: AuthTokens | null = null;
        return { load: () => mem, save: (t,) => { mem = t; }, clear: () => { mem = null; }, };
    }
    return {
        load() {
            try { const raw = localStorage.getItem(storageKey,); return raw ? JSON.parse(raw,) as AuthTokens : null; }
            catch { return null; }
        },
        save(tokens,) { try { localStorage.setItem(storageKey, JSON.stringify(tokens,),); } catch { /* quota */ } },
        clear() { try { localStorage.removeItem(storageKey,); } catch { /* ignore */ } },
    };
}
```

- [ ] **Step 2: Failing test `authManager.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi, } from 'vitest';
import { AuthManager, } from './authManager';
import type { AuthTokens, TokenStore, } from '../types';

function memStore(initial: AuthTokens | null = null,): TokenStore {
    let v = initial;
    return { load: () => v, save: (t,) => { v = t; }, clear: () => { v = null; }, };
}
const tokens = (a: string,): AuthTokens => ({ accessToken: a, refreshToken: `r-${a}`, },);

describe('AuthManager', () => {
    it('auto-loads tokens from the store on construction (bearer)', async () => {
        const mgr = new AuthManager({ mode: 'bearer', store: memStore(tokens('A',),), apiBase: 'http://x/api/v1', fetchImpl: vi.fn(), },);
        await mgr.ready;
        expect((await mgr.authHeaders('GET',))['Authorization'],).toBe('Bearer A',);
    },);
    it('apiKey mode sets the static bearer header, no store', async () => {
        const mgr = new AuthManager({ mode: 'apiKey', apiKey: 'ssk_k', apiBase: 'http://x/api/v1', fetchImpl: vi.fn(), },);
        await mgr.ready;
        expect((await mgr.authHeaders('GET',))['Authorization'],).toBe('Bearer ssk_k',);
    },);
    it('login stores tokens and emits change', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            success: true, data: { user: { id: 'u', }, accessToken: 'A', refreshToken: 'R', expiresAt: 'later', },
        },), { status: 200, headers: { 'content-type': 'application/json', }, },),);
        const store = memStore();
        const mgr = new AuthManager({ mode: 'bearer', store, apiBase: 'http://x/api/v1', fetchImpl, },);
        const changed = vi.fn(); mgr.onChange(changed,);
        const res = await mgr.login({ email: 'a@b.c', password: 'pw', },);
        expect(res.accessToken,).toBe('A',);
        expect((store.load() as AuthTokens).accessToken,).toBe('A',);
        expect(changed,).toHaveBeenCalled();
    },);
    it('refresh is single-flight across concurrent callers', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            success: true, data: { user: { id: 'u', }, accessToken: 'A2', refreshToken: 'R2', expiresAt: 'l', },
        },), { status: 200, headers: { 'content-type': 'application/json', }, },),);
        const mgr = new AuthManager({ mode: 'bearer', store: memStore(tokens('A',),), apiBase: 'http://x/api/v1', fetchImpl, },);
        await mgr.ready;
        const [a, b,] = await Promise.all([mgr.refresh(), mgr.refresh(),],);
        expect(a,).toBe(b,);
        expect(fetchImpl,).toHaveBeenCalledOnce(); // de-duped
    },);
    it('logout clears the store', async () => {
        const store = memStore(tokens('A',),);
        const mgr = new AuthManager({ mode: 'bearer', store, apiBase: 'http://x/api/v1', fetchImpl: vi.fn().mockResolvedValue(new Response('{}', { status: 200, },),), },);
        await mgr.ready;
        await mgr.logout();
        expect(store.load(),).toBeNull();
    },);
});
```

- [ ] **Step 3: Implement `authManager.ts`**

```ts
import type { AuthResponse, LoginCredentials, } from '@sitesurge/types';
import type { AuthMode, AuthTokens, TokenStore, } from '../types';
import { Emitter, } from '../events';
import { performRequest, } from '../request';
import { UnauthorizedError, } from '../errors';

interface AuthManagerOpts {
    mode: AuthMode;
    apiBase: string;
    fetchImpl: typeof fetch;
    apiKey?: string;
    tokens?: AuthTokens;
    store?: TokenStore | null;
}

/** Owns auth state. Decorates each request with the right credential and
 *  runs the single-flight refresh on 401. Auto-loads persisted tokens on
 *  construction so a page refresh restores the session. */
export class AuthManager {
    readonly ready: Promise<void>;
    private mode: AuthMode;
    private apiKey?: string;
    private tokens: AuthTokens | null = null;
    private store?: TokenStore | null;
    private apiBase: string;
    private fetchImpl: typeof fetch;
    private refreshInFlight: Promise<AuthResponse> | null = null;
    private emitter = new Emitter<{ change: AuthTokens | null; expired: void; },>();
    private csrfReady = false;

    constructor(opts: AuthManagerOpts,) {
        this.mode = opts.mode;
        this.apiKey = opts.apiKey;
        this.store = opts.store;
        this.apiBase = opts.apiBase;
        this.fetchImpl = opts.fetchImpl;
        this.ready = this.init(opts.tokens,);
    }

    private async init(initial?: AuthTokens,): Promise<void> {
        if (this.mode !== 'bearer') return;
        if (initial) { this.tokens = initial; await this.store?.save(initial,); return; }
        const loaded = await this.store?.load();
        if (loaded) this.tokens = loaded;
    }

    onChange(cb: (t: AuthTokens | null,) => void,): () => void { return this.emitter.on('change', cb,); }
    onExpired(cb: () => void,): () => void { return this.emitter.on('expired', cb,); }

    isAuthenticated(): boolean { return this.mode === 'apiKey' ? !!this.apiKey : !!this.tokens; }
    getTokens(): AuthTokens | null { return this.tokens; }

    /** Headers to attach to an outgoing request. */
    async authHeaders(method: string,): Promise<Record<string, string>> {
        const h: Record<string, string> = {};
        if (this.mode === 'apiKey' && this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
        else if (this.mode === 'bearer' && this.tokens) h['Authorization'] = `Bearer ${this.tokens.accessToken}`;
        else if (this.mode === 'cookie' && !['GET', 'HEAD', 'OPTIONS',].includes(method,)) {
            const csrf = await this.ensureCsrf();
            if (csrf) h['x-csrf-token'] = csrf;
        }
        return h;
    }

    private getCookie(name: string,): string | null {
        if (typeof document === 'undefined') return null;
        const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`,),);
        return m ? decodeURIComponent(m[1],) : null;
    }

    private async ensureCsrf(): Promise<string | null> {
        let token = this.getCookie('csrf-token',);
        if (!token && !this.csrfReady) {
            try { await this.fetchImpl(`${this.apiBase}/health/live`, { credentials: 'include', },); } catch { /* ignore */ }
            this.csrfReady = true;
            token = this.getCookie('csrf-token',);
        }
        return token;
    }

    async login(credentials: LoginCredentials & { rememberMe?: boolean; },): Promise<AuthResponse> {
        const res = await performRequest<AuthResponse>({
            fetchImpl: this.fetchImpl, method: 'POST', url: `${this.apiBase}/auth/login`,
            headers: {}, body: credentials, timeoutMs: 30_000,
        },);
        await this.setSession(res,);
        return res;
    }

    async refresh(): Promise<AuthResponse> {
        if (this.refreshInFlight) return this.refreshInFlight;
        if (!this.tokens) throw new UnauthorizedError('No refresh token', { code: 'UNAUTHORIZED', status: 401, },);
        this.refreshInFlight = (async () => {
            try {
                const res = await performRequest<AuthResponse>({
                    fetchImpl: this.fetchImpl, method: 'POST', url: `${this.apiBase}/auth/refresh`,
                    headers: {}, body: { refreshToken: this.tokens!.refreshToken, }, timeoutMs: 30_000,
                },);
                await this.setSession(res,);
                return res;
            } catch (err) {
                await this.clearSession();
                this.emitter.emit('expired', undefined,);
                throw err;
            } finally { this.refreshInFlight = null; }
        })();
        return this.refreshInFlight;
    }

    async logout(): Promise<void> {
        try {
            await performRequest({
                fetchImpl: this.fetchImpl, method: 'POST', url: `${this.apiBase}/auth/logout`,
                headers: await this.authHeaders('POST',), timeoutMs: 30_000,
            },);
        } catch { /* best effort */ }
        await this.clearSession();
    }

    setApiKey(key: string,): void { this.mode = 'apiKey'; this.apiKey = key; }

    private async setSession(res: AuthResponse,): Promise<void> {
        this.tokens = { accessToken: res.accessToken, refreshToken: res.refreshToken,
            expiresAt: res.expiresAt as unknown as string, };
        await this.store?.save(this.tokens,);
        this.emitter.emit('change', this.tokens,);
    }

    private async clearSession(): Promise<void> {
        this.tokens = null;
        await this.store?.clear();
        this.emitter.emit('change', null,);
    }
}
```

- [ ] **Step 4: Run → pass (5 tests). Step 5: Commit** `feat(cms-client): AuthManager — token auto-load, single-flight refresh, modes`.

---

### Task 8: Cache adapters (TDD)

**Files:** Create `packages/cms-client/src/core/cache/adapters/memory.ts`, `localstorage.ts`, `indexeddb.ts`, `detect.ts`, and `adapters.test.ts`.

- [ ] **Step 1: Failing test `adapters.test.ts`** (shared contract test run against memory + a fake-indexeddb-backed IDB adapter):

```ts
import { beforeEach, describe, expect, it, } from 'vitest';
import 'fake-indexeddb/auto';
import { MemoryAdapter, } from './memory';
import { IndexedDbAdapter, } from './indexeddb';
import type { CacheAdapter, CacheEntry, } from '../../types';

const entry = <T,>(value: T,): CacheEntry<T> => ({ value, storedAt: 1, expiresAt: 2, });

function contract(name: string, make: () => CacheAdapter,) {
    describe(name, () => {
        let a: CacheAdapter;
        beforeEach(() => { a = make(); },);
        it('set/get round-trips', async () => {
            await a.set('cms:posts:list:1', entry({ id: 'p', },),);
            expect((await a.get('cms:posts:list:1',))?.value,).toEqual({ id: 'p', },);
        },);
        it('get missing → null', async () => { expect(await a.get('nope',),).toBeNull(); },);
        it('delete removes one key', async () => {
            await a.set('k', entry(1,),); await a.delete('k',);
            expect(await a.get('k',),).toBeNull();
        },);
        it('deletePrefix removes matching keys only', async () => {
            await a.set('cms:posts:list:1', entry(1,),);
            await a.set('cms:posts:list:2', entry(2,),);
            await a.set('cms:users:list:1', entry(3,),);
            await a.deletePrefix('cms:posts:list:',);
            expect(await a.get('cms:posts:list:1',),).toBeNull();
            expect(await a.get('cms:posts:list:2',),).toBeNull();
            expect((await a.get('cms:users:list:1',))?.value,).toBe(3,);
        },);
    },);
}

contract('MemoryAdapter', () => new MemoryAdapter(),);
contract('IndexedDbAdapter', () => new IndexedDbAdapter('cms-cache-test',),);
```

- [ ] **Step 2: Run → fail. Step 3: Implement the four files.**

`memory.ts`:
```ts
import type { CacheAdapter, CacheEntry, } from '../../types';

export class MemoryAdapter implements CacheAdapter {
    private map = new Map<string, CacheEntry<unknown>>();
    async get<T,>(key: string,): Promise<CacheEntry<T> | null> { return (this.map.get(key,) as CacheEntry<T>) ?? null; }
    async set<T,>(key: string, entry: CacheEntry<T>,): Promise<void> { this.map.set(key, entry,); }
    async delete(key: string,): Promise<void> { this.map.delete(key,); }
    async deletePrefix(prefix: string,): Promise<void> {
        for (const k of this.map.keys()) if (k.startsWith(prefix,)) this.map.delete(k,);
    }
    async clear(): Promise<void> { this.map.clear(); }
}
```

`localstorage.ts`:
```ts
import type { CacheAdapter, CacheEntry, } from '../../types';

/** localStorage adapter. Keys are prefixed so deletePrefix/clear only
 *  touch this client's entries. */
export class LocalStorageAdapter implements CacheAdapter {
    constructor(private prefix = 'cms-cache:',) {}
    private k(key: string,): string { return this.prefix + key; }
    async get<T,>(key: string,): Promise<CacheEntry<T> | null> {
        try { const raw = localStorage.getItem(this.k(key,),); return raw ? JSON.parse(raw,) as CacheEntry<T> : null; }
        catch { return null; }
    }
    async set<T,>(key: string, entry: CacheEntry<T>,): Promise<void> {
        try { localStorage.setItem(this.k(key,), JSON.stringify(entry,),); } catch { /* quota: best effort */ }
    }
    async delete(key: string,): Promise<void> { try { localStorage.removeItem(this.k(key,),); } catch { /* ignore */ } }
    async deletePrefix(prefix: string,): Promise<void> {
        const full = this.k(prefix,);
        const toRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i,);
            if (key && key.startsWith(full,)) toRemove.push(key,);
        }
        for (const key of toRemove) localStorage.removeItem(key,);
    }
    async clear(): Promise<void> { await this.deletePrefix('',); }
}
```

`indexeddb.ts`:
```ts
import type { CacheAdapter, CacheEntry, } from '../../types';

const STORE = 'entries';

/** IndexedDB adapter — one object store keyed by the cache key. */
export class IndexedDbAdapter implements CacheAdapter {
    private dbPromise: Promise<IDBDatabase>;
    constructor(dbName = 'cms-cache',) { this.dbPromise = this.open(dbName,); }

    private open(name: string,): Promise<IDBDatabase> {
        return new Promise((resolve, reject,) => {
            const req = indexedDB.open(name, 1,);
            req.onupgradeneeded = () => { req.result.createObjectStore(STORE,); };
            req.onsuccess = () => resolve(req.result,);
            req.onerror = () => reject(req.error,);
        },);
    }

    private async tx(mode: IDBTransactionMode,): Promise<IDBObjectStore> {
        const db = await this.dbPromise;
        return db.transaction(STORE, mode,).objectStore(STORE,);
    }

    async get<T,>(key: string,): Promise<CacheEntry<T> | null> {
        const store = await this.tx('readonly',);
        return new Promise((resolve, reject,) => {
            const req = store.get(key,);
            req.onsuccess = () => resolve((req.result as CacheEntry<T>) ?? null,);
            req.onerror = () => reject(req.error,);
        },);
    }
    async set<T,>(key: string, entry: CacheEntry<T>,): Promise<void> {
        const store = await this.tx('readwrite',);
        return new Promise((resolve, reject,) => {
            const req = store.put(entry, key,);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error,);
        },);
    }
    async delete(key: string,): Promise<void> {
        const store = await this.tx('readwrite',);
        return new Promise((resolve, reject,) => {
            const req = store.delete(key,);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error,);
        },);
    }
    async deletePrefix(prefix: string,): Promise<void> {
        const store = await this.tx('readwrite',);
        return new Promise((resolve, reject,) => {
            const req = store.openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) { resolve(); return; }
                if (String(cursor.key,).startsWith(prefix,)) cursor.delete();
                cursor.continue();
            };
            req.onerror = () => reject(req.error,);
        },);
    }
    async clear(): Promise<void> {
        const store = await this.tx('readwrite',);
        return new Promise((resolve, reject,) => {
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error,);
        },);
    }
}
```

`detect.ts`:
```ts
import type { CacheAdapter, CacheAdapterKind, } from '../../types';
import { IndexedDbAdapter, } from './indexeddb';
import { LocalStorageAdapter, } from './localstorage';
import { MemoryAdapter, } from './memory';

/** Resolve an adapter spec to a concrete adapter. 'auto' picks the best
 *  available: IndexedDB → localStorage → memory. */
export function resolveAdapter(spec: CacheAdapter | CacheAdapterKind, namespace: string,): CacheAdapter {
    if (typeof spec === 'object') return spec;
    const hasIdb = typeof indexedDB !== 'undefined';
    const hasLs = (() => { try { return typeof localStorage !== 'undefined' && localStorage !== null; } catch { return false; } })();
    switch (spec) {
        case 'indexeddb': return new IndexedDbAdapter(`${namespace}-cache`,);
        case 'localstorage': return new LocalStorageAdapter(`${namespace}-cache:`,);
        case 'memory': return new MemoryAdapter();
        case 'auto':
        default:
            if (hasIdb) return new IndexedDbAdapter(`${namespace}-cache`,);
            if (hasLs) return new LocalStorageAdapter(`${namespace}-cache:`,);
            return new MemoryAdapter();
    }
}
```

- [ ] **Step 4: Run → pass (both adapters share the contract). Step 5: Commit** `feat(cms-client): cache adapters — memory, localStorage, IndexedDB + detect`.

---

### Task 9: CacheManager — SWR + keys + invalidation (TDD)

**Files:** Create `packages/cms-client/src/core/cache/keys.ts`, `packages/cms-client/src/core/cache/cacheManager.ts`, `cacheManager.test.ts`.

- [ ] **Step 1: Create `keys.ts`**

```ts
/** Stable JSON stringify (sorted keys) so equal args produce equal keys. */
function stableStringify(value: unknown,): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value,) ?? 'null';
    if (Array.isArray(value,)) return `[${value.map(stableStringify,).join(',',)}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj,).filter((k,) => obj[k] !== undefined,).sort();
    return `{${keys.map((k,) => `${JSON.stringify(k,)}:${stableStringify(obj[k],)}`,).join(',',)}}`;
}

/** cms:<module>:<method>:<argsHash> */
export function cacheKey(namespace: string, module: string, method: string, args?: unknown,): string {
    const hash = args === undefined ? '' : stableStringify(args,);
    return `${namespace}:${module}:${method}:${hash}`;
}

/** prefix for invalidating every key of module.method (or whole module). */
export function cacheKeyPrefix(namespace: string, module: string, method?: string,): string {
    return method ? `${namespace}:${module}:${method}:` : `${namespace}:${module}:`;
}
```

- [ ] **Step 2: Failing test `cacheManager.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi, } from 'vitest';
import { CacheManager, } from './cacheManager';
import { MemoryAdapter, } from './adapters/memory';

function mgr() { return new CacheManager({ adapter: new MemoryAdapter(), enabled: true, defaultTtl: 1000, },); }

describe('CacheManager.read (SWR)', () => {
    it('miss → calls fetcher, caches, returns value', async () => {
        const c = mgr();
        const fetcher = vi.fn().mockResolvedValue('V',);
        expect(await c.read('k', fetcher, {},),).toBe('V',);
        expect(fetcher,).toHaveBeenCalledOnce();
    },);
    it('fresh hit → returns cached WITHOUT calling fetcher', async () => {
        const c = mgr();
        const fetcher = vi.fn().mockResolvedValue('V',);
        await c.read('k', fetcher,);
        const fetcher2 = vi.fn().mockResolvedValue('V2',);
        expect(await c.read('k', fetcher2,),).toBe('V',);
        expect(fetcher2,).not.toHaveBeenCalled();
    },);
    it('stale hit → returns stale immediately AND revalidates in background, notifying subscribers', async () => {
        const c = new CacheManager({ adapter: new MemoryAdapter(), enabled: true, defaultTtl: 0, }); // instantly stale
        const sub = vi.fn();
        await c.read('k', vi.fn().mockResolvedValue('OLD',),);
        c.subscribe('k', sub,);
        const fresh = vi.fn().mockResolvedValue('NEW',);
        const returned = await c.read('k', fresh,);
        expect(returned,).toBe('OLD',); // stale-while-revalidate
        await new Promise((r,) => setTimeout(r, 10,),);
        expect(fresh,).toHaveBeenCalled();
        expect(sub,).toHaveBeenCalledWith('NEW',);
    },);
    it('cache:false bypasses read and write', async () => {
        const c = mgr();
        const f1 = vi.fn().mockResolvedValue('A',); await c.read('k', f1, { cache: false, },);
        const f2 = vi.fn().mockResolvedValue('B',);
        expect(await c.read('k', f2, { cache: false, },),).toBe('B',);
        expect(f2,).toHaveBeenCalled();
    },);
    it('invalidatePrefix drops keys and revalidates on next read', async () => {
        const c = mgr();
        await c.read('cms:posts:list:', vi.fn().mockResolvedValue('OLD',),);
        await c.invalidatePrefix('cms:posts:',);
        const f = vi.fn().mockResolvedValue('NEW',);
        expect(await c.read('cms:posts:list:', f,),).toBe('NEW',);
        expect(f,).toHaveBeenCalled();
    },);
    it('disabled manager always calls fetcher', async () => {
        const c = new CacheManager({ adapter: new MemoryAdapter(), enabled: false, defaultTtl: 1000, });
        const f = vi.fn().mockResolvedValue('X',);
        await c.read('k', f,); await c.read('k', f,);
        expect(f,).toHaveBeenCalledTimes(2,);
    },);
},);
```

- [ ] **Step 3: Implement `cacheManager.ts`**

```ts
import type { CacheAdapter, CacheEntry, QueryOptions, } from '../types';
import { Emitter, } from '../events';

interface CacheManagerOpts { adapter: CacheAdapter; enabled: boolean; defaultTtl: number; }

/** SWR cache. read() returns cached data instantly (even stale), kicks a
 *  background revalidation when stale/missing, and notifies subscribers
 *  when the value changes. Mutations call invalidatePrefix(). */
export class CacheManager {
    private adapter: CacheAdapter;
    private enabled: boolean;
    private defaultTtl: number;
    private emitter = new Emitter<Record<string, unknown>>();
    private inFlight = new Map<string, Promise<unknown>>();

    constructor(opts: CacheManagerOpts,) {
        this.adapter = opts.adapter; this.enabled = opts.enabled; this.defaultTtl = opts.defaultTtl;
    }

    subscribe<T,>(key: string, cb: (value: T,) => void,): () => void {
        return this.emitter.on(key, cb as (v: unknown,) => void,);
    }

    async read<T,>(key: string, fetcher: () => Promise<T>, opts: QueryOptions = {},): Promise<T> {
        if (!this.enabled || opts.cache === false) return fetcher();
        const ttl = opts.ttl ?? this.defaultTtl;
        const cached = await this.adapter.get<T>(key,);
        if (cached) {
            const stale = Date.now() >= cached.expiresAt;
            if (stale) void this.revalidate(key, fetcher, ttl, cached.value,);
            return cached.value;
        }
        return this.revalidate(key, fetcher, ttl, undefined,);
    }

    /** Run the fetcher (de-duped per key), write the entry, notify on change. */
    private async revalidate<T,>(key: string, fetcher: () => Promise<T>, ttl: number, prev: T | undefined,): Promise<T> {
        const existing = this.inFlight.get(key,) as Promise<T> | undefined;
        if (existing) return existing;
        const p = (async () => {
            try {
                const value = await fetcher();
                const entry: CacheEntry<T> = { value, storedAt: Date.now(), expiresAt: Date.now() + ttl, };
                await this.adapter.set(key, entry,);
                if (prev !== undefined && JSON.stringify(prev,) !== JSON.stringify(value,)) {
                    this.emitter.emit(key, value as never,);
                }
                return value;
            } finally { this.inFlight.delete(key,); }
        })();
        this.inFlight.set(key, p,);
        return p;
    }

    async set<T,>(key: string, value: T, ttl?: number,): Promise<void> {
        if (!this.enabled) return;
        const t = ttl ?? this.defaultTtl;
        await this.adapter.set(key, { value, storedAt: Date.now(), expiresAt: Date.now() + t, },);
    }

    async invalidate(key: string,): Promise<void> { await this.adapter.delete(key,); }
    async invalidatePrefix(prefix: string,): Promise<void> { await this.adapter.deletePrefix(prefix,); }
    async clear(): Promise<void> { await this.adapter.clear(); }
}
```

- [ ] **Step 4: Run → pass (6 tests). Step 5: Commit** `feat(cms-client): SWR CacheManager + stable cache keys + invalidation`.

---

### Task 10: Client assembly + ModuleBase (TDD)

Wires config → auth → cache → request pipeline, exposes the error bus, and gives modules `get/mutate/raw/upload` helpers. Auth-refresh-on-401 lives here (request → on 401 expired → refresh → retry once).

**Files:** Create `packages/cms-client/src/core/client.ts`, `packages/cms-client/src/modules/base.ts`, `client.test.ts`. Modify `packages/cms-client/src/index.ts`.

- [ ] **Step 1: Implement `client.ts`**

```ts
import type { CmsClientConfig, MutationOptions, QueryOptions, ResolvedConfig, } from './types';
import type { AuthResponse, LoginCredentials, } from '@sitesurge/types';
import { resolveConfig, } from './config';
import { AuthManager, } from './auth/authManager';
import { createDefaultTokenStore, } from './auth/tokenStore';
import { CacheManager, } from './cache/cacheManager';
import { resolveAdapter, } from './cache/adapters/detect';
import { cacheKey, cacheKeyPrefix, } from './cache/keys';
import { performRequest, } from './request';
import { withRetry, } from './retry';
import { joinUrl, } from './url';
import { CmsError, UnauthorizedError, } from './errors';
import { Emitter, } from './events';

export interface InternalRequest {
    module: string;
    method: string;            // HTTP verb
    path: string;              // e.g. '/posts/:id' (already interpolated by caller)
    query?: Record<string, unknown>;
    body?: unknown;
    raw?: boolean;
    rootMounted?: boolean;     // feed/sitemap: skip /api/v1 prefix
    options?: MutationOptions & QueryOptions;
}

/** The wired client. Modules call `client.send()`; consumers use the
 *  public surface (auth, cache, onError) + the assembled `cms.<module>`. */
export class CmsClientCore {
    readonly config: ResolvedConfig;
    readonly auth: AuthManager;
    readonly cache: CacheManager;
    private errorBus = new Emitter<{ error: CmsError; },>();

    constructor(rawConfig: CmsClientConfig,) {
        this.config = resolveConfig(rawConfig,);
        const store = this.config.authMode === 'bearer'
            ? (this.config.customStore === undefined ? createDefaultTokenStore(this.config.storageKey,) : this.config.customStore)
            : undefined;
        this.auth = new AuthManager({
            mode: this.config.authMode, apiBase: this.config.apiBase, fetchImpl: this.config.fetchImpl,
            apiKey: this.config.apiKey, tokens: this.config.initialTokens, store,
        },);
        this.cache = new CacheManager({
            adapter: resolveAdapter(this.config.cacheAdapter, this.config.namespace,),
            enabled: this.config.cacheEnabled, defaultTtl: this.config.ttl.list,
        },);
        if (this.config.onError) this.onError(this.config.onError,);
    }

    /** Subscribe to every CmsError thrown by any call (toast/log/custom). */
    onError(handler: (e: CmsError,) => void,): () => void { return this.errorBus.on('error', handler,); }

    cacheKeyFor(module: string, method: string, args?: unknown,): string {
        return cacheKey(this.config.namespace, module, method, args,);
    }

    private baseFor(req: InternalRequest,): string { return req.rootMounted ? this.config.baseUrl : this.config.apiBase; }

    /** One network call with auth headers + 401-refresh-retry. */
    private async dispatch<T,>(req: InternalRequest,): Promise<T> {
        await this.auth.ready;
        const url = joinUrl(this.baseFor(req,), req.path, req.query,);
        const send = async (): Promise<T> => {
            const headers: Record<string, string> = {
                ...this.config.headers, ...(await this.auth.authHeaders(req.method,)),
            };
            if (req.options?.idempotencyKey) headers['Idempotency-Key'] = req.options.idempotencyKey;
            return performRequest<T>({
                fetchImpl: this.config.fetchImpl, method: req.method, url, headers,
                body: req.body, raw: req.raw, timeoutMs: this.config.timeoutMs, signal: req.options?.signal,
            },);
        };
        try { return await send(); }
        catch (err) {
            // One automatic refresh+retry on an expired bearer token.
            if (err instanceof UnauthorizedError && this.config.authMode === 'bearer'
                && this.auth.getTokens() && /expired/i.test(err.message,)) {
                await this.auth.refresh();
                return send();
            }
            throw err;
        }
    }

    /** Module entry point. GET → cached+retry; mutations → network + invalidate. */
    async send<T,>(req: InternalRequest,): Promise<T> {
        const retryEnabled = req.options?.retry ?? false;
        const run = () => withRetry(() => this.dispatch<T>(req,), {
            method: req.method, retryEnabled, policy: this.config.retry,
        },);
        try {
            if (req.method === 'GET' && !req.raw) {
                const key = this.cacheKeyFor(req.module, pathMethodKey(req,), req.query ?? null,);
                const ttl = req.options?.ttl ?? this.config.ttl.list;
                return await this.cache.read<T>(key, run, { cache: req.options?.cache, ttl, },);
            }
            const out = await run();
            await this.applyInvalidation(req,);
            return out;
        } catch (err) {
            if (err instanceof CmsError) this.errorBus.emit('error', err,);
            throw err;
        }
    }

    /** Subscribe to live updates for a cached GET (SWR background refresh). */
    subscribe<T,>(module: string, method: string, args: unknown, cb: (value: T,) => void,): () => void {
        return this.cache.subscribe<T>(this.cacheKeyFor(module, method, args ?? null,), cb,);
    }

    /** Drop a module's (or method's) cached keys. Modules declare what a
     *  mutation invalidates via req.options is not enough — base.ts passes
     *  explicit invalidation targets through `send` extension below. */
    private async applyInvalidation(req: InternalRequest,): Promise<void> {
        const targets = (req as InternalRequest & { invalidates?: string[]; }).invalidates;
        if (!targets) return;
        for (const t of targets) {
            // t is either 'module' or 'module.method'
            const [module, method,] = t.split('.',);
            await this.cache.invalidatePrefix(cacheKeyPrefix(this.config.namespace, module, method,),);
        }
    }

    // ── auth convenience passthroughs ──
    login(c: LoginCredentials & { rememberMe?: boolean; },): Promise<AuthResponse> { return this.auth.login(c,); }
    logout(): Promise<void> { return this.auth.logout(); }
    isAuthenticated(): boolean { return this.auth.isAuthenticated(); }
    setApiKey(key: string,): void { this.auth.setApiKey(key,); }
}

/** Cache method label derived from the route (the GET path without params). */
function pathMethodKey(req: InternalRequest,): string { return req.path; }
```

- [ ] **Step 2: Implement `modules/base.ts`**

```ts
import type { CmsClientCore, InternalRequest, } from '../core/client';
import type { MutationOptions, QueryOptions, } from '../core/types';
import { interpolatePath, } from '../core/url';

/** Base every module namespace extends. Provides typed helpers that build
 *  an InternalRequest and delegate to the core. Mutations declare the
 *  cache prefixes they invalidate. */
export abstract class ModuleBase {
    protected abstract readonly module: string;
    constructor(protected readonly core: CmsClientCore,) {}

    /** Cached GET. */
    protected get<T,>(path: string, opts: {
        params?: Record<string, string | number>; query?: Record<string, unknown>;
        rootMounted?: boolean; raw?: boolean; options?: QueryOptions;
    } = {},): Promise<T> {
        return this.core.send<T>({
            module: this.module, method: 'GET', path: interpolatePath(path, opts.params,),
            query: opts.query, raw: opts.raw, rootMounted: opts.rootMounted, options: opts.options,
        },);
    }

    /** Mutation (POST/PUT/PATCH/DELETE). `invalidates` lists 'module' or
     *  'module.method' cache prefixes to drop after success. */
    protected mutate<T,>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, opts: {
        params?: Record<string, string | number>; query?: Record<string, unknown>;
        body?: unknown; invalidates?: string[]; options?: MutationOptions;
    } = {},): Promise<T> {
        const req: InternalRequest & { invalidates?: string[]; } = {
            module: this.module, method, path: interpolatePath(path, opts.params,),
            query: opts.query, body: opts.body, options: opts.options, invalidates: opts.invalidates,
        };
        return this.core.send<T>(req,);
    }

    /** Multipart upload (FormData passes through untouched). */
    protected upload<T,>(path: string, formData: FormData, opts: {
        params?: Record<string, string | number>; invalidates?: string[]; options?: MutationOptions;
    } = {},): Promise<T> {
        const req: InternalRequest & { invalidates?: string[]; } = {
            module: this.module, method: 'POST', path: interpolatePath(path, opts.params,),
            body: formData, options: opts.options, invalidates: opts.invalidates,
        };
        return this.core.send<T>(req,);
    }

    /** Raw text GET (XML/HTML). */
    protected rawGet(path: string, opts: { rootMounted?: boolean; options?: QueryOptions; } = {},): Promise<string> {
        return this.core.send<string>({
            module: this.module, method: 'GET', path, raw: true,
            rootMounted: opts.rootMounted, options: opts.options,
        },);
    }
}
```

- [ ] **Step 3: Failing test `client.test.ts`** (uses a mocked fetch; asserts: cached GET served from cache on 2nd call; mutation invalidates; 401 refresh-retry; error bus fires):

```ts
import { describe, expect, it, vi, } from 'vitest';
import { CmsClientCore, } from './client';

function envelope(data: unknown, status = 200,) {
    return new Response(JSON.stringify({ success: status < 400, data, },), { status, headers: { 'content-type': 'application/json', }, },);
}
function errorEnvelope(code: string, message: string, status: number,) {
    return new Response(JSON.stringify({ success: false, error: { code, message, }, },), { status, headers: { 'content-type': 'application/json', }, },);
}

describe('CmsClientCore', () => {
    it('caches a GET — second send is served from cache (one fetch)', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(envelope([{ id: 'p', },],),);
        const core = new CmsClientCore({ baseUrl: 'http://api', fetch: fetchImpl, auth: { store: null, }, },);
        await core.send({ module: 'posts', method: 'GET', path: '/posts', query: { page: 1, }, },);
        await core.send({ module: 'posts', method: 'GET', path: '/posts', query: { page: 1, }, },);
        expect(fetchImpl,).toHaveBeenCalledOnce();
    },);

    it('a mutation invalidates the list cache', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(envelope([{ id: '1', },],),)   // first GET
            .mockResolvedValueOnce(envelope({ id: '2', }, 201,),) // POST
            .mockResolvedValueOnce(envelope([{ id: '1', }, { id: '2', },],),); // GET after invalidation
        const core = new CmsClientCore({ baseUrl: 'http://api', fetch: fetchImpl, auth: { store: null, }, },);
        await core.send({ module: 'posts', method: 'GET', path: '/posts', },);
        await core.send({ module: 'posts', method: 'POST', path: '/posts', body: { t: 'x', }, invalidates: ['posts.GET',], } as never,);
        // NOTE invalidates uses 'module.method' where method label = the GET path; align with base.ts which passes path.
        await core.send({ module: 'posts', method: 'GET', path: '/posts', },);
        expect(fetchImpl,).toHaveBeenCalledTimes(3,);
    },);

    it('emits on the error bus and rejects with the typed error', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(errorEnvelope('NOT_FOUND', 'nope', 404,),);
        const core = new CmsClientCore({ baseUrl: 'http://api', fetch: fetchImpl, auth: { store: null, }, },);
        const onErr = vi.fn(); core.onError(onErr,);
        await expect(core.send({ module: 'posts', method: 'GET', path: '/posts/x', },),).rejects.toThrow('nope',);
        expect(onErr,).toHaveBeenCalled();
    },);

    it('refreshes once on an expired bearer token then retries', async () => {
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce(errorEnvelope('UNAUTHORIZED', 'Token expired', 401,),) // first protected GET
            .mockResolvedValueOnce(envelope({ user: { id: 'u', }, accessToken: 'A2', refreshToken: 'R2', expiresAt: 'l', },),) // refresh
            .mockResolvedValueOnce(envelope({ id: 'me', },),); // retry
        const core = new CmsClientCore({
            baseUrl: 'http://api', fetch: fetchImpl,
            auth: { mode: 'bearer', tokens: { accessToken: 'A', refreshToken: 'R', }, store: null, },
        },);
        const out = await core.send({ module: 'users', method: 'GET', path: '/users/me', options: { cache: false, }, },);
        expect(out,).toEqual({ id: 'me', },);
        expect(fetchImpl,).toHaveBeenCalledTimes(3,);
    },);
},);
```

> **Implementer note on the invalidation label:** make `base.ts` and `client.ts` agree — the cache key's "method" segment is the GET *path* (`pathMethodKey` returns `req.path`). So a mutation's `invalidates: ['posts./posts']` would target the list. To keep it ergonomic, change `applyInvalidation` to treat each target as a raw `module` (drop the whole module's cache) UNLESS it contains a `:`-free path. SIMPLER FINAL RULE (implement this): `invalidates` entries are bare module names → `invalidatePrefix(cms:<module>:)` drops ALL of that module's cached reads. Update the test's `invalidates` to `['posts']` and `applyInvalidation` to split nothing — just prefix by module. Adjust the Task-10 code: `for (const module of targets) await this.cache.invalidatePrefix(cacheKeyPrefix(ns, module));`. This is coarse but correct and predictable; per-method invalidation is a future refinement. Update base.ts callers and module files (Task 11+) to pass module names.

- [ ] **Step 4: Apply the simplification from the note** (module-level invalidation), run → pass (4 tests).

- [ ] **Step 5: Wire `index.ts`** — the public `createClient`:

```ts
import { CmsClientCore, } from './core/client';
import type { CmsClientConfig, } from './core/types';
import { assembleModules, type CmsModules, } from './modules';

export type CmsClient = CmsClientCore & CmsModules;

/** Create a configured CMS client. */
export function createClient(config: CmsClientConfig,): CmsClient {
    const core = new CmsClientCore(config,);
    return assembleModules(core,) as CmsClient;
}

export * from './core/types';
export * from './core/errors';
export { CmsClientCore, } from './core/client';
```

(For now create a minimal `modules/index.ts` returning the core unchanged so the build passes; modules fill in Task 11+.)

```ts
// packages/cms-client/src/modules/index.ts (stub — grows per batch)
import type { CmsClientCore, } from '../core/client';
export interface CmsModules {}
export function assembleModules(core: CmsClientCore,): CmsClientCore & CmsModules { return core as never; }
```

- [ ] **Step 6: Build + test green. Commit** `feat(cms-client): core client assembly, ModuleBase, createClient`.

---

### Tasks 11–16: Module namespaces (batched)

**Shared recipe (every module file):** create `packages/cms-client/src/modules/<module>.ts` exporting a class extending `ModuleBase` with `protected readonly module = '<module>'`, one method per the **method-map** (`docs/superpowers/plans/2026-06-08-cms-client-methodmap.md`) typed with `@sitesurge/types` DTOs. GET methods call `this.get<RespDTO>(path, { params, query, options })`; mutations call `this.mutate<RespDTO>('POST'|…, path, { params, body, invalidates: ['<module>'], options })`; uploads call `this.upload`; raw call `this.rawGet(path, { rootMounted: true })`. Register the namespace in `modules/index.ts` (`CmsModules` interface gains `<module>: <Module>Module;` and `assembleModules` sets `core.<module> = new <Module>Module(core)`). After each batch: `npm run build -w packages/cms-client && npm test -w packages/cms-client -- --run`; add ONE focused test per batch covering 2-3 representative methods (URL built correctly + DTO type compiles) using a mocked fetch. One commit per batch.

**Worked example (do this exactly for posts in Task 11, copy the shape for the rest):**

```ts
// packages/cms-client/src/modules/posts.ts
import type {
    Post, PostListQuery, PostListResponse, PostBySlugResponse, PostCreateBody,
    PostCreateResponse, PostUpdateBody, PostUpdateResponse, PostSearchQuery,
    PostSearchResponse, PostBulkBody, PostBulkResponse, PostByIdResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

export class PostsModule extends ModuleBase {
    protected readonly module = 'posts';

    /** GET /posts — public list (anon) / admin all-statuses with status|sort. */
    list(query?: PostListQuery,): Promise<PostListResponse> { return this.get('/posts', { query: query as Record<string, unknown>, },); }
    /** GET /posts/search */
    search(query: PostSearchQuery,): Promise<PostSearchResponse> { return this.get('/posts/search', { query: query as Record<string, unknown>, },); }
    /** GET /posts/slug/:slug — throws ContentLockedError on gated content. */
    getBySlug(slug: string, query?: { preview?: string; },): Promise<PostBySlugResponse> {
        return this.get('/posts/slug/:slug', { params: { slug, }, query, },);
    }
    /** GET /posts/:id (admin). */
    get(id: string,): Promise<PostByIdResponse> { return super.get('/posts/:id', { params: { id, }, },); }
    create(body: PostCreateBody,): Promise<PostCreateResponse> { return this.mutate('POST', '/posts', { body, invalidates: ['posts',], },); }
    update(id: string, body: PostUpdateBody,): Promise<PostUpdateResponse> { return this.mutate('PUT', '/posts/:id', { params: { id, }, body, invalidates: ['posts',], },); }
    remove(id: string,): Promise<{ message: string; }> { return this.mutate('DELETE', '/posts/:id', { params: { id, }, invalidates: ['posts',], },); }
    bulk(body: PostBulkBody,): Promise<PostBulkResponse> { return this.mutate('POST', '/posts/bulk', { body, invalidates: ['posts',], },); }
    // revisions: listRevisions/getRevision/restoreRevision; reorderBlocks — per method-map.
}
```

> Method-name collision note: `get(id)` shadows the protected `ModuleBase.get`. Rename the base helper to `cachedGet` to avoid the clash (update base.ts + all modules), OR name the entity getter `getById`. **Decision: use `getById` for the entity-by-id method across ALL modules** (clean, no shadowing). The plan's example above should read `getById(id)`. Apply uniformly.

- [ ] **Task 11 — Content batch:** posts, pages, campaigns, forms, media. Notes: media upload via `this.upload('/media', formData, { invalidates: ['media'] })`; campaigns/forms expose `listPublic()` (bare array) and `list()` (admin, `{ all: true }`) per the dual-shape DTOs; pages `getBySlug` throws ContentLockedError; forms `exportSubmissions(id)` uses `rawGet` (CSV string) — mark rootMounted false (it's under /api/v1). Test: posts.list URL, media.upload FormData passthrough, campaigns.listPublic vs list query. Commit `feat(cms-client): content modules — posts, pages, campaigns, forms, media`.

- [ ] **Task 12 — Engagement/admin batch:** users (incl. `remove`, `ban`, `unban`, `banIp`, `setPassword`, `uploadAvatar`), messages (incl. `submit` public, `bulk`), social (feeds, sync, homepage get/set), search (keyed-map response — type as `SearchResponse`), audit (list), dashboard (summary). Test: users.ban URL+body, search keyed-map shape, dashboard.summary. Commit.

- [ ] **Task 13 — Auth + access batch:** auth (login/refresh/logout/logoutAll/me/patreonStart/patreonSync/autologin — `login` etc. delegate to `core.auth`; expose them as `cms.auth.login(...)` mapping to `core.login`), apiKeys (list/create/revoke), connections (list/get/upsert/update/remove/reorder/oauthAuthorize — NOT the callback), blockStyles, fonts (incl. multipart upload), dev, health (basic/detailed/ready/live), setup (status/testDb/testRedis/testSmtp/testS3/generateJwt/install). Test: auth.login round-trip via mocked fetch (delegates to AuthManager), apiKeys.create, connections.reorder. Commit.

- [ ] **Task 14 — Mail + commerce batch:** mailingLists (admin list/subscriber CRUD/bulk/forceConfirm + public `subscribe`), mailTemplates (CRUD/variables/preview/replaceBlocks), mailSend (send/jobs/job/recipients/retry/cancel), payments (donate/subscribe/unsubscribe/createCustomer/subscriptions/transactions/plans/admin plan CRUD — NOT webhook). Notes: settings module (the 409 cascade) — expose `update(body)` that on `ConflictError` with the cascade shape rethrows a typed `FeatureCascadeError` OR returns the cascade result; per the charter, surface `error.details` as a typed `SettingsFeatureCascadeResult` (catch ConflictError in the method, inspect `details`, rethrow a dedicated error carrying it). Test: mailingLists dual (admin list + public subscribe), payments.donate, settings.update cascade handling. Commit `feat(cms-client): mail, payments, settings modules`.

- [ ] **Task 15 — Raw/site batch:** settings (getPublic/getAll/get/set/appearance/siteFooter/swatches…), feed (`xml()` → rawGet '/feed.xml' rootMounted), sitemap (`xml()` rootMounted + `regenerate()` admin). (Settings non-409 methods go here; the cascade `update` from Task 14 — keep settings in ONE file, build it fully in this task and have Task 14 reference it. REORDER: build settings ONCE here.) Test: feed.xml rootMounted URL (no /api/v1), settings.getPublic cached. Commit.

> **De-dup:** settings appears in 14 and 15 — build the ENTIRE settings module in Task 15; Task 14 covers only mail+payments. Fix the Task 14 line to drop settings.

- [ ] **Task 16 — Assemble + drift check:** finalize `modules/index.ts` with every namespace; write `packages/cms-client/scripts/check-drift.ts` (Node script: read `docs/api-manifest.json`, read the assembled client's known route table — maintain a `ROUTE_COVERAGE` const array in `modules/index.ts` listing every `METHOD absolutePath` the client implements + an `INTENTIONALLY_UNEXPOSED` allowlist (webhook, OAuth callbacks, unsubscribe HTML); assert every manifest route is in one set, fail otherwise). Add `"check:drift": "tsx scripts/check-drift.ts"` to package.json. Run it green. Test: a unit test importing `createClient` asserting `cms.posts`, `cms.users`, `cms.mailingLists`, `cms.settings`, `cms.payments` etc. all exist and are objects. Commit `feat(cms-client): assemble all module namespaces + drift check`.

---

### Task 17: SolidJS adapter (`./solid` subpath)

**Files:** `packages/cms-client/src/adapters/solid.ts` + `solid.test.ts`.

- [ ] **Step 1: Implement** — turn a cached read + subscription into a Solid resource, and bind the error bus:

```ts
import { createSignal, onCleanup, } from 'solid-js';
import type { CmsClientCore, } from '../core/client';
import type { CmsError, } from '../core/errors';

/** A reactive read: returns [accessor, { refetch }]. Seeds with the cached
 *  value immediately and updates when the SWR background revalidation
 *  produces a changed value. */
export function createCmsResource<T,>(
    core: CmsClientCore, module: string, method: string, args: unknown, fetcher: () => Promise<T>,
): [() => T | undefined, { refetch: () => Promise<void>; }] {
    const [value, setValue,] = createSignal<T | undefined>(undefined,);
    const refetch = async () => { try { setValue((await fetcher()) as never,); } catch { /* surfaced via bus */ } };
    void refetch();
    const off = core.subscribe<T>(module, method, args, (v,) => setValue(v as never,),);
    onCleanup(off,);
    return [value, { refetch, },];
}

/** Bind service-level errors to a setter (toast/form store). */
export function bindCmsErrors(core: CmsClientCore, onError: (e: CmsError,) => void,): void {
    const off = core.onError(onError,);
    onCleanup(off,);
}
```

- [ ] **Step 2: Test** (vitest with solid-js available — a minimal createRoot harness asserting the resource seeds and updates). **Step 3: Build (`./solid` entry emits). Commit** `feat(cms-client): optional SolidJS adapter`.

---

### Task 18: Integration smoke (real API)

**Files:** `packages/cms-client/test-integration/smoke.test.ts` (excluded from the unit run; its own script).

- [ ] **Step 1:** Write a script-style test that: boots the API on PORT 3101 (the `.env` PORT dance — backup `packages/api/.env`, set 3101, restore after; document that ports 3000/3001 may be busy), waits for `/api/v1/health/live`, seeds an `ssk_` admin key in the DB (sha256 like the Phase-2 smoke), then with `createClient({ baseUrl: 'http://localhost:3101', auth: { apiKey } })`: `cms.posts.list({ status: 'all' })` (200), a second call served from cache (assert one network hit via a fetch spy wrapper), `cms.health.live()`, and an error path (`cms.posts.getById('00000000-…')` → NotFoundError). Add `"test:integration"` script. This is RUN MANUALLY (not in the unit suite) — document in the package README.
- [ ] **Step 2:** Run it once locally, capture output, teardown (kill server, restore .env, delete the seeded key). Commit `test(cms-client): integration smoke against live API` (the test file only — no committed run artifacts).

---

### Task 19: Documentation — `packages/cms-client/docs/Overview.md`

- [ ] **Step 1:** Write the full doc per the spec's documentation section: top outline + quickstart; config reference table; auth modes; caching (SWR/adapters/TTL/invalidation/subscriptions/disable); error handling (hierarchy table + bus + form/toast binding); SolidJS adapter; then **one collapsible `<details><summary>` per module** listing every public method (signature, request DTO, response DTO, auth tier, cache behavior, example). Pull method signatures from the finished module files; pull route facts from `docs/api-manifest.json`. End with the drift-check note + the intentionally-unexposed list.
- [ ] **Step 2:** Update `packages/cms-client/README.md` (drop the NOT-IMPLEMENTED banner; add install, 30-second example, link to docs/Overview.md). Commit `docs(cms-client): full Overview.md + README`.

---

### Task 20: Repo docs sync + final review

- [ ] **Step 1:** Update root `docs/client-sdk-plan.md` status → IMPLEMENTED (link the package + Overview.md). Update `CLAUDE.md`: cms-client is now implemented (not scaffold); the cmsClient doctrine becomes "use it" with a one-line usage example; note `npm run -w packages/cms-client check:drift` guards coverage. Commit `docs: cms-client implemented — update charter + CLAUDE.md`.
- [ ] **Step 2:** Final reviewer over the whole range: builds (all packages, dependency-ordered), `npm test -w packages/cms-client -- --run` all green, drift-check passes, `npm run build -w packages/cms-client` emits both entries + dts, no forbidden files committed, docs accuracy spot-check (5 methods vs manifest), DTO usage truthful (no `any` leakage), bundle has zero runtime deps. Residual-risks list.

---

## Self-review notes
- **Type names** in the worked example (PostListResponse etc.) must match the ACTUAL exports in `packages/shared/src/api/routes/posts.ts` — the implementer reads that file; where a name differs, use the real one (the method-map lists them). This is called out in the Task 11 recipe.
- **`get` shadowing** resolved: entity getter is `getById` everywhere; base helper stays `get` (protected). Worked example updated mentally — implementer uses `getById`.
- **Invalidation** simplified to module-level prefix drops (coarse, predictable); per-method invalidation noted as future.
- **settings** built once (Task 15); Task 14 line corrected to exclude it.
- **Auth-refresh-retry** lives in `client.dispatch`; single-flight in AuthManager.
- **Cache bypass** for sensitive reads: modules pass `options: { cache: false }` on `auth.me`, `health.*`, `setup.status` (note in those module methods).
- **fake-indexeddb** is a devDep used only by the adapter test (`import 'fake-indexeddb/auto'`).
- **Raw routes** (feed/sitemap) use `rootMounted: true` so the URL skips `/api/v1`.
