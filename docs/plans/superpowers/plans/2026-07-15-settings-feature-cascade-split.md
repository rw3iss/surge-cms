# Settings / Feature-Cascade Split — Implementation Plan

> **For agentic workers:** This plan is designed for execution with `superpowers:subagent-driven-development` (independent tasks in the current session) or `superpowers:executing-plans`. Each task is bite-sized, compiles independently, and ends on a green build + test run. Do NOT batch tasks — verify after each. This is a **pure mechanical extraction with ZERO behavior change**: the same SQL, the same transaction boundaries, the same `FeatureCascadeError` 409 body, the same public export surface. If a test that was green goes red, you introduced behavior drift — stop and revert, do not "fix forward".

## Goal

Extract the feature enable/disable dependency-cascade orchestration out of `packages/api/src/services/settings.ts` (~625 lines) into a new `packages/api/src/services/features/cascade.ts`, leaving `settings.ts` to plain settings I/O plus the header/footer/appearance/branding/public projections. Specifically move `updateSettings`, the `UpdateSettingsInput` interface, and the `FeatureCascadeError` class. `settings.ts` re-exports all three so every existing import path (route handler, SDK barrel `cms.settings.*`, and `middleware/error.ts`) keeps resolving unchanged.

**Non-goals / invariants:**
- **NO behavior change.** Same queries, same `BEGIN`/`COMMIT`/`ROLLBACK` flow, same advisory-lock semantics (owned by `installFeatureStep` → `applyFeatureMigrations`), same audit rows, same cache invalidation.
- The `PUT /settings` **409 body stays byte-identical** — `{ success: false, error: <planner result> }` emitted by `middleware/error.ts`, driven by `throw new FeatureCascadeError(result)`.
- All **108 tests stay green** (24 test files under `packages/api/src`).
- Public import surface stable: `cms.settings.updateSettings`, `cms.settings.FeatureCascadeError`, `middleware/error`'s `import { FeatureCascadeError } from '../services/settings'`.

## Architecture

Today `services/settings.ts` mixes three concerns:
1. **Plain settings I/O** — `get`/`set`/`remove`/`list`, `setRawKey`/`deleteRawKey`, the keyed JSON getters/setters (homepage hero, site header/footer, branding, appearance), admin appearance.
2. **Projections** — `getPublicSettings` (+ `computePublicFeatures`), `getAllSettings`, `isFeatureEnabledServer`.
3. **Feature-cascade orchestration** — `updateSettings` (lines ~309–436), the `UpdateSettingsInput` interface (~275–287), and `FeatureCascadeError` (~293–298). This is the only part that reaches into `features/registry` (`validateEnable`, `installFeatureStep`, `getPool` + the manual `BEGIN`/`COMMIT` transaction around the migration applier).

Concern #3 is the split target. After the split:

```
services/
├── settings.ts              # concerns #1 + #2; re-exports #3 for back-compat
└── features/
    └── cascade.ts           # concern #3: updateSettings + UpdateSettingsInput + FeatureCascadeError
```

`cascade.ts` depends on `features/registry` + `features/validator` + `features/lifecycle` (the existing `src/features/` module) and on the shared `db`/`cache`/`audit`/`uuid` utilities — exactly the deps `updateSettings` uses today. It does **not** import from `settings.ts`, so there is no `settings ↔ cascade` cycle. It imports `ValidationError` from `../../core/errors` (NOT `../../middleware/error`) to avoid re-introducing a `middleware/error → settings → cascade → middleware/error` cycle.

### FeatureCascadeError re-export decision

**Chosen: keep `FeatureCascadeError` (and `updateSettings` + `UpdateSettingsInput`) re-exported from `settings.ts`; do NOT touch `middleware/error.ts`.**

- `cascade.ts` becomes the canonical definition site.
- `settings.ts` adds one line: `export { FeatureCascadeError, updateSettings, type UpdateSettingsInput } from './features/cascade';`
- `middleware/error.ts` keeps `import { FeatureCascadeError } from '../services/settings';` unchanged.
- `sdk/settings.ts` (`export * from '../services/settings'`) transparently re-surfaces the re-exported names, so `cms.settings.updateSettings` / `cms.settings.FeatureCascadeError` stay identical.

**Why this is lower-risk than repointing the middleware import:**
1. It touches **zero** files outside the two under refactor (settings.ts + new cascade.ts). Repointing `middleware/error.ts` to `../services/features/cascade` would edit a third, high-blast-radius file (the global error handler) for no functional gain.
2. It keeps **both** consumers (middleware AND the SDK barrel) pointing at the same stable path, so no follow-up sweep of import sites is needed.
3. `instanceof FeatureCascadeError` is identity-based on the single class object; a re-export is the *same* class object, so the middleware's `err instanceof FeatureCascadeError` check and the 409 mapping are provably unchanged.
4. No new cycle: `middleware/error → settings → cascade`, and `cascade` imports `ValidationError` from `core/errors` (not middleware), so the chain terminates. (`settings.ts` itself already imports `ValidationError` from `middleware/error`; that pre-existing edge is untouched and unrelated.)

## Tech Stack

- TypeScript (Node ≥ 20), Express, raw `pg` queries.
- Vitest for tests (`packages/api`).
- Build/test via pnpm workspace filters: `pnpm --filter @sitesurge/server build`, `pnpm --filter @sitesurge/server test`.
- No new dependencies. No schema/migration changes. No DTO changes.

---

## File Structure

### Created
- **`packages/api/src/services/features/cascade.ts`** — new module. Owns:
  - `export class FeatureCascadeError extends Error` (moved verbatim from settings.ts:293–298).
  - `export interface UpdateSettingsInput` (moved verbatim from settings.ts:275–287).
  - `export async function updateSettings(data, ctx)` (moved verbatim from settings.ts:309–436), including the private `settingsMap` write loop, the `data.features` planner block, the `getPool()` `BEGIN`/`COMMIT`/`ROLLBACK` transaction around `installFeatureStep`, and both `logAudit` calls + final `cache.invalidateSettingsCache()`.
  - Imports: `query`, `getPool`, `logAudit`, `cache`, `FEATURE_REGISTRY`/`FeatureKey`/`featureSettingKey`, `validateEnable`, `installFeatureStep`, `uuidOrNull`, `AuditContext`, and `ValidationError` **from `../../core/errors`** (not middleware).

### Modified
- **`packages/api/src/services/settings.ts`** — remove the three moved symbols and the now-unused imports (`getPool`, `validateEnable`, `installFeatureStep`). Add one re-export line so `updateSettings` / `UpdateSettingsInput` / `FeatureCascadeError` remain importable from `../services/settings`. Keep everything else byte-identical (the `export { uninstallFeature, UninstallError } from './featureUninstall';` line stays put).

### Untouched (verified consumers — must keep resolving)
- `packages/api/src/routes/settings.ts` — `import * as settings from '../services/settings'`; calls `settings.updateSettings(body, audit())`. Resolves via the re-export.
- `packages/api/src/middleware/error.ts` — `import { FeatureCascadeError } from '../services/settings'`. Resolves via the re-export; `instanceof` + 409 mapping unchanged.
- `packages/api/src/sdk/settings.ts` — `export * from '../services/settings'` → `cms.settings.*`. Re-surfaces the moved names transparently.
- `packages/cms-client/*` and `packages/cms-mcp/*` — their own `FeatureCascadeError` is a **separate client-side class** (`packages/cms-client/src/core/errors.ts`), independent of the server class. No change.

---

## Bite-sized tasks

### Task 1 — Create `services/features/cascade.ts` with the moved logic

Create the new module by moving (not rewriting) the three symbols out of `settings.ts`. The body of `updateSettings` must be copied **character-for-character** from the current file.

**Files**
- Create: `packages/api/src/services/features/cascade.ts`
- Reference (do not edit yet): `packages/api/src/services/settings.ts` lines 275–436

**Steps**
- [ ] Create `packages/api/src/services/features/cascade.ts` with this exact header + imports (paths are relative to `services/features/`):

  ```ts
  /**
   * Feature dependency-cascade orchestration, split out of
   * `services/settings.ts`. Owns the `PUT /settings` feature-toggle path:
   * the dependency planner (`validateEnable`) + the lazy-install migration
   * applier (`installFeatureStep`) wrapped in a single BEGIN/COMMIT so a
   * failed migration rolls the whole toggle back and the feature stays off.
   *
   * `FeatureCascadeError` is defined here and re-exported from
   * `services/settings.ts` for back-compat (middleware/error + the SDK
   * barrel both import it from there).
   */
  import { query, } from '../../db';
  import { getPool, } from '../../db/client';
  import { ValidationError, } from '../../core/errors';
  import { logAudit, } from '../audit';
  import { cache, } from '../cache';
  import { FEATURE_REGISTRY, FeatureKey, featureSettingKey, } from '../../features/registry';
  import { validateEnable, } from '../../features/validator';
  import { installFeatureStep, } from '../../features/lifecycle';
  import { uuidOrNull, } from '../../utils/uuid';
  import type { AuditContext, } from '../types';
  ```

- [ ] Move the `UpdateSettingsInput` interface **verbatim** (settings.ts:275–287):

  ```ts
  export interface UpdateSettingsInput {
      siteName?: string;
      siteDescription?: string;
      logo?: string | null;
      favicon?: string | null;
      socialLinks?: Record<string, string>;
      contactEmail?: string;
      analytics?: { googleAnalyticsId?: string; facebookPixelId?: string; };
      theme?: { primaryColor?: string; secondaryColor?: string; accentColor?: string; };
      features?: Record<string, boolean>;
      enableDependencies?: boolean;
      disableDependents?: boolean;
  }
  ```

- [ ] Move the `FeatureCascadeError` class **verbatim** (settings.ts:293–298):

  ```ts
  /** Thrown when the feature dependency planner rejects a toggle. Carries
   *  the planner result so the route can return it as the 409 body. */
  export class FeatureCascadeError extends Error {
      constructor(public readonly result: unknown,) {
          super('Feature cascade rejected',);
          this.name = 'FeatureCascadeError';
      }
  }
  ```

- [ ] Move the `updateSettings` function **verbatim** (settings.ts:309–436). It begins:

  ```ts
  export async function updateSettings(data: UpdateSettingsInput, ctx: AuditContext,): Promise<{
      message: string;
      features?: { key: FeatureKey; enabled: boolean; appliedMigrations: string[]; }[];
  }> {
      const actor = uuidOrNull(ctx.userId,);
      const installResults: { key: FeatureKey; enabled: boolean; appliedMigrations: string[]; }[] = [];
      const settingsMap: Record<string, unknown> = {
          site_name: data.siteName,
          site_description: data.siteDescription,
          logo: data.logo,
          favicon: data.favicon,
          social_links: data.socialLinks,
          contact_email: data.contactEmail,
          analytics: data.analytics,
          theme: data.theme,
      };
      // ... (the settingsMap write loop, the `if (data.features) { … }` planner
      //      + validateEnable + getPool()/BEGIN/COMMIT/ROLLBACK block calling
      //      installFeatureStep, both logAudit calls, final invalidateSettingsCache)
      return { message: 'Settings updated', features: installResults, };
  }
  ```

  Copy the **entire** body (all of settings.ts:309–436) with no edits. In particular preserve: the `throw new ValidationError(\`Unknown feature: ${k}\`)` on an unknown feature; `throw new FeatureCascadeError(result)` when `!result.ok`; the `pool.connect()` → `client.query('BEGIN')` → per-step `installFeatureStep(step.key, client)` → `INSERT … site_settings` → `client.query('COMMIT')` with `ROLLBACK` in `catch` and `client.release()` in `finally`; the features `logAudit` (`entityId: 'features'`); the trailing `cache.invalidateSettingsCache()` + top-level `logAudit`.

- [ ] Verify build (types + resolution of the new module):
  ```bash
  pnpm --filter @sitesurge/server build
  ```
  Expect: clean. `cascade.ts` compiles; `settings.ts` now has duplicate symbols removed in Task 2, so at THIS point there will be duplicate exports (both files define them). **Do not build between Task 1 and Task 2 as a gate** — Task 1 and Task 2 are a single atomic edit pair. Perform Task 2 before building. (If you must sanity-check Task 1 alone, run `pnpm --filter @sitesurge/server exec tsc --noEmit -p .` and expect only "Duplicate identifier"/"already declared" style errors originating from settings.ts still holding the originals — those clear in Task 2.)

- [ ] **Commit after Task 2** (Task 1 + Task 2 land together — see Task 2).

### Task 2 — Strip moved symbols from `settings.ts` and add the re-export shim

**Files**
- Modify: `packages/api/src/services/settings.ts`

**Steps**
- [ ] Update the import block: **remove** the three imports now used only by the moved code. Change lines 26–27 region so that `validateEnable` and `installFeatureStep` are gone, and remove `getPool` from the line-21 import. Concretely:
  - Delete `import { validateEnable, } from '../features/validator';` (line 26).
  - Delete `import { installFeatureStep, } from '../features/lifecycle';` (line 27).
  - Delete `import { getPool, } from '../db/client';` (line 21).
  - **Keep** `import { FEATURE_REGISTRY, FeatureKey, featureSettingKey, } from '../features/registry';` — still used by `isFeatureEnabledServer` (line 45–48).
  - **Keep** `import { ValidationError, } from '../middleware/error';` — still used by `setRawKey` (line 592).
  - **Keep** `uuidOrNull`, `cache`, `logAudit`, `query`, `config` imports — still used across the remaining functions.

- [ ] Delete the `UpdateSettingsInput` interface (settings.ts:275–287), the `FeatureCascadeError` class (settings.ts:291–298), and the entire `updateSettings` function (settings.ts:300–436). Leave the section comment `// ─── Admin: settings update (incl. feature cascade) ───` if you like, but it now precedes only the re-export.

- [ ] Add the re-export shim immediately after the existing `export { uninstallFeature, UninstallError, } from './featureUninstall';` line (currently line 289) so the feature-lifecycle re-exports sit together:

  ```ts
  export { uninstallFeature, UninstallError, } from './featureUninstall';

  // Feature dependency-cascade orchestration lives in ./features/cascade.
  // Re-exported here so existing importers keep resolving unchanged:
  //   - routes/settings.ts        → settings.updateSettings
  //   - middleware/error.ts       → import { FeatureCascadeError } from '../services/settings'
  //   - sdk barrel (cms.settings) → export * from '../services/settings'
  export { FeatureCascadeError, updateSettings, } from './features/cascade';
  export type { UpdateSettingsInput, } from './features/cascade';
  ```

  (Use `export type { UpdateSettingsInput }` — it is an interface, and the project compiles under `isolatedModules`/`verbatimModuleSyntax`-friendly settings; a type-only re-export is the safe form. If a value/type split isn't required by tsconfig, a single combined `export { FeatureCascadeError, updateSettings, type UpdateSettingsInput }` line is equivalent.)

- [ ] Confirm no other reference to the removed imports remains in `settings.ts`:
  ```bash
  grep -n "getPool\|validateEnable\|installFeatureStep" packages/api/src/services/settings.ts
  ```
  Expect: no matches (all three were only used by `updateSettings`).

- [ ] Build:
  ```bash
  pnpm --filter @sitesurge/server build
  ```
  Expect: clean, no duplicate-identifier errors, no unused-import errors.

- [ ] Full test run — all 108 tests green:
  ```bash
  pnpm --filter @sitesurge/server test
  ```
  Expect: 24 files, 108 tests passing (unchanged from baseline). Pay attention to `features/lifecycle.test.ts`, `features/registry.test.ts`, `services/featureUninstall.test.ts`, and `api/requireFeature.test.ts` — none import `updateSettings` directly, but they exercise the same registry/lifecycle graph.

- [ ] Commit (Task 1 + Task 2 together):
  ```
  refactor(api): split feature-cascade out of settings service

  - move updateSettings + UpdateSettingsInput + FeatureCascadeError to
    services/features/cascade.ts; settings.ts re-exports for back-compat.
  - cascade.ts imports ValidationError from core/errors (not middleware)
    to avoid a middleware→settings→cascade cycle.
  - no behavior change: same SQL, txn flow, 409 body, export surface.
  ```

### Task 3 — Verify import graph + consumer resolution (no code change)

**Files**
- Read-only verification across `packages/api/src`.

**Steps**
- [ ] Confirm the middleware still resolves `FeatureCascadeError` and its `instanceof`/409 mapping is intact:
  ```bash
  grep -n "FeatureCascadeError" packages/api/src/middleware/error.ts
  ```
  Expect: unchanged — `import { FeatureCascadeError, } from '../services/settings';`, `err instanceof FeatureCascadeError` (status 409), and `res.status(409).json({ success: false, error: err.result })`.

- [ ] Confirm the route handler still calls through:
  ```bash
  grep -n "updateSettings\|uninstallFeature" packages/api/src/routes/settings.ts
  ```
  Expect: `settings.updateSettings(body, audit())` and `settings.uninstallFeature(...)` unchanged.

- [ ] Confirm the SDK barrel still surfaces `cms.settings.*`:
  ```bash
  cat packages/api/src/sdk/settings.ts   # export * from '../services/settings'
  grep -n "settings" packages/api/src/sdk/index.ts
  ```
  Expect: unchanged; `export *` re-surfaces the re-exported `updateSettings` / `FeatureCascadeError` / `UpdateSettingsInput`.

- [ ] Sanity check no new circular import was introduced (cascade must NOT import from `settings` or `middleware/error`):
  ```bash
  grep -n "services/settings\|middleware/error" packages/api/src/services/features/cascade.ts
  ```
  Expect: **no matches** (cascade imports `ValidationError` from `../../core/errors`, everything else from `db`/`cache`/`audit`/`features/*`/`utils`).

- [ ] Final regression gate (build + test again from a clean state):
  ```bash
  pnpm --filter @sitesurge/server build && pnpm --filter @sitesurge/server test
  ```
  Expect: clean build, 108/108 tests green.

- [ ] No separate commit needed (verification only). If any grep surprised you, stop and reconcile before declaring done.

---

## Risks & Rollback

**Advisory-lock / transaction semantics.** The `pg_advisory_xact_lock` is acquired **inside** `installFeatureStep` → `applyFeatureMigrations` (`features/migrations.ts:52`), not in `updateSettings`. Because the whole function body (the `getPool()` → `BEGIN` → per-step `installFeatureStep` → `COMMIT`/`ROLLBACK`/`release`) moves verbatim into `cascade.ts` with the same call to the same `installFeatureStep`, the lock is still taken on the same transactional `client` at the same point. **Risk:** an accidental reformat that changes `client` scoping or drops the `finally { client.release() }`. **Mitigation:** copy the body character-for-character; the grep in Task 2 confirms no stray edits. **Rollback:** `git revert` the single Task 1+2 commit restores the monolithic `settings.ts`.

**409 body must stay byte-identical.** The body is produced entirely in `middleware/error.ts` from `err.result` (the planner `ValidationResult`), and `err` is a `FeatureCascadeError` thrown by `updateSettings` when `!result.ok`. Since (a) `FeatureCascadeError` is the *same class object* (re-exported, not redefined), (b) `result` comes from the unchanged `validateEnable`, and (c) `middleware/error.ts` is untouched, the 409 `{ success: false, error: <result> }` shape is provably unchanged. **Risk:** redefining `FeatureCascadeError` in `settings.ts` *and* `cascade.ts` would create two distinct classes → `instanceof` in middleware fails → 409 becomes a generic 500. **Mitigation:** Task 2 DELETES the class from `settings.ts` and only re-exports it; the "no duplicate identifier" build check catches a double-definition.

**Circular imports (settings ↔ cascade ↔ registry).** `cascade` imports from `features/registry`, `features/validator`, `features/lifecycle`, `db`, `cache`, `audit`, `utils`, and `core/errors` — none of which import `cascade` or `settings`. `settings` imports `cascade` (one direction). `middleware/error` imports `settings` (one direction). The only pre-existing cycle (`middleware/error → settings → middleware/error`, via `settings` importing `ValidationError` from middleware) is **untouched and already working** under ES-module hoisting. Deliberately importing `ValidationError` into `cascade` from `core/errors` (not middleware) avoids extending that cycle through the new file. **Mitigation:** Task 3 greps `cascade.ts` for `services/settings`/`middleware/error` and expects zero matches.

**Unused-import build failure.** After removing `updateSettings`, the imports `getPool`, `validateEnable`, `installFeatureStep` are dead in `settings.ts`; oxlint/tsc may flag them. **Mitigation:** Task 2 explicitly deletes exactly those three imports and keeps `FEATURE_REGISTRY`/`featureSettingKey`/`FeatureKey`/`ValidationError`/`uuidOrNull` which are still referenced by `isFeatureEnabledServer` / `computePublicFeatures` / `setRawKey`.

**Rollback plan.** Single commit → `git revert <sha>` (or `git reset --hard HEAD~1` pre-push) fully restores prior state. No DB migration, no data, no config touched, so rollback is code-only and instantaneous.

## Self-review checklist

- [ ] `services/features/cascade.ts` exists and exports exactly `updateSettings`, `UpdateSettingsInput`, `FeatureCascadeError` (plus nothing else).
- [ ] The `updateSettings` body in `cascade.ts` is character-identical to the original settings.ts:309–436 (same `settingsMap`, same planner block, same `BEGIN`/`installFeatureStep`/`COMMIT`/`ROLLBACK`/`release`, same two `logAudit` calls, same final `invalidateSettingsCache`).
- [ ] `FeatureCascadeError` is defined in **one** place (cascade.ts) and re-exported from settings.ts — no duplicate class definition.
- [ ] `settings.ts` no longer imports `getPool`, `validateEnable`, or `installFeatureStep`; still imports `FEATURE_REGISTRY`/`featureSettingKey`/`FeatureKey`/`ValidationError`/`uuidOrNull`.
- [ ] `settings.ts` re-exports `FeatureCascadeError`, `updateSettings`, `UpdateSettingsInput` from `./features/cascade`.
- [ ] `middleware/error.ts` is **unmodified** and still imports `FeatureCascadeError` from `../services/settings`.
- [ ] `routes/settings.ts` and `sdk/settings.ts` are **unmodified**.
- [ ] `cascade.ts` imports `ValidationError` from `../../core/errors`, NOT from `../../middleware/error`; contains no import of `services/settings`.
- [ ] `pnpm --filter @sitesurge/server build` is clean (no duplicate-identifier, no unused-import).
- [ ] `pnpm --filter @sitesurge/server test` reports 108/108 green across 24 files.
- [ ] The `PUT /settings` feature-cascade rejection still returns HTTP 409 with body `{ success: false, error: <planner result> }` (verified by unchanged middleware + unchanged planner).
