# SiteSurge — Packaging, Distribution & Initialization Design

Date: 2026-07-11
Status: **Approved — implementing** (Phases 1–3 done; Phase 4 next)
Author: architecture pass

### Locked decisions (2026-07-11)
- **Registry:** public npm under **`@sitesurge`**.
- **Positioning:** **turnkey-first** — keep the built-in public renderer as a
  first-class feature AND support headless.
- **Sequencing:** start with **Phase 1 (scope rename)**.
- **Phase 1 refinement:** do the **name/scope rename only** (`@rw/cms-*` →
  `@sitesurge/*` + imports + filters + docs). **Defer directory renames**
  (`packages/api`→`server`, etc.) to a later coordinated step — those also touch
  the prod systemd unit, `deploy.sh` paths, and `.env` locations, so they're not
  "low-risk". A `@sitesurge/server` package living in `packages/api` is fine for
  pnpm (resolves by name, not path).

## 1. Goal

Turn the working SiteSurge monorepo — today consumed by cloning the whole repo and
pointing it at a different database (how the "RW" demo and Surge Media both run) —
into a set of **properly distributable packages** so any web developer can:

1. Stand up the **headless CMS backend** (API + admin UI) for their site, and
2. Consume it from a frontend using **our SDK client** *or* their **own custom
   client**, and
3. **Initialize** a new site quickly — via the existing visual wizard **or** an
   interactive CLI — with a documented "Getting Started" flow.

Constraint/preference: **keep a single repository (monorepo)** if we can, while
still getting real dependency separation. (Multi-repo is acceptable if clearly
better; the recommendation below keeps one repo.)

## 2. Current state (audit)

### 2.1 Packages

| Package | Name | Role | Publish-ready? | Notes |
|---|---|---|---|---|
| `packages/shared` | `@sitesurge/types` | Types + API DTOs + format/validation utils | Partial | `main`/`types` set, but built ESM with **bundler-style directory imports** (`export * from './api'`) that raw Node ESM can't resolve — runs only under a bundler/tsx. No `exports`/`files`. |
| `packages/api` | `@sitesurge/server` | Express server (REST + SSR + migrations) | **No** | It's a *service*, not a library. No `types`/`exports`/`files`. Runs via `tsx` in prod for the same directory-import reason. |
| `packages/cms` | `@sitesurge/admin` | SolidJS admin + public SPA | N/A (app) | Built to static `dist/`, served by the server. Not a library. |
| `packages/cms-client` | `@sitesurge/client` | Headless HTTP SDK | **Yes** | Dual CJS/ESM `exports`, `files:[dist]`, `./solid` adapter subpath. `private:true` (never published). Cleanest of the bunch. |
| `packages/cms-mcp` | `@sitesurge/mcp` | MCP server (AI authoring) | **Yes** | `bin`, `files:[dist]`. `private:true`. |

All cross-package deps are `file:` workspace links (pnpm). Scope `@rw/cms-*` is
historical (CLAUDE.md already flags a rename to SiteSurge).

### 2.2 Consumption model today

There is only one: **clone the repo, set `.env` (DB/Redis/etc.), build, run.** A
"site" = a database + appearance/content rows + a local `.env`. The RW and Surge
deployments differ only by DB, ports, and content — the code is identical. This is
actually a healthy sign: **the product is data-driven; sites carry no code.**

What's missing for external consumption:
- Nothing is published to a registry; `@sitesurge/client` can't be `npm i`'d.
- The server can't be run without the whole repo checkout.
- Site-specific artifacts (the `deploy/` scripts, the Surge content build scripts)
  live in the CMS repo, blurring "product" vs "a site built with it."

### 2.3 Initialization mechanisms (already strong)

- **First-run gate**: `middleware/setupGate` forces the app into setup mode until
  installed; the SPA redirects to `/setup`.
- **Visual wizard**: `packages/cms/src/pages/setup/Setup.tsx` + `services/setup.ts`,
  driving `POST /api/v1/setup/{status,test-db,test-redis,test-smtp,test-s3,generate-jwt,install}`.
- **Installer**: `services/setup/installer.ts` → `runInstallation(input)` runs an
  ordered, rollback-capable **step pipeline**: `database → migrations → adminUser →
  seed → siteSettings → envWrite`. Input is a single typed `InstallInput`
  (general, database [with optional superuser to *create* role+db], adminUser,
  redis, storage [local/s3], security [jwt], email).
- **DB tooling**: `db/migrate.ts`, `db/migrator.ts`, `db/seeder.ts`, feature-module
  lazy migrations.

**Key insight for this design:** `runInstallation(input, { envPath })` is a clean,
UI-agnostic seam. A CLI can gather the same `InstallInput` and call it directly —
no logic duplication. The visual wizard and a CLI become two front-ends over one
installer.

## 3. Recommendation (summary)

**Stay a single monorepo**, but make the split real:

1. **Rename the scope** `@rw/cms-*` → `@sitesurge/*` and split "the product" from
   "sites built with it."
2. **Publish the libraries** (`types`, `client`, `mcp`, a new `cli`) to a registry.
3. **Ship the server as a container image** (primary) **and** an optional npm
   package (`@sitesurge/server`) exposing `createApp()`/`startServer()` for
   embedders. The **admin UI is bundled into the server** (Strapi-style).
4. Add an **interactive CLI** (`sitesurge`) and a **scaffolder**
   (`npm create sitesurge`) over the existing installer.
5. **Move the RW/Surge sites out** of this repo into their own thin site repos
   (DB + `.env` + deploy config, optionally a custom frontend).

This gives two first-class consumption modes:
- **Turnkey**: run the server → it serves API + admin + a themeable public site.
- **Headless**: run the server (API + admin) → build your own frontend with
  `@sitesurge/client` (or a custom client against the typed API).

## 4. Target package map (single monorepo)

Repo: `surge-cms` (the renamed GitHub repo). Product packages only:

```
packages/
  types/     @sitesurge/types    — types + API DTOs + shared utils   [npm, public]
  client/    @sitesurge/client   — headless HTTP SDK (+ /solid)       [npm, public]
  mcp/       @sitesurge/mcp      — MCP server (bin: sitesurge-mcp)    [npm, public]
  cli/       @sitesurge/cli      — init/setup/migrate CLI (bin: sitesurge)  [npm]   ← NEW
  server/    @sitesurge/server   — Express API + SSR + migrations     [Docker + npm]
  admin/     @sitesurge/admin    — SolidJS admin+public SPA (built into server)  [not published]
create-sitesurge/                — `npm create sitesurge` scaffolder  [npm]        ← NEW
examples/
  headless-next/                 — custom frontend using @sitesurge/client (reference)
  turnkey-compose/               — docker-compose (postgres+redis+server) quickstart
docs/                            — API.md, MCP.md, getting-started, this spec
```

Renames: `shared→types`, `api→server`, `cms→admin`, `cms-client→client`,
`cms-mcp→mcp`. (`shared` → `types` because that's what it is to consumers; keep the
utils there too.)

**Sites leave the repo.** RW and Surge become their own repos (or a single
`sites/` repo), each holding: a `.env`/config, deploy scripts (the current
`deploy/` + db-sync), and — for headless sites — a custom frontend app. They
depend on `@sitesurge/*` from the registry; they do **not** vendor the CMS source.

### Why monorepo (not multi-repo)

- The packages version and release together (a DTO change in `types` ripples to
  `client`, `server`, `mcp`); one repo keeps them lockstep and the existing
  `check:drift` guard intact.
- Tooling already assumes one tree (pnpm workspaces, `config/`, shared tsconfig).
- Publishing independently-versioned packages *from* a monorepo is a solved
  problem (Changesets). We keep the developer ergonomics and still ship separable
  deps. Multi-repo would add cross-repo version churn for no real gain here.

## 5. Distribution model per package

### 5.1 Libraries → npm (`@sitesurge/*`, public scope)

`types`, `client`, `mcp`, `cli` are plain TS. Make each publishable:
- `exports` map (types/import/require), `files:["dist"]`, `sideEffects:false`,
  `repository`/`license`/`homepage`, `publishConfig.access:"public"`.
- `client` is already there; replicate its shape onto the others.
- **Versioning/release**: adopt **Changesets** — PRs add a changeset; a release
  workflow bumps versions, updates changelogs, and `pnpm publish -r` on tag.
  `types` is the base; `client`/`mcp`/`server` declare it as a normal semver dep
  (workspace protocol `workspace:*` in-repo, rewritten to the published range on
  publish).
- Registry: **public npm** under `@sitesurge`. (Alternative: GitHub Packages /
  private registry if the product should stay closed — same mechanics, set
  `publishConfig.registry`.)

### 5.2 Server → container image (primary) + npm (advanced)

The backend has heavy, native deps (`pg`, `sharp`, Stripe, `ioredis`) and needs
Postgres + Redis. It is a **service**, so the default distribution is a
**Docker image** `sitesurge/server` that bundles the built admin UI and runs the
API + SSR. Consumers configure via env + the setup wizard/CLI; upgrades = pull a
new tag.

Also publish **`@sitesurge/server`** (npm) exposing a small programmatic surface
for embedders who want to add custom routes/middleware in their own Node app:

```ts
import { createApp, runMigrations, startServer } from '@sitesurge/server';
const app = createApp('running');        // the Express app (already a factory)
app.use('/my/custom', myRouter);
startServer(app);                          // or mount app yourself
```

`createApp()` already exists — this mostly means exporting it and shipping types.
**Prerequisite:** fix the `@sitesurge/types` build to be **Node-resolvable**
(emit real ESM with explicit `.js` specifiers, or dual CJS) so the server can run
under plain `node dist` instead of `tsx`. (Today prod runs via `tsx` precisely
because of the directory-import issue — acceptable for the container, required
before we tell people to `npm i @sitesurge/server`.)

### 5.3 Admin UI → bundled into the server

`@sitesurge/admin` builds to a static SPA that the server serves (as it does now
from `../cms/dist`). It is **not** a standalone published package — it ships inside
the server image / server package. Headless consumers simply don't use the public
SPA (a flag disables the public-site routes; the admin at `/admin` stays).

## 6. Consumption modes (what a developer actually does)

### Mode A — Turnkey (batteries included)
Run the server; it serves the API, the admin at `/admin`, and a **themeable public
site** (the built-in SolidJS renderer driven by appearance/blocks — what RW/Surge
use). Best for "I want a CMS-powered site fast, no custom frontend."

### Mode B — Headless (bring your own frontend)
Run the server for the API + admin only (disable the public SPA). Build your site
in any framework and pull content via:
- **Official SDK** — `@sitesurge/client`:
  ```ts
  import { createClient } from '@sitesurge/client';
  const cms = createClient({ baseUrl: 'https://cms.example.com', auth: { apiKey: 'ssk_…' } });
  const { data: posts } = await cms.posts.list();
  ```
- **Custom client** — hit the REST API directly, typed against **`@sitesurge/types`**
  (request/response DTOs for all modules) and documented in `docs/API.md` +
  `docs/api-manifest.json`. Scoped `ssk_` API keys authenticate machine clients.

Both modes use the **same server**; the difference is only which frontend renders.

## 7. Initialization & onboarding design

Three front-ends over **one installer** (`runInstallation(input)`):

### 7.1 Visual wizard (exists — document it)
First boot with no/empty `.env` → setup gate → SPA `/setup`. Steps: General →
Database (existing or *create* via superuser) → Admin user → Redis → Storage
(local/S3) → Email → Security (JWT). Live "Test connection" for DB/Redis/SMTP/S3.
On finish it writes `.env`, runs migrations + seed, creates the admin, and
restarts into running mode. **Action:** document this in Getting Started + a short
screencast; no code change.

### 7.2 Interactive CLI (NEW — `@sitesurge/cli`)
`sitesurge setup` gathers the **same `InstallInput`** via prompts (e.g. `prompts`/
`enquirer`), reusing the existing `test-*` validators for live checks, then calls
`runInstallation(input, { envPath })`. Parity with the wizard by construction
(shared installer + shared input schema).

```
$ npx @sitesurge/cli setup
◆ Site name ›  Acme News
◆ Database ›  create new  (host localhost, db acme, + superuser to bootstrap)
◆ Admin user ›  admin@acme.com  ••••••••
◆ Redis ›  redis://localhost:6379/0   ✓ reachable
◆ Storage ›  local ./uploads
◆ JWT secret ›  (generated)
✔ Migrated · seeded · admin created · wrote .env  → run `sitesurge start`
```

Also a **non-interactive** mode for CI/IaC:
`sitesurge setup --config setup.json` or `--from-env` (read answers from env vars).
Other subcommands wrap existing scripts: `sitesurge migrate`, `sitesurge seed`,
`sitesurge doctor` (the `test-*` checks), `sitesurge apikey issue`.

**Implementation is thin**: the CLI imports the installer + validators from the
server package (or a shared `@sitesurge/core` install module) — no reimplementation.

### 7.3 Scaffolder (NEW — `npm create sitesurge`)
`npm create sitesurge@latest my-site` generates a ready project:
- `docker-compose.yml` (postgres + redis + `sitesurge/server`),
- `.env` from a template (with a generated JWT),
- optional starter **headless frontend** (`--headless next|astro|solid`) wired to
  `@sitesurge/client`,
- a README with the two commands below.

Then: `docker compose up -d` → `npx @sitesurge/cli setup` (or open `/setup`).

## 8. Proposed "Getting Started" (target docs)

> Lands in the root `README.md` and each package README when §9 is implemented.

**A. Turnkey site (fastest)**
```bash
npm create sitesurge@latest my-site && cd my-site
docker compose up -d            # postgres + redis + sitesurge server
open http://localhost:3001/setup   # or: npx @sitesurge/cli setup
```
Configure appearance/content in the admin at `/admin`. Done.

**B. Headless — your frontend, our content API**
```bash
# 1) run the CMS backend (as in A, or your own host)
# 2) in your frontend project:
npm i @sitesurge/client @sitesurge/types
```
```ts
import { createClient } from '@sitesurge/client';
const cms = createClient({ baseUrl: process.env.CMS_URL, auth: { apiKey: process.env.CMS_KEY } });
export const getPosts = () => cms.posts.list({ limit: 12 });
```
Issue a scoped key in **admin → Settings → API Keys**. Prefer a custom client?
Everything is typed in `@sitesurge/types` and documented in `docs/API.md`.

**C. Embed the server in your own Node app (advanced)**
```bash
npm i @sitesurge/server
```
```ts
import { createApp, startServer } from '@sitesurge/server';
const app = createApp('running');
app.use('/webhooks/custom', myRouter);
startServer(app);
```

**D. AI-assisted authoring** — point the MCP server at your instance:
`CMS_BASE_URL=… CMS_API_KEY=ssk_… npx @sitesurge/mcp` (see `docs/MCP.md`).

## 9. Migration plan (phased, low-risk)

Each phase is independently shippable; the running RW/Surge deployments keep
working throughout (they track the repo until they move out).

- **Phase 0 — Decide & set up publishing.** Confirm scope name (`@sitesurge`),
  registry (public npm vs private), and adopt Changesets + a release CI workflow.
  *(Decisions needed — see §10.)*
- **Phase 1 — Scope rename.** `@rw/cms-*` → `@sitesurge/*`, directory renames
  (`shared→types`, `api→server`, `cms→admin`, `cms-client→client`, `cms-mcp→mcp`),
  update imports, `pnpm-workspace.yaml`, config paths, docs. Mechanical; one PR.
- **Phase 2 — Publish the libraries.** Add `exports`/`files`/`publishConfig` to
  `types`, `mcp`, and (un-private) `client`; switch in-repo deps to
  `workspace:*`; publish `0.x` to the registry. Consumers can now `npm i
  @sitesurge/client`.
- **Phase 3 — Node-resolvable `types` build.** Fix the directory-import emit
  (explicit `.js` specifiers / dual output). Verify `server` runs under `node
  dist` (drop the `tsx`-in-prod workaround). Unblocks `@sitesurge/server` on npm.
- **Phase 4 — Server distribution.** Dockerfile + published image (admin bundled);
  export `createApp/startServer/runMigrations` from `@sitesurge/server`; publish.
- **Phase 5 — CLI.** `@sitesurge/cli` over `runInstallation` + validators;
  `setup` (interactive + `--config`/`--from-env`), `migrate`, `seed`, `doctor`,
  `apikey`. Reuse, don't reimplement.
- **Phase 6 — Scaffolder + examples.** `create-sitesurge`; `examples/headless-*`
  and `examples/turnkey-compose`. Write the real Getting Started (§8) into READMEs.
- **Phase 7 — Extract sites.** Move RW/Surge (incl. `deploy/`, db-sync, Surge
  content build scripts) into their own repo(s) consuming `@sitesurge/*`. The CMS
  repo becomes product-only.

## 10. Decisions needed from you

1. **Scope + registry**: publish publicly under `@sitesurge` on npm, or keep
   private (GitHub Packages / private registry)? This gates Phases 2+.
2. **Package name for the server**: `@sitesurge/server` (my pick) vs `/api` /
   `/backend`.
3. **Sites' home**: one `sites/` repo for RW+Surge, or a repo each?
4. **Turnkey public renderer**: keep shipping the built-in SolidJS public site as a
   first-class feature (Mode A), or position SiteSurge as **headless-first** with
   the public SPA as an optional example? (Affects how much we invest in the
   built-in renderer vs the SDK/examples.)
5. **Framework(s) for the scaffolder's headless starter**: Next, Astro, SolidStart?

## 11. Non-goals / notes
- No content is code; "sites" stay data (DB + appearance). Nothing here changes
  the block/appearance model.
- The API surface + typed DTOs already make **custom clients** first-class — this
  design just makes the SDK and types installable and documents the contract.
- The installer's step pipeline + `InstallInput` schema are the linchpin that lets
  the wizard and CLI stay in perfect parity for free.
