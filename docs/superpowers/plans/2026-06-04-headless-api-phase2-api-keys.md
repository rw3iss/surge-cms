# Headless API Phase 2 — API Keys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real API keys (`ssk_…`) so standalone clients and agents can authenticate without a user login: hashed at rest, coarse scopes (`read`/`write`/`admin`), admin CRUD endpoints on the manifest framework, a Settings → API Keys panel, and synthetic audit actors.

**Architecture:** New `api_keys` table (migration 038). `services/apiKeys.ts` owns generation/verification (sha256 at rest, plaintext shown once). A combined auth middleware lets `admin`/`apiKey`-tier manifest routes accept EITHER an admin JWT OR an `ssk_` key with sufficient scope (GET→`read`+, mutations→`write`+; hierarchy read<write<admin). Audit logging gains non-UUID actor support (`api-key:<name>` folds into `new_values.actor`, `user_id` NULL).

**Tech Stack:** Express 4, zod, pg (raw SQL via repositories), vitest + supertest, SolidJS Settings panel.

**Spec:** `docs/superpowers/specs/2026-06-04-headless-api-design.md` (Phase 2 section). Phase 1 (framework + posts pilot) landed in commits `cf8519d..7b35d9f`.

**Conventions (same as Phase 1):**
- Trailing commas in call/type arg lists (`fn(arg,)`), 4-space indent.
- Builds: `npm run build -w shared|backend|frontend` from repo root. Tests: `npm test -w backend -- --run` (17 pass before this plan).
- Path-scoped commits ONLY — the working tree may contain unrelated uncommitted changes (.scss files, untracked docs). `git status --short` before every commit. No Co-Authored-By.
- Commits land directly on `main` (user-approved).

---

### Task 1: Migration 038 — `api_keys` table

**Files:**
- Create: `backend/src/db/migrations/038_create_api_keys.sql`
- Modify: `backend/src/db/schema.sql` (append the same table near the audit_log section, keeping the file's idempotent style)

- [ ] **Step 1: Create the migration**

`backend/src/db/migrations/038_create_api_keys.sql` (core feature — NO `-- @feature` header; check neighbors: feature-gated migrations carry the header, core ones don't — verify by `head -2` on 024/025 and match the core style):

```sql
-- API keys for headless clients (agents, server-to-server).
-- Plaintext keys are NEVER stored: only sha256(key) lands in key_hash.
-- key_prefix holds the first chars (e.g. 'ssk_a1b2c3d4') for display.

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    key_hash CHAR(64) NOT NULL UNIQUE,
    key_prefix VARCHAR(16) NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{read}',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys (key_hash) WHERE revoked_at IS NULL;
```

- [ ] **Step 2: Append the same DDL to `backend/src/db/schema.sql`**

Read schema.sql first; place the block near `audit_log` (or in whatever grouping the file uses for auth-adjacent tables), matching its comment style. The file is idempotent (`IF NOT EXISTS`) so the migration and schema stay in sync.

- [ ] **Step 3: Run the migration locally**

Run: `npm run db:migrate` (from repo root). Expected: `038_create_api_keys` applied. Then `npm run db:migrate:status` shows it as applied.

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/migrations/038_create_api_keys.sql backend/src/db/schema.sql
git commit -m "feat(db): api_keys table (migration 038)"
```

---

### Task 2: Non-UUID audit actors + revision author guard

API-key writes audit as `api-key:<name>`, which is not a UUID. `audit_log.user_id` and `revisions.author_id` are UUID FKs — both code paths must null the column and (for audit) preserve the actor label.

**Files:**
- Modify: `backend/src/services/audit.ts`
- Modify: `backend/src/repositories/revisions.repo.ts` (createRevision)
- Create: `backend/src/services/audit.test.ts`

- [ ] **Step 1: Write the failing test** — `backend/src/services/audit.test.ts`

Mock the db module so no real connection is needed:

```ts
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queryMock = vi.fn().mockResolvedValue({ rows: [], },);
vi.mock('../db', () => ({ query: (...args: unknown[],) => queryMock(...args,), }),);

import { logAudit, } from './audit';

describe('logAudit actor handling', () => {
    beforeEach(() => queryMock.mockClear(),);

    it('passes UUID userIds into user_id', async () => {
        await logAudit({
            userId: '11111111-2222-3333-4444-555555555555',
            action: 'create', entityType: 'post',
        },);
        const params = queryMock.mock.calls[0][1] as unknown[];
        expect(params[0],).toBe('11111111-2222-3333-4444-555555555555',);
    },);

    it('nulls non-UUID userIds and folds them into new_values.actor', async () => {
        await logAudit({
            userId: 'api-key:deploy-bot',
            action: 'update', entityType: 'post',
            newValues: { title: 'x', },
        },);
        const params = queryMock.mock.calls[0][1] as unknown[];
        expect(params[0],).toBeNull();
        expect(JSON.parse(params[5] as string,),).toEqual({ title: 'x', actor: 'api-key:deploy-bot', },);
    },);

    it("folds the legacy 'system' actor the same way", async () => {
        await logAudit({ userId: 'system', action: 'create', entityType: 'page', },);
        const params = queryMock.mock.calls[0][1] as unknown[];
        expect(params[0],).toBeNull();
        expect(JSON.parse(params[5] as string,),).toEqual({ actor: 'system', },);
    },);
},);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w backend -- --run src/services/audit.test.ts`
Expected: tests 2 and 3 FAIL (today a non-UUID user_id is passed straight through to the INSERT, which would violate the uuid cast / FK — the existing catch swallows it in production, silently losing the audit row).

- [ ] **Step 3: Implement in `backend/src/services/audit.ts`**

The file already has `UUID_RE` and the non-UUID *entityId* folding pattern — mirror it for userId. Inside `logAudit`, before the INSERT:

```ts
        // user_id is a UUID FK. Synthetic actors ('system',
        // 'api-key:<name>') get NULL in the column and are preserved
        // in new_values.actor — same pattern as non-UUID entityIds.
        const isUuidUser = UUID_RE.test(entry.userId,);
        const userIdForDb = isUuidUser ? entry.userId : null;
        const valuesWithActor = !isUuidUser
            ? { ...(newValues ?? {}), actor: entry.userId, }
            : newValues;
```

Use `userIdForDb` as `$1` and `valuesWithActor` in place of `newValues` in the INSERT params. (Careful: `newValues` is the already-computed const that may carry `entityKey` — build `valuesWithActor` from it, as shown, so both foldings compose.)

- [ ] **Step 4: Guard revisions** — in `backend/src/repositories/revisions.repo.ts` `createRevision`, null non-UUID authors:

```ts
    // author_id is a UUID FK; synthetic actors (api-key:<name>, system) become NULL.
    const authorForDb = authorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authorId,) ?
        authorId :
        null;
```

…and use `authorForDb` in the INSERT params. (Read the function first; keep its existing version-numbering logic untouched.)

- [ ] **Step 5: Run tests + build, commit**

Run: `npm test -w backend -- --run` → 20 passed. `npm run build -w backend` → clean.

```bash
git add backend/src/services/audit.ts backend/src/services/audit.test.ts backend/src/repositories/revisions.repo.ts
git commit -m "fix(backend): synthetic audit actors fold into new_values; revision author UUID guard"
```

---

### Task 3: API-keys repository + service

**Files:**
- Create: `backend/src/repositories/apiKeys.repo.ts`
- Create: `backend/src/services/apiKeys.ts`
- Modify: `shared/src/api/auth.ts` (no change needed — `ApiKeyScope` already exists; verify only)

- [ ] **Step 1: Create `backend/src/repositories/apiKeys.repo.ts`**

```ts
/**
 * api_keys data access. Plaintext keys never reach this layer —
 * callers pass the sha256 hash.
 */
import type { ApiKeyScope, } from '@rw/shared';
import { query, } from '../db';
import { mapRow, } from '../utils/mapRow';

export interface ApiKeyRow {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: ApiKeyScope[];
    createdBy: string | null;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
}

const COLS = 'id, name, key_prefix, scopes, created_by, last_used_at, revoked_at, created_at';

export async function insertKey(input: {
    name: string;
    keyHash: string;
    keyPrefix: string;
    scopes: ApiKeyScope[];
    createdBy: string | null;
},): Promise<ApiKeyRow> {
    const result = await query(
        `INSERT INTO api_keys (name, key_hash, key_prefix, scopes, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${COLS}`,
        [input.name, input.keyHash, input.keyPrefix, input.scopes, input.createdBy,],
    );
    return mapRow<ApiKeyRow>(result.rows[0] as Record<string, unknown>,);
}

export async function listKeys(): Promise<ApiKeyRow[]> {
    const result = await query(
        `SELECT ${COLS} FROM api_keys ORDER BY created_at DESC`,
    );
    return (result.rows as Record<string, unknown>[]).map((r,) => mapRow<ApiKeyRow>(r,),);
}

export async function findActiveByHash(keyHash: string,): Promise<ApiKeyRow | null> {
    const result = await query(
        `SELECT ${COLS} FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
        [keyHash,],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapRow<ApiKeyRow>(row,) : null;
}

export async function revokeKey(id: string,): Promise<ApiKeyRow | null> {
    const result = await query(
        `UPDATE api_keys SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL
         RETURNING ${COLS}`,
        [id,],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapRow<ApiKeyRow>(row,) : null;
}

export async function touchLastUsed(id: string,): Promise<void> {
    await query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [id,],);
}
```

(Verify `mapRow` handles `scopes` TEXT[] — pg returns it as a JS array already; mapRow only renames keys/dates. If `_at`-suffix handling converts dates automatically, good.)

- [ ] **Step 2: Create `backend/src/services/apiKeys.ts`**

```ts
/**
 * API keys for headless clients.
 *
 * Format: `ssk_<43 chars base64url>` (256 bits of entropy). The
 * plaintext is returned exactly once at creation; only sha256(key)
 * is stored. Verification hashes the presented token and looks up
 * the active row; `last_used_at` is updated fire-and-forget.
 *
 * Scopes are coarse and hierarchical: read < write < admin.
 */
import crypto from 'crypto';
import type { ApiKeyScope, } from '@rw/shared';
import * as repo from '../repositories/apiKeys.repo';
import { logAudit, } from './audit';
import { logger, } from '../utils/logger';
import type { AuditContext, } from './types';

export type { ApiKeyRow, } from '../repositories/apiKeys.repo';

export const KEY_PREFIX = 'ssk_';

const SCOPE_RANK: Record<ApiKeyScope, number> = { read: 0, write: 1, admin: 2, };

/** Does any granted scope satisfy the required one? (read < write < admin) */
export function scopeSatisfies(granted: ApiKeyScope[], required: ApiKeyScope,): boolean {
    return granted.some((s,) => SCOPE_RANK[s] >= SCOPE_RANK[required],);
}

/** Minimum scope an HTTP method needs on a protected route. */
export function requiredScopeFor(method: string,): ApiKeyScope {
    return method === 'GET' || method === 'HEAD' ? 'read' : 'write';
}

export function hashKey(plaintext: string,): string {
    return crypto.createHash('sha256',).update(plaintext,).digest('hex',);
}

export async function create(
    input: { name: string; scopes: ApiKeyScope[]; },
    ctx: AuditContext,
): Promise<{ apiKey: repo.ApiKeyRow; plaintextKey: string; }> {
    const plaintextKey = KEY_PREFIX + crypto.randomBytes(32,).toString('base64url',);
    const apiKey = await repo.insertKey({
        name: input.name,
        keyHash: hashKey(plaintextKey,),
        keyPrefix: plaintextKey.slice(0, 12,),
        scopes: input.scopes,
        createdBy: ctx.userId && ctx.userId !== 'system' ? ctx.userId : null,
    },);
    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'api-key',
        entityId: apiKey.id,
        newValues: { name: input.name, scopes: input.scopes, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
    return { apiKey, plaintextKey, };
}

export async function list(): Promise<repo.ApiKeyRow[]> {
    return repo.listKeys();
}

export async function revoke(id: string, ctx: AuditContext,): Promise<repo.ApiKeyRow | null> {
    const revoked = await repo.revokeKey(id,);
    if (revoked) {
        await logAudit({
            userId: ctx.userId,
            action: 'revoke',
            entityType: 'api-key',
            entityId: id,
            newValues: { name: revoked.name, },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
        },);
    }
    return revoked;
}

/** Verify a presented token. Returns the active key row or null.
 *  Updates last_used_at without blocking the request. */
export async function verify(plaintext: string,): Promise<repo.ApiKeyRow | null> {
    if (!plaintext.startsWith(KEY_PREFIX,)) return null;
    const key = await repo.findActiveByHash(hashKey(plaintext,),);
    if (!key) return null;
    void repo.touchLastUsed(key.id,).catch((err,) =>
        logger.warn('api-key last_used update failed', { id: key.id, err, },)
    );
    return key;
}
```

- [ ] **Step 3: Unit tests for the pure helpers** — `backend/src/services/apiKeys.test.ts`

```ts
import { describe, expect, it, } from 'vitest';
import { hashKey, KEY_PREFIX, requiredScopeFor, scopeSatisfies, } from './apiKeys';

describe('apiKeys helpers', () => {
    it('scope hierarchy: read < write < admin', () => {
        expect(scopeSatisfies(['read',], 'read',),).toBe(true,);
        expect(scopeSatisfies(['read',], 'write',),).toBe(false,);
        expect(scopeSatisfies(['write',], 'read',),).toBe(true,);
        expect(scopeSatisfies(['write',], 'admin',),).toBe(false,);
        expect(scopeSatisfies(['admin',], 'write',),).toBe(true,);
        expect(scopeSatisfies([], 'read',),).toBe(false,);
    },);

    it('maps methods to required scopes', () => {
        expect(requiredScopeFor('GET',),).toBe('read',);
        expect(requiredScopeFor('HEAD',),).toBe('read',);
        expect(requiredScopeFor('POST',),).toBe('write',);
        expect(requiredScopeFor('PUT',),).toBe('write',);
        expect(requiredScopeFor('DELETE',),).toBe('write',);
    },);

    it('hashes deterministically to 64 hex chars', () => {
        const h = hashKey(`${KEY_PREFIX}abc`,);
        expect(h,).toMatch(/^[0-9a-f]{64}$/,);
        expect(hashKey(`${KEY_PREFIX}abc`,),).toBe(h,);
    },);
},);
```

NOTE: importing `./apiKeys` pulls in `../db` transitively via the repo module — if the db module connects eagerly at import time, mock it (`vi.mock('../db', ...)`) at the top of the test file. Check `backend/src/db/index.ts` first; the existing audit.test.ts pattern from Task 2 shows the way.

- [ ] **Step 4: Run tests + build, commit**

Run: `npm test -w backend -- --run` → 23+ passed. Build clean.

```bash
git add backend/src/repositories/apiKeys.repo.ts backend/src/services/apiKeys.ts backend/src/services/apiKeys.test.ts
git commit -m "feat(backend): api-keys repository + service (ssk_ keys, sha256 at rest, scopes)"
```

---

### Task 4: Auth integration — admin routes accept JWT or API key

**Files:**
- Create: `backend/src/api/apiKeyAuth.ts`
- Modify: `backend/src/api/registry.ts` (authMiddlewaresFor: 'admin' and 'apiKey' tiers)
- Modify: `backend/src/api/types.ts` (HandlerCtx gains `apiKey?`)
- Create: `backend/src/api/apiKeyAuth.test.ts`

- [ ] **Step 1: Extend `AuthenticatedRequest` surface** — in `backend/src/api/types.ts`, add to `HandlerCtx`:

```ts
    /** Present when the request authenticated via API key instead of a user. */
    apiKey?: import('../services/apiKeys').ApiKeyRow;
```

(Use a type-only import at the top instead of the inline import if the file's style prefers it.)

- [ ] **Step 2: Create `backend/src/api/apiKeyAuth.ts`**

```ts
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
    };
    return [combined as RequestHandler,];
}
```

- [ ] **Step 3: Wire into the registry** — `backend/src/api/registry.ts`:

Add import `import { adminOrApiKey, } from './apiKeyAuth';` and change two switch cases:

```ts
        case 'admin': return adminOrApiKey();
        case 'apiKey': return adminOrApiKey();
```

Update `authMiddlewaresFor`'s doc comment: the `apiKey`-is-admin-equivalent placeholder note is now obsolete — both tiers accept admin JWT or scoped API key (`apiKey` remains a semantic marker in the manifest for routes designed for machine clients).

Also in `wrap()`: pass the key through to handlers — add `apiKey: (req as ApiKeyRequest).apiKey,` to the ctx object (import the type).

- [ ] **Step 4: Tests** — `backend/src/api/apiKeyAuth.test.ts` (supertest; mock the apiKeys service so no DB is needed):

```ts
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const verifyMock = vi.fn();
vi.mock('../services/apiKeys', async (importOriginal,) => {
    const real = await importOriginal<typeof import('../services/apiKeys')>();
    return { ...real, verify: (...a: unknown[],) => verifyMock(...a,), };
},);

import { errorHandler, } from '../middleware/error';
import { defineRoute, } from './defineRoute';
import { buildRouter, } from './registry';

function appWithAdminRoutes() {
    const app = express();
    app.use(express.json(),);
    app.use(buildRouter([
        defineRoute({
            method: 'get', path: '/things', auth: 'admin', summary: 't',
            handler: ({ apiKey, },) => ({ via: apiKey ? 'key' : 'jwt', },),
        },),
        defineRoute({
            method: 'post', path: '/things', auth: 'admin', summary: 't',
            handler: () => ({ ok: true, },),
        },),
    ],),);
    app.use(errorHandler,);
    return app;
}

describe('adminOrApiKey', () => {
    beforeEach(() => verifyMock.mockReset(),);

    it('accepts a valid read-scope key on GET', async () => {
        verifyMock.mockResolvedValue({ id: 'k1', name: 'bot', scopes: ['read',], },);
        const res = await request(appWithAdminRoutes(),).get('/things',)
            .set('Authorization', 'Bearer ssk_valid',);
        expect(res.status,).toBe(200,);
        expect(res.body.data.via,).toBe('key',);
    },);

    it('rejects a read-scope key on POST with FORBIDDEN', async () => {
        verifyMock.mockResolvedValue({ id: 'k1', name: 'bot', scopes: ['read',], },);
        const res = await request(appWithAdminRoutes(),).post('/things',)
            .set('Authorization', 'Bearer ssk_valid',);
        expect(res.status,).toBe(403,);
        expect(res.body.error.code,).toBe('FORBIDDEN',);
    },);

    it('accepts a write-scope key on POST', async () => {
        verifyMock.mockResolvedValue({ id: 'k1', name: 'bot', scopes: ['write',], },);
        const res = await request(appWithAdminRoutes(),).post('/things',)
            .set('Authorization', 'Bearer ssk_valid',);
        expect(res.status,).toBe(200,);
    },);

    it('rejects an unknown/revoked key with 401', async () => {
        verifyMock.mockResolvedValue(null,);
        const res = await request(appWithAdminRoutes(),).get('/things',)
            .set('Authorization', 'Bearer ssk_revoked',);
        expect(res.status,).toBe(401,);
        expect(verifyMock,).toHaveBeenCalledWith('ssk_revoked',);
    },);

    it('falls through to JWT auth for non-ssk bearers (401 invalid token, not key error)', async () => {
        const res = await request(appWithAdminRoutes(),).get('/things',)
            .set('Authorization', 'Bearer not-a-key-jwt',);
        expect(res.status,).toBe(401,);
        expect(verifyMock,).not.toHaveBeenCalled();
    },);

    it('rejects anonymous requests', async () => {
        const res = await request(appWithAdminRoutes(),).get('/things',);
        expect(res.status,).toBe(401,);
    },);
},);
```

NOTE: the JWT fall-through tests exercise `authenticate()` which calls `jwt.verify` and (on success) the DB. With an invalid token it returns 401 before touching the DB — both fall-through tests above stay DB-free. Verify this by reading middleware/auth.ts; if the anonymous case would hit the DB, it doesn't (no token → immediate 401).

- [ ] **Step 5: Run all tests + build, commit**

Run: `npm test -w backend -- --run` → 29+ passed (17 + 3 audit + 3 helpers + 6 auth). Build clean.

```bash
git add backend/src/api/apiKeyAuth.ts backend/src/api/apiKeyAuth.test.ts backend/src/api/registry.ts backend/src/api/types.ts
git commit -m "feat(api): admin-tier routes accept admin JWT or scoped ssk_ API key"
```

---

### Task 5: API-keys admin routes (manifest module)

**Files:**
- Create: `backend/src/routes/apiKeys.ts`
- Modify: `backend/src/routes/index.ts` (mount)

- [ ] **Step 1: Create `backend/src/routes/apiKeys.ts`**

```ts
import { z, } from 'zod';
import { API_KEY_SCOPES, } from '@rw/shared';
import { ForbiddenError, NotFoundError, } from '../core/errors';
import { defineRoute, reply, } from '../api/defineRoute';
import * as apiKeys from '../services/apiKeys';

const createSchema = z.object({
    name: z.string().min(1,).max(100,),
    scopes: z.array(z.enum(API_KEY_SCOPES,),).min(1,).default(['read',],),
},);

/** Keys must not mint or revoke keys — management requires a real
 *  admin login. */
function rejectKeyAuth(apiKey: unknown,): void {
    if (apiKey) throw new ForbiddenError('API-key management requires an admin login',);
}

export const apiKeysRoutes = [

    defineRoute({
        method: 'get', path: '/', auth: 'admin',
        summary: 'List API keys (hashes never returned).',
        handler: ({ apiKey, },) => {
            rejectKeyAuth(apiKey,);
            return apiKeys.list();
        },
    },),

    defineRoute({
        method: 'post', path: '/', auth: 'admin',
        summary: 'Create an API key. The plaintext key is returned ONCE in this response.',
        input: { body: createSchema, },
        handler: async ({ body, audit, apiKey, },) => {
            rejectKeyAuth(apiKey,);
            const { apiKey: created, plaintextKey, } = await apiKeys.create(body, audit(),);
            return reply({ apiKey: created, key: plaintextKey, }, { status: 201, },);
        },
    },),

    defineRoute({
        method: 'delete', path: '/:id', auth: 'admin',
        summary: 'Revoke an API key (soft — sets revoked_at).',
        input: { params: z.object({ id: z.string().uuid(), },), },
        handler: async ({ params, audit, apiKey, },) => {
            rejectKeyAuth(apiKey,);
            const revoked = await apiKeys.revoke(params.id, audit(),);
            if (!revoked) throw new NotFoundError('API key',);
            return revoked;
        },
    },),
];
```

(Check that `API_KEY_SCOPES` is exported as a readonly tuple usable by `z.enum` — it is `['read','write','admin'] as const`; `z.enum` needs a non-empty tuple, which a `readonly` tuple satisfies in zod v3 via `z.enum(API_KEY_SCOPES)`. If tsc complains, use `z.enum(['read', 'write', 'admin',],)` and add a comment tying it to the shared const.)

- [ ] **Step 2: Mount** — in `backend/src/routes/index.ts` add (alphabetized with the other imports):

```ts
import { apiKeysRoutes, } from './apiKeys';
```

and after the `/audit` mount (path-sorted with the others):

```ts
router.use('/api-keys', registerModule('api-keys', apiKeysRoutes,),);
```

- [ ] **Step 3: Build + tests + commit**

Run: `npm run build -w backend && npm test -w backend -- --run` → clean, 29+ passed.

```bash
git add backend/src/routes/apiKeys.ts backend/src/routes/index.ts
git commit -m "feat(backend): /api-keys admin endpoints (create/list/revoke) on manifest"
```

---

### Task 6: Settings → API Keys panel (frontend)

**Files:**
- Create: `frontend/src/components/admin/settings/ApiKeysPanel.tsx`
- Modify: `frontend/src/pages/admin/Settings.tsx` (TABS entry + tab content)

- [ ] **Step 1: Create the panel component**

`frontend/src/components/admin/settings/ApiKeysPanel.tsx` — list + create + revoke, reusing existing admin classes (`settings-card`, `admin-table`, `btn`, `form-group`, `alert`) so NO new SCSS is needed (read `frontend/src/components/admin/ADMIN_STYLES.md` first; if a needed class doesn't exist, prefer an existing utility over new styles):

```tsx
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { api, } from '../../../services/api';

interface ApiKeyRow {
    id: string;
    name: string;
    keyPrefix: string;
    scopes: string[];
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
}

const SCOPES = ['read', 'write', 'admin',] as const;

const ApiKeysPanel: Component = () => {
    const [keys, { refetch, },] = createResource(async () => {
        const res = await api.get<ApiKeyRow[]>('/api-keys',);
        return res.success ? (res.data ?? []) : [];
    },);

    const [name, setName,] = createSignal('',);
    const [scopes, setScopes,] = createSignal<string[]>(['read',],);
    const [creating, setCreating,] = createSignal(false,);
    const [createdKey, setCreatedKey,] = createSignal<string | null>(null,);
    const [error, setError,] = createSignal<string | null>(null,);

    const toggleScope = (s: string,) => {
        setScopes((prev,) => prev.includes(s,) ? prev.filter((x,) => x !== s,) : [...prev, s,],);
    };

    const handleCreate = async (e: Event,) => {
        e.preventDefault();
        if (!name().trim() || scopes().length === 0) return;
        setCreating(true,);
        setError(null,);
        const res = await api.post<{ apiKey: ApiKeyRow; key: string; }>('/api-keys', {
            name: name().trim(),
            scopes: scopes(),
        },);
        setCreating(false,);
        if (res.success && res.data) {
            setCreatedKey(res.data.key,);
            setName('',);
            setScopes(['read',],);
            void refetch();
        } else {
            setError(res.error?.message || 'Failed to create key',);
        }
    };

    const handleRevoke = async (key: ApiKeyRow,) => {
        if (!confirm(`Revoke "${key.name}"? Clients using it will stop working immediately.`,)) return;
        const res = await api.delete(`/api-keys/${key.id}`,);
        if (res.success) void refetch();
    };

    const fmt = (iso: string | null,) => iso ? new Date(iso,).toLocaleDateString() : '—';

    return (
        <div class="settings-grid">
            <section class="settings-card">
                <h3 class="settings-card__title">Create API key</h3>
                <p class="form-help-muted">
                    Keys authenticate headless clients (scripts, agents, integrations)
                    without a user login. Send as <code>Authorization: Bearer ssk_…</code>.
                </p>
                <Show when={createdKey()}>
                    <div class="alert alert--success">
                        <strong>Copy this key now — it will not be shown again.</strong>
                        <div style={{ display: 'flex', gap: '8px', 'align-items': 'center', 'margin-top': '8px', }}>
                            <code style={{ 'word-break': 'break-all', }}>{createdKey()}</code>
                            <button
                                type="button"
                                class="btn btn--secondary btn--sm"
                                onClick={() => navigator.clipboard.writeText(createdKey()!,)}
                            >
                                Copy
                            </button>
                        </div>
                    </div>
                </Show>
                <Show when={error()}>
                    <div class="alert alert--error">{error()}</div>
                </Show>
                <form onSubmit={handleCreate}>
                    <div class="form-group">
                        <label>Name</label>
                        <input
                            type="text"
                            placeholder="e.g. deploy-bot"
                            value={name()}
                            onInput={(e,) => setName(e.currentTarget.value,)}
                        />
                    </div>
                    <div class="form-group">
                        <label>Scopes</label>
                        <For each={SCOPES}>
                            {(s,) => (
                                <label style={{ display: 'block', }}>
                                    <input
                                        type="checkbox"
                                        checked={scopes().includes(s,)}
                                        onChange={() => toggleScope(s,)}
                                    />
                                    {' '}{s}
                                </label>
                            )}
                        </For>
                        <p class="form-help-muted">read &lt; write &lt; admin (hierarchical). GET needs read; mutations need write.</p>
                    </div>
                    <button type="submit" class="btn btn--primary" disabled={creating() || !name().trim()}>
                        {creating() ? 'Creating…' : 'Create key'}
                    </button>
                </form>
            </section>

            <section class="settings-card">
                <h3 class="settings-card__title">Existing keys</h3>
                <Show when={(keys() ?? []).length > 0} fallback={<p class="form-help-muted">No API keys yet.</p>}>
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Name</th><th>Key</th><th>Scopes</th><th>Last used</th><th>Status</th><th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={keys()}>
                                {(k,) => (
                                    <tr>
                                        <td>{k.name}</td>
                                        <td><code>{k.keyPrefix}…</code></td>
                                        <td>{k.scopes.join(', ',)}</td>
                                        <td>{fmt(k.lastUsedAt,)}</td>
                                        <td>{k.revokedAt ? 'Revoked' : 'Active'}</td>
                                        <td>
                                            <Show when={!k.revokedAt}>
                                                <button class="btn btn--danger btn--sm" onClick={() => handleRevoke(k,)}>
                                                    Revoke
                                                </button>
                                            </Show>
                                        </td>
                                    </tr>
                                )}
                            </For>
                        </tbody>
                    </table>
                </Show>
            </section>
        </div>
    );
};

export default ApiKeysPanel;
```

ADAPT to the actual codebase: check that `api.delete` exists on the ApiService (CLAUDE.md says it does), that `admin-table` / `btn--sm` / `alert--error` classes exist (grep; substitute the real class names — e.g. the repo may use `btn--small` or a different table class). The inline styles above are small one-offs; if ADMIN_STYLES.md demands a partial for them, follow it and report.

- [ ] **Step 2: Wire the tab into Settings.tsx**

In `frontend/src/pages/admin/Settings.tsx`:
- Add lazy import near SiteHeaderEditor: `const ApiKeysPanel = lazy(() => import('../../components/admin/settings/ApiKeysPanel'));`
- TABS array: add `{ id: 'api-keys', label: 'API Keys', },` (after 'connections', before 'admin' — or wherever reads naturally; keep `as const`).
- Tab content area: add alongside the other `<Show when={activeTab() === ...}>` blocks:

```tsx
                {/* ─── API Keys Tab ─── */}
                <Show when={activeTab() === 'api-keys'}>
                    <ApiKeysPanel />
                </Show>
```

- [ ] **Step 3: Build + commit**

Run: `npm run build -w frontend` → clean.

```bash
git add frontend/src/components/admin/settings/ApiKeysPanel.tsx frontend/src/pages/admin/Settings.tsx
git commit -m "feat(admin): Settings → API Keys panel (create/list/revoke, key shown once)"
```

(EXPLICIT paths only — unrelated .scss changes are in the tree.)

---

### Task 7: End-to-end smoke verification

**Files:** none (verification only). NOTE: ports 3000/3001 may be occupied by another project — run the backend on a side port by temporarily setting `PORT=3101` in `backend/.env` (backup first: `cp backend/.env /tmp/rw-cms-env-backup`; restore after: `cp /tmp/rw-cms-env-backup backend/.env` and verify `diff` clean). The config loader uses dotenv `override: true`, so the .env value is the only way.

- [ ] **Step 1: Migrate + boot**

`npm run db:migrate` (applies 038 if not yet). Start backend (`cd backend && npx tsx src/index.ts` in background with the temp PORT), wait for `/api/v1/health/live` → 200.

- [ ] **Step 2: Seed a known key directly in the DB**

Compute a hash for a known plaintext and insert (psql via DATABASE_URL from backend/.env):

```bash
HASH=$(node -e "console.log(require('crypto').createHash('sha256').update('ssk_smoketest0000000000000000000000000000000000').digest('hex'))")
psql "$DATABASE_URL" -c "INSERT INTO api_keys (name, key_hash, key_prefix, scopes) VALUES ('smoke', '$HASH', 'ssk_smoketes', '{admin}')"
```

- [ ] **Step 3: Verify key auth end-to-end**

```bash
# admin listing via API key (GET needs read; admin scope satisfies)
curl -s 'http://localhost:3101/api/v1/posts?status=all&limit=1' -H 'Authorization: Bearer ssk_smoketest0000000000000000000000000000000000'
# → success:true (and drafts visible if any)

# bogus key → 401 Invalid or revoked API key
curl -s -w ' %{http_code}' 'http://localhost:3101/api/v1/posts?status=all' -H 'Authorization: Bearer ssk_bogus'

# key cannot manage keys → 403
curl -s -w ' %{http_code}' 'http://localhost:3101/api/v1/api-keys' -H 'Authorization: Bearer ssk_smoketest0000000000000000000000000000000000'

# anonymous /api-keys → 401
curl -s -w ' %{http_code}' 'http://localhost:3101/api/v1/api-keys'
```

Also verify last_used_at got stamped: `psql "$DATABASE_URL" -c "SELECT name, last_used_at FROM api_keys WHERE name='smoke'"` → non-null.

And the audit actor: make a write with the key (e.g. `curl -X POST .../api/v1/posts -H 'Authorization: Bearer ssk_smoke…' -d '{"slug":"smoke-key-post","title":"Smoke"}' -H 'Content-Type: application/json'` → 201), then `psql "$DATABASE_URL" -c "SELECT user_id, new_values->>'actor' FROM audit_log ORDER BY created_at DESC LIMIT 1"` → user_id NULL, actor `api-key:smoke`. Clean up: delete the smoke post + smoke key rows.

- [ ] **Step 4: Teardown**

Kill the backend process, restore `.env` (verify `diff /tmp/rw-cms-env-backup backend/.env` → identical), delete smoke rows:
`psql "$DATABASE_URL" -c "DELETE FROM api_keys WHERE name='smoke'"` (and the smoke post + its audit rows if created: posts row via slug, audit rows can stay — they're real history of the test, deleting optional).

---

### Task 8: Docs sync

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md` (only if it has an API/auth section that's now stale — check; the full Headless Mode section is Phase 4)

- [ ] **Step 1: CLAUDE.md updates**

- Routes table: add row `| /api-keys | apiKeys.ts | admin (JWT only) | API key management |`.
- Key Patterns, Route manifest framework bullet: update the `apiKey` parenthetical — it is no longer "admin-equivalent until the API-key phase"; now: `admin`/`apiKey` tiers accept an admin JWT or a scoped `ssk_` key (GET→read+, mutations→write+; hierarchy read<write<admin). Key management endpoints reject key-auth.
- Services list: add `apiKeys` line if there's a services enumeration.
- Key tables list (Database section): add `api_keys`.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: API keys (scopes, ssk_ auth, /api-keys routes) in CLAUDE.md"
```

(Drop README.md from the add if unchanged.)

---

## Self-review notes (already applied)

- `audit_log.user_id`/`revisions.author_id` UUID-FK conflict with synthetic actors → Task 2 guards both.
- Keys cannot manage keys (Task 5 `rejectKeyAuth`) — prevents key self-escalation.
- `z.enum(API_KEY_SCOPES)` tuple-compat caveat documented in Task 5.
- Smoke uses a DB-seeded key because creating one via the API needs an admin JWT the harness may not have.
