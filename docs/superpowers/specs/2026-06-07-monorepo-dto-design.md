# Monorepo Restructure + Full DTO Coverage + cms-client Scaffold — Design

Date: 2026-06-07
Status: Approved

## Goal

Prepare the codebase for the headless CMS client: (1) restructure into a
`packages/` monorepo with all configuration centralized in `./config`;
(2) audit the backend API for client-missing functionality and give EVERY
module strongly-typed request/response DTOs in the shared package (DRY —
one definition serving backend, web app, and the future client);
(3) scaffold `packages/cms-client` (structure + goal statement only — the
implementation is the next project); (4) update README/CLAUDE.md.

## Decisions (settled with the user)

1. **Package names:** `packages/api` = `@rw/cms-api` (was backend),
   `packages/cms` = `@rw/cms-web` (was frontend), `packages/shared` =
   `@rw/cms-shared` (was @rw/shared), `packages/cms-client` =
   `@rw/cms-client` (new). The `@rw` scope persists until the future
   SiteSurge rename.
2. **Config layout:** root `./config` with per-package subdirs
   (`config/api/`, `config/cms/`, `config/shared/`, `config/cms-client/`);
   repo-wide configs (docker/nginx/etc, if present) at `./config` root.
   Thin extend-stubs stay at package roots where tooling requires
   auto-discovery (tsconfig.json); vite/vitest get explicit `--config`
   flags in scripts.
3. **Pre-flight:** commit the long-pending styling-pass SCSS changes and
   the two untracked docs BEFORE any moving (clean tree → clean `git mv`).
4. **Sequence:** restructure first, then the DTO/audit sweep (type files
   land in final paths; cms-client skeleton exists to receive them).

## Workstream 0 — pre-flight commits

- `style: token sweep + mobile responsiveness from improvement audit`
  (the 18 modified .scss files + variables.scss/global.scss).
- `docs: improvement audit + livestream architecture notes`
  (docs/improvement-audit-2026-05-17.md, avr_livestream.md).

## Workstream 1 — monorepo restructure

```
rw-cms/
├── config/
│   ├── api/            # tsconfig.json, vitest.config.ts (from backend/)
│   ├── cms/            # tsconfig.json, vite.config.ts (from frontend/)
│   ├── shared/         # tsconfig.json
│   ├── cms-client/     # tsconfig.json (new)
│   └── (repo-wide)     # anything found by the config survey
├── packages/
│   ├── api/            # git mv backend
│   ├── cms/            # git mv frontend
│   ├── shared/         # git mv shared
│   └── cms-client/     # NEW skeleton
├── docs/
└── package.json        # workspaces: ["packages/*"]
```

- All moves via `git mv` (history preserved). One commit per logical step
  so any breakage bisects cleanly.
- **Import sweep:** `@rw/shared` → `@rw/cms-shared` everywhere (sed +
  full builds). package.json `file:` deps updated
  (`"@rw/cms-shared": "file:../shared"`).
- **Scripts:** root scripts use `-w packages/<name>`; package scripts gain
  `--config`/`-p` flags pointing into `../../config/<pkg>/`.
- **Deliberate exceptions** (stay at package roots): `packages/api/.env` +
  `.env.example` (dotenv default resolution + gitignored secrets);
  tsconfig.json extend-stubs; `index.html` (not config).
- **Hardcoded cross-package paths swept:** the API's SSR dist path
  (`frontend/dist` → `packages/cms/dist`), data dir, migrations runner,
  scripts/, docs generator, anything else a survey grep finds
  (`grep -rn 'frontend\|backend\|\.\./shared' --include='*.ts' …`).
- **cms-client skeleton:** package.json (`@rw/cms-client`, dep on
  `@rw/cms-shared`), tsconfig stub, `src/index.ts` placeholder,
  `src/core/` + `src/modules/` dirs (matching the charter layout in
  docs/client-sdk-plan.md), README with the goal statement. NO
  implementation.
- **Verification gates after each step:** all four builds, backend test
  suite (45), `npm run docs:api`, frontend tsc.

## Workstream 2 — API audit + DTO sweep

- **Functionality audit:** walk all 28 modules from the client's
  perspective; fix REAL gaps. Known on file: frontend calls
  `DELETE /users/:id` (route missing — add it per the users-module
  pattern) and `PUT /connections/:provider/reorder` (dead frontend path —
  decide: implement or remove the frontend call). The audit may surface
  more; each gets fixed or explicitly deferred with a note.
- **DTOs:** `packages/shared/src/api/routes/<module>.ts` for each of the
  28 manifest modules. Per endpoint: request types (Params/Query/Body)
  and response types. Naming convention:
  `<Entity><Action>Request` / `<Entity><Action>Response` or
  module-prefixed Query/Body types (follow posts.ts precedent). Derived
  from the backend zod schemas (request) and service return shapes
  (response); entity types reused from `shared/src/types/` — DTOs
  reference them, never duplicate fields.
- **Backend binding:** route zod schemas and/or handlers typed against
  the DTOs (e.g. `satisfies z.ZodType<XQuery>` where practical) so DTO
  drift is a compile error. Where exact zod↔TS equivalence is awkward
  (coercions), bind the HANDLER ctx/return instead — pragmatic, reported
  per module.
- **Shared-utility hoist:** survey for logic duplicated between api and
  cms packages; hoist genuine duplicates into `@rw/cms-shared` utils
  (organized by function). No speculative hoisting.
- Regenerate docs/API.md + api-manifest.json at the end.

## Workstream 3 — documentation

- README: four-package table, ./config convention + stub gotcha, dev
  commands, docs:api, and the cmsClient doctrine: ALL client-side
  requests go through `@rw/cms-client` once built — including our own
  `cms` web package; direct `api.get()` calls are the interim pattern.
- CLAUDE.md: new structure, paths, gotchas (config stubs, .env exception,
  import scope rename), updated commands.
- docs/client-sdk-plan.md: paths updated to packages/*; note that DTO
  prerequisite is now COMPLETE (after workstream 2).

## Out of scope (YAGNI)

- No cms-client implementation (next project).
- No SiteSurge rename (future cut).
- No splitting packages into separate repos.
- No new tooling (oxlint etc.) — relocate only what exists.

## Risks / mitigations

- **Blast radius of the move:** step-wise commits, full build+test gate
  after every step, git mv for history.
- **Hidden hardcoded paths:** dedicated survey task before moving; smoke
  boot after.
- **dotenv/config resolution:** .env exception documented; config loader
  untouched.
- **DTO drift:** backend binding makes drift a compile error; docs:api
  regen confirms manifest stability.
