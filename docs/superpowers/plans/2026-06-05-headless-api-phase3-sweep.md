# Headless API Phase 3 (Module Sweep) + Phase 4 (Docs/Manifest) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert every remaining route module (25 files) to the defineRoute manifest framework with services owning all business logic; delete the legacy response/bulk helpers; then generate `docs/API.md` + `docs/api-manifest.json` from the live manifest, write the README "Headless Mode" section, and author the client-SDK charter document. NO client SDK implementation (explicitly deferred — charter doc only).

**Architecture:** Same as Phases 1-2. Reference implementations: `backend/src/routes/posts.ts` (full pattern incl. merged optional-auth list) and `backend/src/routes/apiKeys.ts` (small admin module). Framework: `backend/src/api/` (defineRoute, registry, apiKeyAuth, roles). Canonical service layer: `backend/src/services/<module>.ts` (old `sdk/` modules become shims as they migrate, `cms.*` aggregate kept).

**Tech Stack:** Express 4, zod, pg, vitest+supertest, SolidJS frontend.

**Specs/Plans:** spec `docs/superpowers/specs/2026-06-04-headless-api-design.md`; Phase 1 plan `2026-06-04-headless-api-foundation.md`; Phase 2 plan `2026-06-04-headless-api-phase2-api-keys.md`. Survey dossiers below are the per-module source of truth.

**Conventions (unchanged):** trailing commas (`fn(arg,)`, NOT after rest params), 4-space indent; builds `npm run build -w shared|backend|frontend`; tests `npm test -w backend -- --run` (40 pass at plan time); path-scoped commits ONLY (unrelated .scss/docs changes live in the working tree — `git status --short` before every commit); no Co-Authored-By; commits direct to `main` (user-approved).

---

## THE CONVERSION RECIPE (apply to every module)

Each module conversion follows the posts template. Per module:

1. **Service**: ensure `backend/src/services/<module>.ts` holds ALL business logic (SQL via repositories where they exist, cache read/invalidate, sanitization, audit via `AuditContext`, side-effects). If `backend/src/sdk/<module>.ts` exists, move it to services (verbatim + absorb route logic) and leave a one-line shim (`export * from '../services/<module>';`) — exactly like posts. If no sdk module exists, create the service fresh by extracting the route file's logic. Repositories stay beneath services; routes with inline SQL move that SQL into the existing repo file or the service (match what the module already does — do NOT invent new repo files unless the module already has one).
2. **Routes**: rewrite `backend/src/routes/<module>.ts` as `export const <module>Routes = [ defineRoute(...), ... ]`. Zod schemas at top (move existing ones verbatim). Literal paths before `/:id` catch-alls. Handlers: parse → service call → return data or `reply(data, { meta, status })`. NO res.json, NO try/catch, NO handleRouteError, NO sendSuccess/sendCreated/sendPaginated, NO direct repo/cache/audit imports in the route file.
3. **Auth tiers**: `public` (no auth), `optional` (authenticate(false) equivalents — response shaped by role), `user` (authenticate()), `admin` (authenticate()+requireAdmin equivalents). The framework's admin/apiKey tiers accept scoped `ssk_` keys; optional tier accepts keys as machine clients.
4. **THE TWO SACRED PATTERNS** (from Phase 2's security review — copy wherever they apply):
   - **Key-as-admin shaping**: any handler that branches on admin-ness must use `const isAdmin = isAdminRole(user?.role,) || Boolean(apiKey,);` (import `isAdminRole` from `../api/roles`; destructure `apiKey` from ctx).
   - **Cache-poisoning guard**: any service function that caches list/detail data AND can return admin-shaped results must gate cache read AND write on `const cacheable = anonymous && !isAdmin;` where `anonymous = !user && !apiKey` at the route layer. Public-only data (e.g. published-only queries with no admin bypass) may cache unconditionally for anonymous readers — match posts' `getPublicBySlug` (published-only → safe).
5. **Path normalization**: `/public`-suffixed list endpoints merge into `GET /` with `optional` auth (posts pattern: anon → public gate; admins/keys passing an explicit admin signal like `status`/`sort` or equivalent get the admin view; if a module's admin list and public list have incompatible shapes, KEEP both but rename `/public` → the bare list and move the admin list under an explicit param — document the choice in the commit). Other obvious inconsistencies normalize; do not rename gratuitously.
6. **Raw escape hatch**: `raw: true` handlers (write to `ctx.res` themselves, MUST end the response) for: redirects (OAuth callbacks, unsubscribe HTML), XML (feed, sitemap), CSV export (forms), Stripe webhook, anything streaming. They still declare auth + summary for the manifest.
7. **Per-route middleware**: where a route needs multer/rate-limiters, use the `pre` field (added in Task B1): `pre: [upload.single('file'),]` runs after auth middlewares, before the wrapped handler.
8. **Frontend**: update every call site whose path/shape changed IN THE SAME COMMIT as the module (grep `frontend/src` for the module's paths; the dossiers list known call-site counts). Run `npm run build -w frontend` AND `npx tsc -p frontend --noEmit` when frontend files change.
9. **Mount**: `routes/index.ts` switches the module to `registerModule('<module>', <module>Routes,)`. Modules mounted OUTSIDE /api/v1 (feed, sitemap, unsubscribe — app.ts) use `registerModule` with the basePath option (added in Task B4) and app.ts mounts the returned router at the same external paths as today.
10. **Verify per module**: `npm run build -w backend && npm test -w backend -- --run` green. **One commit per module** (`feat(backend): <module> on manifest framework` + frontend changes in same commit when applicable). Behavior preservation is the default; only the documented normalizations change the wire contract.

**Legacy helpers**: keep `handleRouteError`/`sendSuccess`/etc. compiling until Task B6 deletes them (after the last caller converts).

---

## Survey dossiers (per-module source of truth)

(Condensed from the 2026-06-05 survey; line counts approximate. "svc ✓" = sdk module exists to evolve.)

| Module | Lines | Endpoints | Notes |
|---|---|---|---|
| blockStyles | 126 | 5 admin | svc ✓; cache `block_styles:all` 600s (admin-only data — cache is fine as-is, not public) |
| dashboard | 102 | 1 admin | parallel stat queries → new small service |
| dev | 32 | 2 admin | trivial |
| fonts | 82 | 3 mixed | svc ✓; POST / is multer single-file (needs `pre`) |
| health | 84 | 4 public | trivial; no caching |
| setup | 116 | 7 gated | setup-gate logic stays (`ensureSetupAllowed` becomes service-level checks inside handlers or a `pre` middleware); `/install` triggers process restart — raw-ish but returns JSON first; keep semantics exactly |
| audit | 93 | 1 admin | paginated list w/ filters |
| search | 267 | 1 public | full-text multi-type search → service |
| messages | 158 | 6 mixed | svc ✓; POST / public contact form (sanitize + email side-effect); bulk |
| campaigns | 210 | 11 mixed | svc ✓; `/public` + `/slug/:slug` cached 300s → SACRED PATTERNS apply if admin shapes exist; bulk |
| forms | 483 | 13 mixed | no svc; `/public` cached; CSV export raw; duplicate-submission check; bulk |
| pages | 370 | 16 mixed | svc ✓; navigation/homepage cached; access control like posts slug; revisions (posts pattern); block CRUD + reorder; bulk |
| social | 299 | 6 mixed | no svc; platform feeds cached 600s; sync side-effects |
| users | 291 | 9 admin | svc ✓ (sdk/users); avatar multer upload (needs `pre`); bans |
| mailingLists | 296 | 12+1 | no svc; DUAL MOUNT: admin at /mailing-lists + public subscribe at /lists (`publicMailingListsRouter`) — convert both arrays, keep both mounts via registerModule('mailing-lists', …) and registerModule('lists', …) |
| mailTemplates | 187 | 8 admin | no svc; block tree ops; preview render |
| mailSend | 224 | 5 admin | no svc; job creation + worker kick; PATCH cancel |
| auth | 342 | 9 mixed | no svc (services/auth.ts EXISTS for JWT/session logic — routes call it); OAuth callback redirect → raw; cookie set/clear stays in route handlers via ctx.res (raw) or non-raw handlers that ALSO set cookies before returning (allowed — wrap only shapes the body; res.cookie before return is fine); loginLimiter → `pre` |
| connections | 384 | 8 admin+1 public | no svc; OAuth authorize/callback (redirects → raw); Redis OAuth state; cron register side-effects; credential masking |
| settings | 914 | 7 mixed | svc ✓ (sdk/settings + swatches); `/public` cached 600s; feature dependency planner + lazy migrations — move orchestration into a service carefully, behavior identical |
| media | 460 | 7 admin | no svc; multer disk staging (needs `pre`), sharp thumbnails, storage provider, temp cleanup |
| payments | 1045 | 14 mixed | no svc (services/payment/ exists — provider layer); Stripe webhook raw-body+signature (app.ts:93 raw middleware — preserve EXACTLY; webhook route stays raw:true); donations/subscriptions/plans |
| feed | 170 | 1 public | RSS XML raw, cached 1800s; mounted at /feed.xml AND /api/v1/feed.xml (app.ts) |
| sitemap | 66 | 2 | XML raw cached 3600s + admin regenerate; dual mount like feed |
| unsubscribe | 92 | 3 public | HTML raw responses; mounted at site root (/u/:token, /lists/:slug/confirm/:token) via app.ts |

Legacy-helper callers at plan time: `handleBulkAction` (campaigns, forms, pages, messages), `handleRouteError` (~18 files), `send*` helpers (most files).

---

### Task B1: Framework `pre` middleware + Batch 1 (trivial modules)

**Modules:** blockStyles, dashboard, dev, fonts, health, setup, audit, search (8 modules, ~900 lines)

- [ ] **Step 1: Add `pre` to the framework.** `backend/src/api/types.ts` RouteDef gains `/** middlewares (multer, rate limiters) running after auth, before the handler. */ pre?: import('express').RequestHandler[];` (style-appropriate type import). `defineRoute` passes it through. `registry.ts` `buildRouter`: `router[def.method](def.path, ...authMiddlewaresFor(def.auth,), ...(def.pre ?? []), wrap(def,),);` Add one registry test: a public route with a `pre` middleware that sets `res.locals.x` / mutates req, assert handler observed it and ordering held.
- [ ] **Step 2-9: Convert each module per THE RECIPE** (one commit each, order: dev → health → dashboard → audit → search → blockStyles → fonts → setup). Notes: fonts POST uses `pre: [upload.single('font'),]` — read the existing multer setup and move it next to the route schemas; setup keeps its gate semantics (convert `ensureSetupAllowed` into the handlers or a shared `pre`); blockStyles cache stays admin-side (no public exposure — no poisoning risk, note in code).
- [ ] **Step 10: Verify batch:** builds + full test suite green; `git log --oneline` shows one commit per module.

### Task B2: Batch 2 — content & engagement (pages, campaigns, forms, messages, social, users)

**Modules:** pages, campaigns, forms, messages, social, users (6 modules, ~1,800 lines)

- [ ] Convert per THE RECIPE, one commit each, order: messages → users → campaigns → social → forms → pages.
- [ ] **Pages** mirrors posts most closely (revisions, access gating, blocks, bulk, cached navigation/homepage): evolve `sdk/pages.ts` → `services/pages.ts`; slug access-gating becomes CONTENT_LOCKED AppError (same as posts — update the frontend DynamicPage locked handling in the same commit; grep `frontend/src/pages/DynamicPage.tsx:47` `.locked`).
- [ ] **Campaigns/forms** `/public` lists merge into optional-auth `GET /` per posts pattern (frontend `fetchCampaigns` api.ts:245 `/campaigns/public` and forms call sites update in-commit). Apply SACRED PATTERNS to their caches.
- [ ] **Users**: avatar upload via `pre`; bans/role updates audit properly.
- [ ] **Bulk** routes call `performBulkAction` via their services (posts pattern).
- [ ] Per-module + batch verification as in B1. Frontend builds + tsc clean on every frontend-touching commit.

### Task B3: Batch 3 — auth & connections (OAuth, cookies)

**Modules:** auth, connections (2 modules, ~730 lines)

- [ ] Convert per THE RECIPE. OAuth callbacks = `raw: true` (explicit res.redirect). Login/refresh/logout handlers may set/clear cookies via `ctx.res.cookie/clearCookie` then RETURN the body (non-raw — the wrapper only shapes the body; verify with a test). `loginLimiter` → `pre`. Preserve EXACT cookie attributes, token flows, Patreon state handling, and the `/autologin` dev gate. connections: OAuth state via cache, cron register/unregister side-effects move into the service, credential masking preserved.
- [ ] Auth routes are SECURITY-CRITICAL: after conversion run the full test suite + add focused supertest cases if cheap (login happy-path needs DB — skip DB-bound tests; instead assert via existing middleware tests + manual smoke in Task B7).
- [ ] One commit per module; frontend auth call sites (stores/auth.tsx etc.) checked for shape changes (there should be NONE — envelope already matches).

### Task B4: Batch 4 — raw/XML + settings (feed, sitemap, unsubscribe, settings)

**Modules:** feed, sitemap, unsubscribe, settings (4 modules, ~1,250 lines)

- [ ] **Framework basePath:** `registerModule(module, defs, opts?: { basePath?: string })` records basePath in the manifest entry (default '/api/v1/<mount>' is NOT inferable — record what's passed; routes/index.ts passes nothing and the docs generator prefixes /api/v1/<mount> from a mapping — simplest correct approach: registerModule signature gains `{ mountPath: string }` REQUIRED, e.g. registerModule('posts', postsRoutes, { mountPath: '/api/v1/posts' }) — update ALL existing registerModule call sites in this task, manifest emits absolute paths, registry test updated).
- [ ] feed/sitemap/unsubscribe: raw XML/HTML handlers per dossiers; app.ts mounts the new routers at the SAME external paths as today (/feed.xml, /sitemap.xml, /u/…, plus the /api/v1 aliases). Caching for feed/sitemap is public-only data — cache freely.
- [ ] settings: evolve sdk/settings+swatches into services; the feature dependency planner + lazy-migration orchestration moves behind the service with IDENTICAL behavior (this is the riskiest pure-logic move of the sweep — preserve the `pg_advisory_xact_lock` flow verbatim; the Settings PUT handler stays thin). `/settings/public` cache is public-shaped only — verify no admin bypass exists, note in code.
- [ ] One commit per module + frontend updates in-commit.

### Task B5: Batch 5 — media & payments (uploads, Stripe)

**Modules:** media, payments (2 modules, ~1,500 lines)

- [ ] media: multer via `pre`, sharp thumbnails + storage provider + temp-cleanup logic into `services/media.ts`; signed-url endpoint preserved.
- [ ] payments: Stripe webhook stays `raw: true` with the app.ts raw-body mount preserved EXACTLY (signature verification breaks on any body mutation — verify app.ts:93 ordering still bypasses express.json for that path). Donations/subscriptions/plans logic into `services/payments.ts` (the provider layer in services/payment/ stays beneath it). Public `/plans` + optional `/donate` tiers per dossier.
- [ ] One commit per module; frontend call sites (DonationForm, Subscribe) verified.

### Task B6: Delete legacy helpers + shims sweep

- [ ] Confirm zero callers: `grep -rn 'handleRouteError\|handleBulkAction\|sendSuccess\|sendCreated\|sendPaginated\|sendError' backend/src --include='*.ts'` → only definitions remain. Delete `handleRouteError`/`sendSuccess`/`sendCreated`/`sendPaginated`/`sendError` from `utils/response.ts` (delete the file if empty) and the deprecated `handleBulkAction` wrapper from `utils/bulkActions.ts`. Fix any stragglers properly (convert, don't re-add helpers).
- [ ] sdk/ shims STAY (cms.* aggregate is the supported in-process SDK; update `backend/src/sdk/README.md` note: migration complete, sdk/ files re-export services permanently or fold cms aggregate import paths — choose minimal churn: keep shims, update the note to say the move is complete).
- [ ] Build + full suite green. Commit: `refactor(backend): remove legacy response/bulk helpers — manifest framework everywhere`.

### Task B7: Full-system smoke verification

- [ ] Side-port boot (PORT=3101 via .env edit + restore — backup first, diff-verify after; ports 3000/3001 may host another project). Re-run the Phase 1+2 smoke checks (posts list/validation/Bearer-CSRF; API-key scope checks with a DB-seeded key) PLUS: /api/v1/pages/navigation, /api/v1/settings/public, /api/v1/campaigns (list), /feed.xml + /sitemap.xml content-types, /api/v1/health/live, a contact-message POST, login → cookie + Bearer round-trip (`POST /api/v1/auth/login` with seeded admin creds if known; else verify 401 shape), forms public list. Verify the manifest: `node -e` or tsx snippet importing routes/index + printing `manifest()` — every module present with absolute paths.
- [ ] Teardown: kill server, restore .env byte-identical, delete any seeded smoke rows.

### Task B8: Phase 4 — docs generator + API.md + manifest.json

- [ ] **Generator:** `backend/scripts/generate-api-docs.ts` — imports the route index (triggering registerModule side-effects WITHOUT starting the server — ensure routes/index.ts has no top-level server/db side-effects; if importing it pulls db config eagerly, import lazily/mock-env as needed and document), calls `manifest()`, writes:
  - `docs/api-manifest.json` — `{ generatedAt, modules: [{ module, mountPath, routes: [{ method, path, absolutePath, auth, summary }] }] }`.
  - `docs/API.md` — human-readable: intro (auth tiers table, error envelope, ErrorCode list from @rw/shared, pagination meta, API-key usage), then one section per module with a method/path/auth/summary table.
- [ ] npm script `docs:api` in backend/package.json (`tsx scripts/generate-api-docs.ts`) + root convenience script. Run it; commit the generated files + generator.
- [ ] **README "Headless Mode" section:** auth flows (login → access/refresh tokens, Bearer usage, refresh), API keys (creation in Settings, `Authorization: Bearer ssk_…`, scopes), CORS_ORIGINS, error envelope + codes, link to docs/API.md, 3-4 curl examples (list posts, login, key-authed create). Update CLAUDE.md: sweep complete (drop "Converted so far: posts"), docs:api command, API.md/manifest paths.
- [ ] Commit docs.

### Task B9: Client-SDK charter document

- [ ] Write `docs/client-sdk-plan.md` — NOT an implementation, a charter for the next project: goals (typed TS client mirroring cms.* shape over HTTP), inputs (docs/api-manifest.json + @rw/shared types + ErrorCode/AuthTier), proposed package layout (@rw/cms-client or @sitesurge/sdk; fetch-based, zero deps), auth handling (Bearer JWT w/ refresh + API-key mode), generation strategy options (hand-rolled thin client vs manifest-driven codegen — manifest now carries enough for codegen of method/path/auth; input/output TYPES still need per-module DTO exports in shared/src/api/routes/<module>.ts, which only posts has → list this as the main prerequisite gap), error mapping (ApiError → typed exceptions switchable on ErrorCode), pagination conventions, the CONTENT_LOCKED details contract, browser+node compatibility notes, versioning policy suggestion, and any notes accumulated during the sweep (each batch implementer reports SDK-relevant observations; collect them here).
- [ ] Commit.

### Task B10: Final whole-sweep review

- [ ] Dispatch final reviewer over the full Phase 3+4 range: commit narrative, no forbidden files (.scss/improvement-audit/avr_livestream) in any commit, spec coverage, builds + suite, docs accuracy (API.md spot-check against live routes), residual risks list.

---

## Self-review notes

- The two sacred patterns are mandated in THE RECIPE step 4 and called out per-module in dossiers.
- Raw-mount modules (feed/sitemap/unsubscribe) keep external paths via app.ts; manifest gains mountPath so docs are accurate.
- settings' feature-planner move and payments' webhook raw-body are flagged as the two highest-risk preservation items.
- users.ts and audit.ts (missed by the original batch suggestion) are folded into B2/B1.
- Legacy helper deletion is gated on a zero-caller grep, not assumed.
