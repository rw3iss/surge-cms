# Monorepo Restructure + Full DTO Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure into a `packages/` monorepo (`api`, `cms`, `shared`, `cms-client`) with all configuration in `./config`; audit the API for client-missing functionality; give every module strongly-typed request/response DTOs in `@rw/cms-shared`; scaffold (NOT implement) `@rw/cms-client`; sync all docs.

**Spec:** `docs/superpowers/specs/2026-06-07-monorepo-dto-design.md` (decisions: package names @rw/cms-api / @rw/cms-web / @rw/cms-shared / @rw/cms-client; root ./config with per-pkg subdirs; pre-flight SCSS commit; restructure→DTOs order).

**Survey findings (2026-06-07, plan-time ground truth):**
- Root: `docker-compose.yml`, `Dockerfile`, `dprint.json`, `rw.ryanweiss.net.nginx.conf`, `.oxlintrc.json`, `.editorconfig`, `.dockerignore`, `.github/`, `pnpm-workspace.yaml` (+BOTH lockfiles — npm AND pnpm declarations must be updated), `scripts/{deploy.sh,pre-push-check.sh}`, root `config/` dir EXISTS and is EMPTY, `_info.md`/`TODO-plan.md` (leave).
- Root package.json scripts use `--workspace=frontend|backend` and `lint` hardcodes `frontend/src backend/src shared/src`; `prepare` symlinks `scripts/pre-push-check.sh` into `.git/hooks`.
- Per-package configs: backend{tsconfig,vitest.config.ts}, frontend{tsconfig,vite.config.ts}, shared{tsconfig}.
- Backend runtime path: SSR serves `<repo>/frontend/dist` (resolved in src — find exact resolution in T1).

**Conventions (unchanged from prior phases):** trailing commas (not after rest params), 4-space indent; suite baseline 45 tests; path-scoped commits; no Co-Authored-By; main branch direct.

**MOVE-PHASE RULE:** during T2-T6 the working tree must be CLEAN before each task (T0 guarantees the start). Every task ends with: `npm install` (refresh workspace links when package.json moved/renamed), `npm run build` (all workspaces), `npm test -w <api-pkg> -- --run` (45), and for frontend-affecting steps `npx tsc -p <cms tsconfig> --noEmit`. Use `git mv` for ALL moves.

---

### Task T0: Pre-flight commits

- [ ] Commit the styling pass: `git add` the 18 modified .scss files + `frontend/src/styles/variables.scss` + `global.scss` (exact set = everything `git status --short` shows as ` M` under frontend/) → `style: token sweep + mobile responsiveness from improvement audit`.
- [ ] Commit the untracked docs: `docs/improvement-audit-2026-05-17.md`, `avr_livestream.md` → `docs: improvement audit + livestream architecture notes`.
- [ ] `git status --short` → EMPTY. Verify suite still 45.

### Task T1: Path-reference survey (read-only, produces the fix-list)

- [ ] Grep for every cross-package / root-relative path that the moves will break. Minimum targets: `grep -rn "frontend\|backend\|shared" --include='*.ts' --include='*.json' --include='*.sh' --include='*.yml' --include='*.yaml' backend/src backend/scripts frontend/vite.config.ts scripts/ .github/ docker-compose.yml Dockerfile package.json pnpm-workspace.yaml .oxlintrc.json dprint.json` (filter false positives like the word "shared" in comments). Read `scripts/deploy.sh` + `scripts/pre-push-check.sh` + `.github/workflows/*` in full.
- [ ] Locate the SSR dist resolution in backend src (search `frontend/dist` / `dist` path joins), the docs generator paths, migrations/seed cwd assumptions, multer upload dirs, data dir.
- [ ] Output: a checklist file at `docs/superpowers/plans/2026-06-07-move-fixlist.md` enumerating every file:line → required new value. Commit it (`docs: path-reference fix-list for monorepo move`).

### Task T2: Move shared → packages/shared (@rw/cms-shared)

- [ ] `mkdir -p packages && git mv shared packages/shared`.
- [ ] packages/shared/package.json: name → `@rw/cms-shared`.
- [ ] Root package.json: workspaces → `["packages/shared", "frontend", "backend"]` (transitional); pnpm-workspace.yaml packages list likewise.
- [ ] backend/package.json + frontend/package.json deps: `"@rw/shared": "file:../shared"` → `"@rw/cms-shared": "file:../packages/shared"`.
- [ ] Import sweep: `grep -rl "@rw/shared" backend frontend packages/shared | xargs sed -i "s|@rw/shared|@rw/cms-shared|g"` then verify zero hits remain repo-wide (incl. docs? code only — docs in T8).
- [ ] `npm install` → relinks. Full builds + tests + frontend tsc. Commit: `refactor: shared → packages/shared as @rw/cms-shared`.

### Task T3: Move backend → packages/api (@rw/cms-api) AND frontend → packages/cms (@rw/cms-web) — ONE commit (they cross-reference)

- [ ] `git mv backend packages/api && git mv frontend packages/cms`.
- [ ] package.json names: `@rw/cms-api`, `@rw/cms-web`. file: dep paths inside them: `file:../shared` (now siblings under packages/ — verify relative correctness).
- [ ] Root package.json workspaces → `["packages/*"]`; ALL root scripts to `-w packages/api` / `-w packages/cms` style (or `--workspace=@rw/cms-api` — pick folder-path form for grep-ability); lint paths → `packages/*/src`; pnpm-workspace.yaml → `packages/*`.
- [ ] Apply the T1 fix-list: SSR dist path → `packages/cms/dist`; deploy.sh; pre-push-check.sh; .github workflows; docker-compose.yml volumes/contexts; Dockerfile COPY paths; vite proxy target untouched (localhost:3001); docs generator; any data/upload dirs.
- [ ] `npm install`; full builds + tests + tsc; `npm run docs:api` regenerates (commit the timestamp churn or discard — REGENERATE in T6 instead, discard here). Commit: `refactor: backend → packages/api (@rw/cms-api), frontend → packages/cms (@rw/cms-web)`.

### Task T4: Config relocation → ./config

- [ ] Per-package: `git mv packages/api/tsconfig.json config/api/tsconfig.json` (adjust its relative `include`/`outDir`/paths for the new location — tsconfig paths are relative to the FILE), leave a stub `packages/api/tsconfig.json` = `{ "extends": "../../config/api/tsconfig.json" }`; same for vitest.config.ts (script flag `vitest --config ../../config/api/vitest.config.ts` — note vitest `root` option may be needed), cms tsconfig + vite.config.ts (`vite --config ../../config/cms/vite.config.ts`; vite config `root`/`envDir` must be set to the package dir), shared tsconfig.
- [ ] Root movables → config/: `rw.ryanweiss.net.nginx.conf`, `dprint.json` (script: `dprint fmt --config config/dprint.json`), `.oxlintrc.json` (oxlint `-c config/.oxlintrc.json`), `Dockerfile` + `docker-compose.yml` (compose `-f config/docker-compose.yml` in scripts; FIX internal context/paths: context becomes repo root `..` relative to the file — verify compose/docker build still resolve; update deploy.sh accordingly).
- [ ] DOCUMENTED EXCEPTIONS stay put: `.editorconfig` (editor walk-up discovery), `.dockerignore` (must sit at build context root), `pnpm-workspace.yaml` + lockfiles (tool-required root), `.github/` (GitHub-required path), `packages/api/.env` + `.env.example` (dotenv default + secrets), package-root tsconfig stubs, `packages/cms/index.html` (app entry, not config).
- [ ] Full verification incl. `npm run lint`, `npm run format:check`, a vitest run via the new flag, vite build via the new flag. Commit: `refactor: all configuration centralized in ./config (per-package subdirs + repo-wide)`.

### Task T5: cms-client skeleton

- [ ] `packages/cms-client/`: package.json (`@rw/cms-client`, `"@rw/cms-shared": "file:../shared"`, scripts build/test stubs), tsconfig stub → `config/cms-client/tsconfig.json`, `src/index.ts` (exports nothing yet; header comment = goal statement), `src/core/.gitkeep` + `src/modules/.gitkeep` (or placeholder ts files matching the charter layout), `README.md` (goal: the headless client for ANY hosted CMS backend incl. our own cms web package; points to docs/client-sdk-plan.md; NOT IMPLEMENTED banner).
- [ ] Root workspaces already `packages/*` — `npm install`, builds green (empty package builds). Commit: `feat: scaffold @rw/cms-client package (structure + charter pointer, no implementation)`.

### Task T6: Post-move verification + regen

- [ ] Side-port smoke boot (PORT=3101 .env dance, backup/restore): health, posts list, feed.xml, settings/public, an admin 401 — proves runtime paths (SSR dist, data dir, migrations) survived.
- [ ] `npm run docs:api` → regenerate; commit `docs: regenerate API reference post-restructure` (paths inside generator output shouldn't change — verify).

### Task T7: API gap fixes + full DTO sweep (batched like Phase 3)

- [ ] **T7a — gap audit + fixes:** cross-reference every frontend `api.<verb>(` call against docs/api-manifest.json; known gaps: `DELETE /users/:id` missing (ADD the route+service method per users-module pattern, admin tier, audit-logged); `PUT /connections/:provider/reorder` dead (DECIDE: if social_connections has an order/sort column implement it, else REMOVE the frontend call + its UI affordance — report choice). Fix anything else found or list as explicitly-deferred. Commit(s) per fix.
- [ ] **T7b-T7f — DTO batches** (mirror Phase-3 batches; per module: create `packages/shared/src/api/routes/<module>.ts` with request DTOs (Params/Query/Body per endpoint) + response DTOs, reusing entity types from `shared/src/types/` — REFERENCE never duplicate; add to the api barrel; bind the backend (zod `satisfies z.ZodType<X>` where clean, else type the handler ctx/return); builds+tests green; one commit per batch):
  - T7b: posts (complete the existing file), apiKeys, blockStyles, fonts, dev, health, dashboard, audit, search, setup
  - T7c: messages, users, campaigns, social, forms, pages
  - T7d: auth (AuthResponse exists in shared — reuse), connections
  - T7e: settings (incl. the 409 cascade result type), feed/sitemap/unsubscribe (raw — minimal marker types), media, payments (donate/subscribe/plans/webhook-excluded)
  - T7f: mailingLists, mailTemplates, mailSend
- [ ] **T7g — shared-utility hoist:** survey api+cms packages for duplicated logic (candidate greps: pagination param building, error-code switching, date/slug/url helpers, the `isAdminRole`-style role predicates the frontend may duplicate); hoist GENUINE duplicates into `packages/shared/src/utils/<topic>.ts`; update both consumers. No speculative hoisting. Commit.
- [ ] **T7h:** `npm run docs:api` regen; verify manifest stable; commit if changed.

### Task T8: Documentation

- [ ] README: package table (folder ↔ npm name ↔ purpose), ./config convention + stub gotcha + exceptions list, updated commands, cmsClient doctrine (ALL client-side requests via @rw/cms-client once built, incl. our own cms package; direct api calls interim), docs:api.
- [ ] CLAUDE.md: new tree, paths, commands, gotchas (config stubs, .env exception, @rw/cms-shared import scope, lint/format config flags), DTO convention + "every module has request/response DTOs in shared/src/api/routes/".
- [ ] docs/client-sdk-plan.md: paths → packages/*; DTO-prerequisite section marked COMPLETE; skeleton location noted.
- [ ] Commit: `docs: monorepo structure, config conventions, DTO coverage, cms-client doctrine`.

### Task T9: Final whole-restructure review

- [ ] Final reviewer over the full range: builds/tests/lint/format/docs:api all green from a CLEAN CHECKOUT simulation (`git stash -u` nothing to stash; optionally `git clean -ndx` review), no forbidden file accidents, git history preserved (spot `git log --follow packages/api/src/index.ts`), docs accuracy, DTO coverage census (28 modules ↔ 28 route-DTO files), residual-risk list.

## Self-review notes
- npm+pnpm dual workspace declarations both updated (T2/T3).
- Cross-referencing backend↔frontend moved in ONE commit (T3) to avoid broken intermediate states.
- tsconfig relative-path gotcha (paths resolve from the FILE) called out in T4.
- vite/vitest root/envDir gotchas called out in T4.
- .env stays at packages/api root (spec exception).
