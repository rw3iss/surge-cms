# Shop Feature + Feature-Lifecycle Implementation Plan

**Status:** Implemented (2026-07-08) — Phases 0–8 complete; 29 modules / 234 routes.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a toggle-able `shop` ecommerce feature (catalog with variants, media, reviews, cart, on-site Stripe checkout, orders, storefront) — preceded by hardening the feature-lifecycle system (idempotent install with status relay + a real uninstall that drops tables/data).

**Architecture:** Phase 0 adds lifecycle infra (registry `tables`/`onEnable`/`onUninstall`, an uninstall service+route, a `requireFeature` route guard, client install/remove UX). Phases 1–8 build the `shop` feature on the manifest framework (routes→services→repositories), typed DTOs in `@sitesurge/types`, a `cms.shop.*` SDK, admin `/admin/shop/*` pages, and storefront `/shop/*` pages. All shop routes 404 when disabled; nav + storefront routes render only when enabled.

**Tech Stack:** Express 4, zod, pg, vitest+supertest (backend), SolidJS+Vite (cms), tsup+vitest (cms-client), Stripe (PaymentIntents + Stripe Tax).

**Spec:** `docs/superpowers/specs/2026-06-08-shop-feature-design.md`.

**Conventions (unchanged, from prior phases):** 4-space indent, trailing commas (`fn(arg,)`, NOT after rest params, NOT inside generic type-arg lists — esbuild rejects those); path-scoped commits (`git status --short` first — unrelated `.scss`/docs live in the tree, never stage them); no Co-Authored-By; commits direct to `main`. Gates: `npm run build` (root, ordered shared→cms-client→api→cms), `npm test -w packages/api -- --run` (48 baseline), `npx tsc -p packages/cms/tsconfig.json --noEmit` (0), `npm test -w packages/cms-client -- --run` (94 baseline), `npm run check:drift -w packages/cms-client` (exit 0). Feature key = `shop`; mount `/api/v1/shop`; SDK `cms.shop`; admin `/admin/shop/*`; storefront `/shop/*`; settings row `shop_enabled`.

**Ground-truth shapes (verified):**
- `FeatureConfig` (`packages/api/src/features/registry.ts`): `{ key, label, description?, defaultEnabled, requires?, migrations? }`. `FeatureKey` union + `FEATURE_REGISTRY` record + `featureSettingKey(key)=`${key}_enabled`` + `getDependents(key)` + `assertNoCycles()`.
- `applyFeatureMigrations(key, client): Promise<string[]>` (`features/migrations.ts`) — advisory-locks `feature:${key}`, self-bootstraps `schema_migrations`, skips already-applied + missing-on-disk files, returns the filenames it ran.
- `updateSettings(data, ctx)` (`services/settings.ts`) — the feature block: `validateEnable(target,current,opts)` → `FeatureCascadeError(result)` on !ok; else `BEGIN` → for each plan step `applyFeatureMigrations` then `INSERT … ON CONFLICT` the `_enabled` row → `COMMIT`; audits; `cache.invalidateSettingsCache()`; returns `{ message:'Settings updated' }`. `FeatureCascadeError` is exported from `services/settings.ts:277`.
- `computePublicFeatures(settings)` (`services/settings.ts:126`) returns `SiteFeatures`. `SiteFeatures` lives in `packages/shared/src/types/content.ts:234`.
- `registerModule(module, defs, { mountPath }): Router` + `buildRouter(defs)` (`packages/api/src/api/registry.ts`).
- Settings routes (`routes/settings.ts`): `PUT /` calls `settings.updateSettings`, catches `FeatureCascadeError` → 409 `{ success:false, error: err.result }`.
- Client: `FeatureToggleRow.tsx` (no busy state), `stores/siteSettings.ts` `isFeatureEnabled`, `config/features.ts` `FEATURES`/`getFeature`, `cms.settings.update()` (`packages/cms-client/src/modules/settings.ts`).
- The `shop`-related admin nav uses `NAV_ITEMS` in `packages/cms/src/pages/admin/AdminLayout.tsx` (each item may declare `feature`).

---

# PHASE 0 — Feature Lifecycle (prerequisite; fully detailed)

### Task 0.1: Registry gains `tables` + lifecycle hooks

**Files:**
- Modify: `packages/api/src/features/registry.ts`
- Test: `packages/api/src/features/registry.test.ts`

- [ ] **Step 1: Failing test** — assert the type shape compiles + a helper `getUninstallable()`:

```ts
import { describe, expect, it, } from 'vitest';
import { FEATURE_REGISTRY, getUninstallableTables, isUninstallable, } from './registry';

describe('feature registry lifecycle metadata', () => {
    it('features without a tables list are not uninstallable', () => {
        expect(isUninstallable('posts',),).toBe(false,);
    },);
    it('getUninstallableTables returns [] for a non-table feature', () => {
        expect(getUninstallableTables('posts',),).toEqual([],);
    },);
},);
```

- [ ] **Step 2: Run → fail** (`npm test -w packages/api -- --run src/features/registry.test.ts`).

- [ ] **Step 3: Implement** — extend `FeatureConfig` and add helpers. Add to the interface (after `migrations?`):

```ts
    /** Tables this feature owns, in CREATION order. Uninstall drops them
     *  in reverse with CASCADE. A feature with no `tables` is NOT
     *  uninstallable (its schema is part of the base install). */
    tables?: string[];
    /** Extra site_settings keys this feature owns (beyond `<key>_enabled`),
     *  deleted on uninstall. Supports exact keys or a `prefix*` glob. */
    settingsKeys?: string[];
    /** Idempotent init run inside the enable transaction, AFTER migrations.
     *  Seed defaults / register crons. Receives the txn client. */
    onEnable?: (client: import('pg').PoolClient, key: FeatureKey,) => Promise<void>;
    /** Idempotent cleanup run inside the uninstall transaction, BEFORE
     *  tables are dropped. Deregister crons / purge external resources. */
    onUninstall?: (client: import('pg').PoolClient, key: FeatureKey,) => Promise<void>;
```

Add helpers at the bottom:

```ts
/** A feature is uninstallable iff it declares owned tables. */
export function isUninstallable(key: FeatureKey,): boolean {
    return (FEATURE_REGISTRY[key].tables ?? []).length > 0;
}

/** Tables to drop on uninstall, in DROP order (reverse of creation). */
export function getUninstallableTables(key: FeatureKey,): string[] {
    return [...(FEATURE_REGISTRY[key].tables ?? []),].reverse();
}
```

- [ ] **Step 4: Run → pass. Step 5: Commit** `feat(api): feature registry — tables + onEnable/onUninstall hooks`.

### Task 0.2: onEnable hook fires during install

**Files:**
- Modify: `packages/api/src/services/settings.ts` (the enable loop ~360-387)
- Test: `packages/api/src/features/lifecycle.test.ts`

- [ ] **Step 1: Failing test** — mock the DB pool + a fake feature with an `onEnable` spy. Because `updateSettings` is DB-heavy, test the smaller unit: extract the per-step install into a helper `installFeatureStep(key, client)` in a new `features/lifecycle.ts` that runs `applyFeatureMigrations` then `onEnable`. Test it with a mocked client + a registry stub.

```ts
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const applyMock = vi.fn().mockResolvedValue(['039_x.sql',],);
vi.mock('./migrations', () => ({ applyFeatureMigrations: (...a: unknown[],) => applyMock(...a,), }),);

import { installFeatureStep, } from './lifecycle';
import { FEATURE_REGISTRY, } from './registry';

describe('installFeatureStep', () => {
    beforeEach(() => applyMock.mockClear(),);
    it('runs migrations then the onEnable hook, returning applied migrations', async () => {
        const hook = vi.fn().mockResolvedValue(undefined,);
        (FEATURE_REGISTRY as Record<string, unknown>).__test = {
            key: '__test', label: 'T', defaultEnabled: false, onEnable: hook,
        };
        const client = {} as never;
        const applied = await installFeatureStep('__test' as never, client,);
        expect(applyMock,).toHaveBeenCalledWith('__test', client,);
        expect(hook,).toHaveBeenCalledWith(client, '__test',);
        expect(applied,).toEqual(['039_x.sql',],);
        delete (FEATURE_REGISTRY as Record<string, unknown>).__test;
    },);
},);
```

- [ ] **Step 2: Run → fail. Step 3: Implement `features/lifecycle.ts`**:

```ts
import type { PoolClient, } from 'pg';
import { applyFeatureMigrations, } from './migrations';
import { FEATURE_REGISTRY, FeatureKey, } from './registry';

/** Install a single feature inside the caller's transaction: run its
 *  migrations, then its idempotent onEnable hook. Returns the migration
 *  filenames that ran (for the client install status). */
export async function installFeatureStep(key: FeatureKey, client: PoolClient,): Promise<string[]> {
    const applied = await applyFeatureMigrations(key, client,);
    await FEATURE_REGISTRY[key].onEnable?.(client, key,);
    return applied;
}
```

- [ ] **Step 4: Wire into `services/settings.ts`** — in the enable loop, replace `await applyFeatureMigrations(step.key, client,);` with capturing the applied list, and collect per-step results:

```ts
        const installResults: { key: FeatureKey; enabled: boolean; appliedMigrations: string[]; }[] = [];
        try {
            await client.query('BEGIN',);
            for (const step of result.plan) {
                let appliedMigrations: string[] = [];
                if (step.enabled) {
                    appliedMigrations = await installFeatureStep(step.key, client,);
                }
                await client.query(
                    `INSERT INTO site_settings (key, value, updated_by)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (key) DO UPDATE SET
                         value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
                    [featureSettingKey(step.key,), JSON.stringify(step.enabled,), actor,],
                );
                installResults.push({ key: step.key, enabled: step.enabled, appliedMigrations, },);
            }
            await client.query('COMMIT',);
        } catch (err) {
            await client.query('ROLLBACK',);
            throw err;
        } finally {
            client.release();
        }
```

Import `installFeatureStep` from `../features/lifecycle`; keep the existing `applyFeatureMigrations` import removable if now unused (it's used by lifecycle.ts). Attach `installResults` to the return so the response carries it: change the final `return { message: 'Settings updated' };` to `return { message: 'Settings updated', features: installResults, };` — and widen the return type accordingly (the SettingsUpdateResponse DTO gets the optional `features` field in Task 0.6).

- [ ] **Step 5: Run tests + build. Commit** `feat(api): run onEnable hook + surface install results on feature enable`.

### Task 0.3: `uninstallFeature` service

**Files:**
- Create: `packages/api/src/services/featureUninstall.ts`
- Test: `packages/api/src/services/featureUninstall.test.ts`
- Modify: `packages/api/src/features/registry.ts` (already has helpers from 0.1)

- [ ] **Step 1: Failing test** — mock the pool client; assert the transactional drop sequence + dependent-safety + non-uninstallable rejection. Use a fake registry entry with `tables`.

```ts
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queries: string[] = [];
const client = {
    query: vi.fn(async (sql: string,) => { queries.push(sql,); return { rows: [], }; }),
    release: vi.fn(),
};
vi.mock('../db/client', () => ({ getPool: () => ({ connect: async () => client, }), }),);
vi.mock('./audit', () => ({ logAudit: vi.fn(), }),);
vi.mock('./cache', () => ({ cache: { invalidateSettingsCache: vi.fn(), }, }),);

import { FEATURE_REGISTRY, } from '../features/registry';
import { uninstallFeature, UninstallError, } from './featureUninstall';

const ctx = { userId: 'u', ipAddress: '', userAgent: '', };

describe('uninstallFeature', () => {
    beforeEach(() => { queries.length = 0; client.query.mockClear(); },);

    it('rejects a feature with no owned tables', async () => {
        await expect(uninstallFeature('posts' as never, ctx,),).rejects.toBeInstanceOf(UninstallError,);
    },);

    it('drops tables in reverse order + deletes migration rows + settings + commits', async () => {
        (FEATURE_REGISTRY as Record<string, unknown>).__u = {
            key: '__u', label: 'U', defaultEnabled: false,
            tables: ['a', 'b', 'c',], settingsKeys: ['__u_config',],
        };
        await uninstallFeature('__u' as never, ctx,);
        const joined = queries.join('\n',);
        expect(joined,).toContain('BEGIN',);
        // reverse order: c, b, a
        expect(joined.indexOf('DROP TABLE IF EXISTS c'),).toBeLessThan(joined.indexOf('DROP TABLE IF EXISTS b'),);
        expect(joined.indexOf('DROP TABLE IF EXISTS b'),).toBeLessThan(joined.indexOf('DROP TABLE IF EXISTS a'),);
        expect(joined,).toContain('DELETE FROM schema_migrations WHERE feature',);
        expect(joined,).toContain('DELETE FROM site_settings WHERE key');
        expect(joined,).toContain('COMMIT',);
        delete (FEATURE_REGISTRY as Record<string, unknown>).__u;
    },);
},);
```

- [ ] **Step 2: Run → fail. Step 3: Implement `services/featureUninstall.ts`**:

```ts
import type { PoolClient, } from 'pg';
import { getPool, } from '../db/client';
import { logAudit, } from './audit';
import { cache, } from './cache';
import {
    FEATURE_REGISTRY, FeatureKey, featureSettingKey, getDependents,
    getUninstallableTables, isUninstallable,
} from '../features/registry';
import type { AuditContext, } from './types';

export class UninstallError extends Error {}

/** Enabled features that still require `key` — must be removed/disabled first. */
export function enabledDependents(
    key: FeatureKey, enabled: Record<FeatureKey, boolean>,
): FeatureKey[] {
    return getDependents(key,).filter((d,) => enabled[d],);
}

/**
 * Permanently remove a feature's tables + data. Transactional +
 * advisory-locked; idempotent (DROP IF EXISTS / DELETE WHERE). The
 * feature is disabled as part of the removal. Re-enabling later re-runs
 * the migrations (their schema_migrations rows were deleted).
 */
export async function uninstallFeature(key: FeatureKey, ctx: AuditContext,): Promise<{ droppedTables: string[]; }> {
    if (!FEATURE_REGISTRY[key]) throw new UninstallError(`Unknown feature: ${key}`,);
    if (!isUninstallable(key,)) {
        throw new UninstallError(`Feature '${key}' has no removable data (part of the base install).`,);
    }

    const pool = getPool();
    const client: PoolClient = await pool.connect();
    try {
        await client.query('BEGIN',);
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`feature:${key}`,],);

        // Dependent-safety: read current enabled state; block if any
        // ENABLED feature still requires this one.
        const rows = await client.query<{ key: string; value: unknown; }>(
            `SELECT key, value FROM site_settings WHERE key = ANY($1::text[])`,
            [(Object.keys(FEATURE_REGISTRY,) as FeatureKey[]).map(featureSettingKey,),],
        );
        const enabled = {} as Record<FeatureKey, boolean>;
        for (const k of Object.keys(FEATURE_REGISTRY,) as FeatureKey[]) {
            enabled[k] = FEATURE_REGISTRY[k].defaultEnabled;
        }
        for (const r of rows.rows) {
            const k = r.key.replace(/_enabled$/, '',) as FeatureKey;
            if (FEATURE_REGISTRY[k]) enabled[k] = r.value === true || r.value === 'true';
        }
        const deps = enabledDependents(key, enabled,);
        if (deps.length > 0) {
            throw new UninstallError(
                `Cannot remove '${key}': still required by enabled features: ${deps.join(', ',)}. Disable/remove them first.`,
            );
        }

        // Hook (deregister crons, external cleanup) before dropping.
        await FEATURE_REGISTRY[key].onUninstall?.(client, key,);

        const droppedTables = getUninstallableTables(key,); // reverse order
        for (const table of droppedTables) {
            // Identifier can't be parameterized; table names come from the
            // static registry (not user input) → safe to interpolate.
            await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`,);
        }

        await client.query(`DELETE FROM schema_migrations WHERE feature = $1`, [key,],);

        // Delete the *_enabled row + any declared feature-owned settings keys.
        const settingsKeys = [featureSettingKey(key,), ...(FEATURE_REGISTRY[key].settingsKeys ?? []),];
        const exact = settingsKeys.filter((k,) => !k.endsWith('*',),);
        const globs = settingsKeys.filter((k,) => k.endsWith('*',),).map((k,) => k.slice(0, -1,) + '%',);
        if (exact.length) await client.query(`DELETE FROM site_settings WHERE key = ANY($1::text[])`, [exact,],);
        for (const g of globs) await client.query(`DELETE FROM site_settings WHERE key LIKE $1`, [g,],);

        await client.query('COMMIT',);

        await logAudit({
            userId: ctx.userId, action: 'uninstall', entityType: 'feature', entityId: key,
            oldValues: { tables: droppedTables, }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        },);
        await cache.invalidateSettingsCache();
        return { droppedTables, };
    } catch (err) {
        await client.query('ROLLBACK',);
        throw err;
    } finally {
        client.release();
    }
}
```

- [ ] **Step 4: Run → pass. Step 5: Commit** `feat(api): uninstallFeature — transactional table/data removal`.

### Task 0.4: Uninstall route + DTOs binding

**Files:**
- Modify: `packages/api/src/routes/settings.ts`
- Modify: `packages/shared/src/api/routes/settings.ts` (DTOs — done in 0.6, but reference here)

- [ ] **Step 1: Add the route** to the `settingsRoutes` array in `routes/settings.ts` (admin tier; reject key auth like other management routes — the settings module already 404s/handles that pattern; if a `rejectKeyAuth` helper exists use it, else `admin` tier is acceptable and the client is JWT). Add:

```ts
    defineRoute({
        method: 'post', path: '/features/:key/uninstall', auth: 'admin',
        summary: 'Permanently remove a feature: drop its tables + data. Irreversible.',
        input: {
            params: z.object({ key: z.string(), },),
            body: z.object({ confirm: z.literal(true,), },),
        },
        handler: async ({ params, audit, },) => {
            const result = await settings.uninstallFeature(params.key as never, audit(),);
            return { message: `Removed ${params.key}`, ...result, };
        },
    },),
```

Re-export `uninstallFeature` + `UninstallError` from `services/settings.ts` (add `export { uninstallFeature, UninstallError, } from './featureUninstall';`) OR import directly in the route. Map `UninstallError` → a 409/400 in `middleware/error.ts` if it isn't an AppError — SIMPLEST: make `UninstallError extends AppError` with status 409, code `CONFLICT` (adjust Task 0.3 to extend AppError from `../core/errors` with `super(409,'CONFLICT',message)`). Update the 0.3 test import accordingly.

- [ ] **Step 2: Build + the api test suite green** (`npm run build -w packages/api && npm test -w packages/api -- --run`). **Commit** `feat(api): POST /settings/features/:key/uninstall route`.

### Task 0.5: `requireFeature` route guard + `registerModule` feature option

**Files:**
- Create: `packages/api/src/api/requireFeature.ts`
- Modify: `packages/api/src/api/registry.ts` (registerModule opts + buildRouter)
- Test: `packages/api/src/api/requireFeature.test.ts`

- [ ] **Step 1: Failing test** — a supertest app mounting a `feature`-gated router; feature off → 404, on → 200. Mock the feature-state read.

```ts
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi, } from 'vitest';

const enabledMock = vi.fn();
vi.mock('../services/settings', () => ({ isFeatureEnabledServer: (...a: unknown[],) => enabledMock(...a,), }),);

import { requireFeature, } from './requireFeature';

function app(on: boolean,) {
    enabledMock.mockResolvedValue(on,);
    const a = express();
    a.get('/x', requireFeature('shop' as never,), (_req, res,) => res.json({ success: true, data: 'ok', },),);
    return a;
}

describe('requireFeature', () => {
    beforeEach(() => enabledMock.mockReset(),);
    it('404s when the feature is disabled', async () => {
        const res = await request(app(false,),).get('/x',);
        expect(res.status,).toBe(404,);
    },);
    it('passes when enabled', async () => {
        const res = await request(app(true,),).get('/x',);
        expect(res.status,).toBe(200,);
    },);
},);
```

- [ ] **Step 2: Add a server-side feature check** — in `services/settings.ts` add + export `isFeatureEnabledServer(key)` reading the `<key>_enabled` row (cached via the settings cache; default from registry `defaultEnabled`):

```ts
export async function isFeatureEnabledServer(key: FeatureKey,): Promise<boolean> {
    const row = await get<unknown>(featureSettingKey(key,),);
    if (row === null) return FEATURE_REGISTRY[key].defaultEnabled;
    return row === true || row === 'true';
}
```

- [ ] **Step 3: Implement `api/requireFeature.ts`**:

```ts
import type { NextFunction, Request, Response, } from 'express';
import type { FeatureKey, } from '../features/registry';
import { isFeatureEnabledServer, } from '../services/settings';

/** Route guard: 404 the request when `feature` is disabled, so a
 *  disabled feature's endpoints behave as if they don't exist. */
export function requireFeature(feature: FeatureKey,) {
    return async (_req: Request, res: Response, next: NextFunction,) => {
        try {
            if (await isFeatureEnabledServer(feature,)) return next();
        } catch { /* fall through to 404 */ }
        res.status(404,).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found', }, },);
    };
}
```

- [ ] **Step 4: Extend `registerModule`** — accept `feature?: FeatureKey` and, when set, prepend the guard to the returned router:

```ts
export function registerModule(
    module: string, defs: RouteDef[], opts: { mountPath: string; feature?: FeatureKey; },
): Router {
    const entry: ModuleEntry = { module, mountPath: opts.mountPath, defs, };
    const existing = registry.findIndex((e,) => e.module === module,);
    if (existing >= 0) registry[existing] = entry; else registry.push(entry,);
    const router = buildRouter(defs,);
    if (opts.feature) {
        const gated = Router();
        gated.use(requireFeature(opts.feature,),);
        gated.use(router,);
        return gated;
    }
    return router;
}
```

Import `requireFeature` + the `FeatureKey` type. (The manifest still records the routes so they appear in docs; the guard only affects runtime.)

- [ ] **Step 5: Run tests + build. Commit** `feat(api): requireFeature guard + registerModule feature gating`.

### Task 0.6: Shared DTOs — install result, uninstall, SiteFeatures.shop

**Files:**
- Modify: `packages/shared/src/api/routes/settings.ts`
- Modify: `packages/shared/src/types/content.ts` (`SiteFeatures`)

- [ ] **Step 1:** In `content.ts` `SiteFeatures`, add `shop: { enabled: boolean; };` (keep alphabetical/logical order). Update `SiteFeatureKey` if it's a hand-list (it's `keyof SiteFeatures` — auto).
- [ ] **Step 2:** In `api/routes/settings.ts`, extend `SettingsUpdateResponse` to `{ message: string; features?: { key: string; enabled: boolean; appliedMigrations: string[]; }[]; }` and add:

```ts
/** POST /settings/features/:key/uninstall */
export interface SettingsFeatureUninstallBody { confirm: true; }
export interface SettingsFeatureUninstallResponse { message: string; droppedTables: string[]; }
```

- [ ] **Step 3:** Update `services/settings.ts` `computePublicFeatures` return to include `shop: { enabled: settings.shop_enabled === true, }`.
- [ ] **Step 4:** Build shared + api + the api suite green. **Commit** `feat(shared): settings install/uninstall DTOs + SiteFeatures.shop`.

### Task 0.7: SDK `cms.settings.uninstallFeature` + coverage

**Files:**
- Modify: `packages/cms-client/src/modules/settings.ts`
- Modify: `packages/cms-client/src/modules/coverage.ts`
- Test: extend `packages/cms-client/src/modules/settings.test.ts` (or the existing settings test)

- [ ] **Step 1:** Add to `SettingsModule`:

```ts
    /** Permanently remove a feature (drops tables + data). Irreversible. */
    uninstallFeature(key: string,): Promise<SettingsFeatureUninstallResponse> {
        return this.mutate<SettingsFeatureUninstallResponse>('POST', '/settings/features/:key/uninstall', {
            params: { key, }, body: { confirm: true, }, invalidates: ['settings',],
        },);
    }
```

Import the DTO. **Step 2:** Add `'POST /api/v1/settings/features/:key/uninstall'` to the settings entry in `coverage.ts`. **Step 3:** A unit test asserting the method builds the right URL/body (mock fetch). **Step 4:** tsc + client tests + `check:drift` green. **Commit** `feat(cms-client): settings.uninstallFeature + coverage`.

### Task 0.8: Client install/remove UX

**Files:**
- Modify: `packages/cms/src/components/admin/features/FeatureToggleRow.tsx`
- Create: `packages/cms/src/components/admin/features/FeatureRemoveModal.tsx`
- Modify: `packages/cms/src/pages/admin/Settings.tsx` (the Features section — pass an `onRemove` + read the extended update result)
- Modify: `packages/cms/src/config/features.ts` (add `shop` — see Phase 1 note; here just ensure the type allows it)

- [ ] **Step 1:** `FeatureToggleRow` — add a `busy` signal + an optional `onRemove` prop. During `onChange`/remove, set `busy(true)`, disable the switch, show a spinner + "Installing…"/"Removing…" label; clear in `finally`. When the feature is enabled, render a small **Remove…** text button; when disabled and previously-installed, show a muted "Disabled — data preserved" hint. Clicking Remove opens `FeatureRemoveModal`.
- [ ] **Step 2:** `FeatureRemoveModal` — a destructive confirm: title, the feature label, a warning ("permanently delete all <label> data and tables — cannot be undone"), a **type the feature name to confirm** input, Cancel + a disabled-until-typed **Remove permanently** button. `onConfirm` calls the passed handler.
- [ ] **Step 3:** In `Settings.tsx` Features section, wire `onRemove={async () => { await cms.settings.uninstallFeature(f.key); await reloadSiteSettings(); refetch(); }}` and, in the existing `onChange`, on success surface `result.features` (installed) via the existing toast/alert; keep the 409 cascade handling.
- [ ] **Step 4:** `npx tsc -p packages/cms/tsconfig.json --noEmit` (0) + `npm run build -w packages/cms` clean. **Commit** `feat(cms-web): feature install status + Remove/uninstall UX`.

### Task 0.9: Lifecycle verification

- [ ] Side-port smoke (PORT dance, restore .env): with a throwaway disabled test feature declaring `tables` (or dry-run against `mailing_lists` on a scratch DB): enable → tables created + `_enabled=true` + response carries `appliedMigrations`; re-enable → idempotent no-op; call uninstall → tables gone + `schema_migrations` rows gone + `_enabled` row gone; re-enable → tables recreated. Report. No commit (verification).

---

# PHASES 1–8 — Shop feature

**Recipe reference:** each backend module follows the proven manifest pattern (see `packages/api/src/routes/campaigns.ts` + `services/campaigns.ts` + `repositories/campaigns.repo.ts`), each SDK namespace follows `packages/cms-client/src/modules/campaigns.ts`, each DTO file follows `packages/shared/src/api/routes/campaigns.ts`, each admin page follows the existing admin pages + `usePaginatedList({fetch})`/`useBulkActions`/`MediaSelectModal`. THE SACRED PATTERNS apply (isAdminRole||apiKey, cache guard on public lists, uuidOrNull on actor/guest FKs). Every phase ends: `npm run build && npm test -w packages/api -- --run && tsc -p packages/cms --noEmit && npm test -w packages/cms-client -- --run && check:drift` green; one commit per logical unit.

### Phase 1 — Shop foundation

- [ ] **Registry entry** (`features/registry.ts`): add `'shop'` to `FeatureKey`; add the `shop` entry: `requires:['users']`, `migrations:['039…', …]` (the files below), `tables:[…]` (creation order — the `shop_*` list from the spec §B1), `settingsKeys:['shop_settings','shop_appearance']`, `onEnable` (seed default `shop_settings`+`shop_appearance` rows if absent — idempotent `INSERT … ON CONFLICT DO NOTHING`), `onUninstall` (cache clear). `defaultEnabled:false`.
- [ ] **Migrations `039`–`049`** (`db/migrations/`, each `-- @feature shop`, DDL per spec §B1): `039_create_shop_products.sql`, `040_create_shop_product_options.sql`, `041_create_shop_option_values.sql`, `042_create_shop_variants.sql`, `043_create_shop_product_media.sql`, `044_create_shop_categories.sql` (+ `shop_product_categories`), `045_create_shop_collections.sql` (+ `shop_collection_products`), `046_create_shop_product_tags.sql`, `047_create_shop_reviews.sql`, `048_create_shop_orders.sql`, `049_create_shop_order_items.sql`. `gen_random_uuid()` PKs, `updated_at` triggers, FK ON DELETE (CASCADE for children, SET NULL for media/user/order links), indexes on slug/status/product_id/order_number/user_id/email, the variant unique `(product_id,option1,option2,option3)`, the m2m PKs. Run `npm run db:migrate` on a scratch DB to verify each applies; `\d` spot-check.
- [ ] **Shared types** (`packages/shared/src/types/shop.ts`): `ShopProduct`, `ShopProductOption`, `ShopOptionValue`, `ShopVariant`, `ShopProductMedia`, `ShopCategory`, `ShopCollection`, `ShopReview`, `ShopOrder`, `ShopOrderItem`, `ShopSettings`, `ShopAppearance` — barrel-export from `types/index.ts`.
- [ ] **DTO skeleton** (`packages/shared/src/api/routes/shop.ts`): the request/response DTOs (filled per sub-area in Phases 2–5); barrel-export. Add `shop` to `SiteFeatures` already done in 0.6.
- [ ] Gates green. Commits: one for registry+migrations, one for shared types/DTOs.

### Phase 2 — Catalog backend

- [ ] **Repositories** (`repositories/shop/`): `shopProducts.repo.ts` (products + nested options/values/variants/media reads via joins or follow-up queries; public = active-only), `shopCatalog.repo.ts` (categories tree, collections, tags m2m). Use `base.repo` helpers + `mapRow` + `uuidOrNull`.
- [ ] **Services** (`services/shop/products.ts`, `variants.ts`, `catalog.ts`): public cached reads (active-only → cache-safe), admin CRUD with audit + cache invalidation, variant/option/media nested writes (a product save replaces its options/variants transactionally; media attach/sort/main). Rating fields read-only here (Phase 3 writes them).
- [ ] **Routes** (`routes/shop.ts`, mounted with `feature:'shop'`): products list/slug/by-id/create/update/delete/bulk; variants + options + media sub-routes; categories/collections/tags CRUD + public reads. Per spec §B2 permissions table.
- [ ] **`routes/index.ts`**: `router.use('/shop', registerModule('shop', shopRoutes, { mountPath:'/api/v1/shop', feature:'shop' },),);`
- [ ] **DTOs** for every catalog route (`api/routes/shop.ts`); bind zod. **SDK**: `cms.shop.products/.variants/.categories/.collections/.tags` (`packages/cms-client/src/modules/shop.ts` — a `ShopModule` exposing grouped sub-objects); register in `modules/index.ts` + `coverage.ts`. A few representative supertest/api tests (public list active-only, admin create, variant nested write) + a client method test.
- [ ] Gates + `check:drift` green. Commits per sub-area.

### Phase 3 — Reviews backend

- [ ] Repo/service/routes for reviews: `GET /shop/reviews?productId=` (approved, public, cached), `POST /shop/products/:id/reviews` (user tier; set `verified_purchase` by checking the user has a paid order_item for the product; `uuidOrNull` guest N/A — user tier requires login), `PATCH/DELETE /shop/reviews/:id` (admin moderate). On approve/reject/delete, recompute `shop_products.rating_avg/rating_count` (service, transactional). DTOs + `cms.shop.reviews` + coverage + tests. Gates green.

### Phase 4 — Checkout + orders backend

- [ ] **Checkout service** (`services/shop/checkout.ts`): validate each `{variantId, qty}` against DB (exists, active, inventory ≥ qty), compute subtotal from DB prices, compute shipping from `shop_settings`, call Stripe Tax (create a Tax Calculation with line items + `shipping_address`) for `tax_cents`, create `shop_orders`(pending)+`shop_order_items`(snapshots), create a PaymentIntent (amount = total, `metadata.orderType='shop'`, `metadata.orderId`), return `{ clientSecret, orderId, orderNumber }`. `uuidOrNull` on guest `user_id`.
- [ ] **Webhook**: extend the existing `payments.handleWebhook` dispatcher (`services/payments.ts`) — on `payment_intent.succeeded` with `metadata.orderType==='shop'`, mark the order paid, decrement variant inventory (transactional, guard against oversell), set digital `download_token`s, send a receipt email (reuse the mail/email service), insert a `transactions` row (`type:'purchase'`). Keep the single raw webhook mount.
- [ ] **Orders service/routes**: `GET /shop/orders` (user→own by user_id/email, admin→all, role-shaped, paginated), `GET /shop/orders/:id`, `PATCH /shop/orders/:id` (admin: status/fulfillment/tracking/notes, refund via Stripe, resend email). Digital download route `GET /shop/orders/:number/download/:token` (raw stream or signed URL; token-gated).
- [ ] DTOs + `cms.shop.checkout/.orders` + coverage + tests (checkout validation rejects bad price/inventory; webhook marks paid + decrements; my-orders filter). Gates green.

### Phase 5 — Shop settings backend

- [ ] `services/shop/settings.ts`: `getPublic` (storefront-safe appearance + safe config — currency, tax-inclusive flag, store-enabled, grid options; NO secret keys), `getAdmin`/`update` (full: Stripe status/business info/Stripe-Tax on-off/currency, shipping flat/table config, appearance). Stored as `site_settings` rows `shop_settings` + `shop_appearance` (JSONB), cached like other settings; public projection cache-safe. Routes `GET /shop/settings` (public projection) + admin `GET`/`PUT`. DTOs + `cms.shop.settings` + coverage + tests. Gates green.

### Phase 6 — Admin UI

- [ ] **Nav**: add `{ path:'/admin/shop', label:'Shop', icon:'shop', feature:'shop' }` to `NAV_ITEMS` (AdminLayout). Add a `shop` icon to the admin icon set.
- [ ] **Routes** (App.tsx, under `/admin`, rendered when `isFeatureEnabled('shop')`): `/shop` (Dashboard), `/shop/products` (+ `/new`, `/:id`), `/shop/categories`, `/shop/collections`, `/shop/orders` (+ `/:id`), `/shop/reviews`, `/shop/settings`.
- [ ] **Pages** (`pages/admin/shop/`): Dashboard (recent orders/sales/low-inventory), Products list (`usePaginatedList({fetch:(p)=>cms.shop.products.list(p)})` + `useBulkActions`), ProductEditor (options/variants matrix editor, `MediaSelectModal` picker with drag-sort + main-image, category/collection/tag assignment, per-variant price/inventory), Categories, Collections, Orders list, OrderDetail (items, customer/shipping, status transitions, tracking, contact/email buyer, refund), Reviews moderation, Settings (tabbed General·Payments·Shipping·Appearance). SCSS partials under the admin styles convention (read `ADMIN_STYLES.md`).
- [ ] tsc + build green. Commits per page-group.

### Phase 7 — Storefront UI

- [ ] **Routes** (App.tsx public, rendered when `isFeatureEnabled('shop')`): `/shop`, `/shop/:slug`, `/shop/collections/:slug`, `/shop/categories/:slug`, `/shop/cart`, `/shop/checkout`, `/shop/orders/:number`.
- [ ] **Cart store** (`stores/shopCart.ts`): localStorage-backed `{ items: {variantId, qty}[] }`, add/update/remove/clear, a mini-cart signal.
- [ ] **Pages** (`pages/shop/`): ShopIndex (product grid, filters, search, pagination, per ShopAppearance + `--site-*`), ProductPage (media gallery images+video sorted/main, variant selector → resolves to a variant, price, add-to-cart, description, reviews list + write-review, rating summary), CollectionPage/CategoryPage (filtered grids), CartPage, CheckoutPage (address form + Stripe Elements, live Stripe-Tax total via a checkout-preview call, place order → confirm PaymentIntent), OrderConfirmation (status + digital download links). Mini-cart in the layout header. **Replace** `pages/Shop.tsx` (Shopify iframe) with ShopIndex; update the `/shop` route.
- [ ] DonationForm's Stripe Elements pattern is the checkout reference. tsc + build green. Commits per page-group.

### Phase 8 — Docs + verify

- [ ] `npm run docs:api` (regen `docs/API.md` + `docs/api-manifest.json` — shop routes appear). Update CLAUDE.md (new `shop` feature + its module/SDK + the feature-lifecycle install/uninstall + `requireFeature`). Add a short `docs/features/shop.md`. Update `packages/cms-client/docs/Overview.md` (cms.shop section). Update the design spec status → Implemented.
- [ ] **End-to-end smoke** (side-port): enable `shop` (with users) → create a variant product via SDK → guest checkout (mock/stub Stripe or test-mode) → webhook marks paid + inventory decremented → my-order visible → admin sees order → uninstall `shop` → all `shop_*` tables + rows gone, `/api/v1/shop/*` 404s. Report.
- [ ] Final whole-feature review.

---

## Self-review notes
- **Spec coverage:** Part A (lifecycle) → Phase 0 tasks 0.1–0.9 (registry hooks, onEnable, install status, uninstall service+route, requireFeature, DTOs, SDK, client UX, verify). Part B (shop) → Phases 1–8 (foundation/catalog/reviews/checkout+orders/settings/admin/storefront/docs). Every spec §B1 table, §B2 route/permission, §B4 SDK, §B5 admin page, §B6 storefront page is assigned.
- **Placeholder scan:** Phase 0 tasks carry full code; Phases 1–8 are task specs against the proven recipe (campaigns/cms-client/admin patterns) with concrete file paths, DDL list, route/permission table, and per-phase gates — the deviations (variants nested write, Stripe Tax, webhook routing, guest uuidOrNull, requireFeature mount) are called out explicitly rather than left vague.
- **Type consistency:** `installFeatureStep`, `uninstallFeature`, `UninstallError`(→extends AppError 409 per 0.4), `requireFeature`, `isFeatureEnabledServer`, `SettingsFeatureUninstallBody/Response`, `SiteFeatures.shop`, `cms.settings.uninstallFeature`, `cms.shop.*` — names consistent across tasks.
- **UninstallError**: Task 0.3 test uses `UninstallError`; 0.4 makes it `extends AppError(409,'CONFLICT')` — update the 0.3 impl to extend AppError from `../core/errors` so the route maps it automatically (adjust the 0.3 test to still assert `instanceof UninstallError`, which holds).
