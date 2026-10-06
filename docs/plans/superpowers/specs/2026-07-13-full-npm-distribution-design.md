# Full npm Distribution — Package Design

**Status:** Design / proposed (2026-07-13)
**Goal:** Publish the complete SiteSurge package set so any consumer can build and run a site **on their own git repo via npm** (backend + admin + client), without cloning the monorepo — with a Docker image as a parallel turnkey artifact.

**Supersedes the deferred "server on npm" item in** `2026-07-11-packaging-and-init-design.md`.

---

## 1. Current state

Published to npm (GPL-2.0-only): `@sitesurge/types@0.1.1`, `@sitesurge/client@0.2.1`, `@sitesurge/mcp@0.1.1`.

Private (monorepo-only): `@sitesurge/server` (packages/api), `@sitesurge/admin` (packages/cms), `@sitesurge/cli` (packages/cli), `create-sitesurge` (packages/create-sitesurge).

The server exports `createApp`/`startServer` and has a `sitesurge-server` bin, so the **embed** path is ~80% wired. What blocks publishing is three concrete things (see §5).

---

## 2. Target published surface

| Package | Role | Consumer-facing? | Depends on |
|---|---|---|---|
| `@sitesurge/types` | Types + API DTOs + utils | via other pkgs | — |
| `@sitesurge/client` | Headless HTTP SDK | **yes** (frontends) | types |
| `@sitesurge/mcp` | MCP server (AI authoring) | **yes** (`npx`) | client, types |
| `@sitesurge/admin` 🆕 | Built admin SPA as a **static-asset package** + `adminDistPath()` resolver | rarely direct | — |
| `@sitesurge/server` 🆕 | Backend: REST API + SSR + serves admin | **yes** (embed/run) | types, **admin** |
| `@sitesurge/cli` 🆕 | Ops CLI: `setup/migrate/seed/doctor/start/status` | **yes** (`npx`) | server |
| `create-sitesurge` 🆕 | Scaffolder — the entry point for new projects | **yes** (`npm create`) | — (zero-dep) |

Parallel artifact (not npm): **`ghcr.io/rw3iss/sitesurge-server:<version>`** Docker image for turnkey operators.

### Dependency graph

```
types ──► client ──► mcp
  │          ▲
  ├────────► admin (static assets)
  │            ▲
  └──► server ─┘         server deps: { types (^), admin (=fixed) }
         ▲
         └── cli          cli deps: { server (=fixed) }

create-sitesurge   (zero runtime deps; generates consumer repos)
```

---

## 3. Consumer scenarios → packages

| I want to… | Install | Shape |
|---|---|---|
| Run the CMS, no source | `ghcr.io/…/server` image, **or** `@sitesurge/server` + `@sitesurge/cli` | thin repo / compose |
| Embed/extend in my Node app | `npm i @sitesurge/server` | `startServer()` + mount routes |
| Build my own frontend | `npm i @sitesurge/client @sitesurge/types` | any framework |
| AI-assisted authoring | `npx @sitesurge/mcp` | — |
| Bootstrap a new project | `npm create sitesurge@latest my-site` | pick docker \| node \| headless |

**The "own git repo, npm deps" model (§ the user's ask):**

```
my-site/                      # your repo — no CMS source
├── package.json              # deps: @sitesurge/server, @sitesurge/cli
├── .env                      # DATABASE_URL, JWT_SECRET, …
├── src/index.ts              # import { startServer } from '@sitesurge/server'; startServer()
└── (optional) src/custom/*   # your own routes, mounted via createApp()
```
Upgrade = bump `@sitesurge/server` version + `npx sitesurge migrate`.

---

## 4. Design decision: admin as a static-asset package

The admin is a built Vite SPA — nobody `import`s it as code. Two options:

- **(A) Separate `@sitesurge/admin` package** = the built `dist` + a 3-line entry exporting `adminDistPath()` (resolves to the package's own `dist`). Server `require.resolve`s it and serves those files.
- (B) Bundle the admin `dist` directly into the `@sitesurge/server` tarball; no separate package.

**Chosen: (A).** Cleaner boundary, independently versioned, and it lets an operator host the admin on a CDN or swap a customized build. Cost: one more package + they must stay version-locked (handled by the fixed group, §7). If we later regret it, collapsing to (B) is trivial.

---

## 5. Work to make `@sitesurge/server` publishable

### 5a. `@sitesurge/admin` → static-asset package
- Build stays `vite build` → `dist/`.
- Add `packages/cms/asset-entry/index.js` (tiny, committed): `export const adminDistPath = () => path.join(__dirname, '..', 'dist')` (or `require.resolve`-safe equivalent). Publish as CJS+types.
- `package.json`: `private:false`, `main` → the entry, `files: ["dist","asset-entry"]`, `publishConfig.access:public`, GPL.

### 5b. Server serve-path fix (`app.ts:159`)
Replace the monorepo assumption:
```ts
// before
const distDir = path.resolve(process.cwd(), '../cms/dist');
// after
import { adminDistPath } from '@sitesurge/admin';
const distDir = resolveAdminDist(); // adminDistPath() when installed;
                                     // fallback to ../cms/dist for `pnpm dev`
```
Keep the dev fallback so the monorepo `pnpm dev` flow is unchanged.

### 5c. Ship non-JS assets in server `dist`
`tsc` copies only `.ts→.js`. Add a post-build copy so `__dirname`-relative reads resolve under `node dist`:
- `src/db/migrations/*.sql`, `src/db/schema.sql` → `dist/db/…`
- any seed data / default fonts the seeder reads from disk (audit `scripts/seed-fonts.ts`, `db/seed.ts`)
- `"build": "tsc && node scripts/copy-assets.mjs"` (glob-copy the asset list).
- Add `files: ["dist"]` whitelist (currently unset → would publish src + everything).

### 5d. Asset-resolution audit
Confirm every runtime read is **module-relative** (`__dirname`/`import.meta.url`), not `process.cwd()`, **except** intentionally cwd-based ones:
- ✅ migrations/schema — `__dirname` (correct)
- ✅ `.env` — `process.cwd()/.env` (correct: consumer's cwd)
- ✅ SSR cache, `/uploads`, `/avatars` — cwd/config dirs (correct: runtime-writable, operator-owned)
- ⚠️ admin dist — being fixed in 5b
- ⚠️ `lifecycle.ts` resolves `../index.ts` for restart — verify it degrades gracefully when only `dist` exists.

### 5e. Flip private + publishConfig
`private:false`, `publishConfig.access:public`, `engines.node>=20`, `repository.directory`. `bin` + `exports` already present.

### 5f. Native deps
`sharp` ships prebuilt binaries via optional deps — `npm i` handles per-platform. Document the musl/Alpine/serverless caveat in DEPLOYMENT. No code change; keep `sharp` a normal dep.

### 5g. Acceptance test — clean-room boot
Outside the monorepo, in a temp dir:
```bash
npm i @sitesurge/server @sitesurge/cli
# .env → a throwaway Postgres
npx sitesurge migrate && npx sitesurge seed
node -e "require('@sitesurge/server').startServer()"
curl localhost:3001/health        # ok
curl localhost:3001/admin         # serves the bundled SPA
```
This proving out is the gate for the first server publish.

---

## 6. CLI + scaffolder

### `@sitesurge/cli`
- `private:false`, `publishConfig`, dep `@sitesurge/server` → `^` range. Already has `files:["dist"]` + `sitesurge` bin.

### `create-sitesurge`
- `private:false`. Extend from Docker-only to **three shapes** (prompt if no flag):
  - `--docker` (current): compose + `.env`, uses the published GHCR image.
  - `--node` (**new**): the thin npm-server repo of §3 — `package.json` (`@sitesurge/server` + `@sitesurge/cli`), `src/index.ts` (`startServer()`), `.env` with generated secrets, scripts (`setup`/`migrate`/`start`).
  - `--headless`: adds a `@sitesurge/client` frontend starter (composes with either backend).
- Update its generated README (drop the "until it's on a registry, docker build…" caveat once the image ships).

---

## 7. Versioning & release

- **Fixed group** (changesets `fixed`): `{ @sitesurge/server, @sitesurge/admin, @sitesurge/cli }` — the app tier moves as one version, so a `server@1.3` always pairs with `admin@1.3`.
- **Independent semver**: `types`, `client`, `mcp` keep their own cadence (already at 0.x); server depends on them via `^` ranges so an app release doesn't force a lib bump.
- **OIDC trusted publishing** for the new packages (same as the libs) — after the manual bootstrap publish, register trusted publishers for server/admin/cli.
- First app-tier version: start at `0.1.0` (or `1.0.0` if we're calling it stable).

## 8. Docker image

- Existing `config/Dockerfile` already builds the whole workspace + runs `node dist`. Add `.github/workflows/image.yml`: on release / tag, `docker buildx` → push `ghcr.io/rw3iss/sitesurge-server:<server-version>` + `:latest` (GHCR, OIDC — no PAT). Update compose scaffolds to pull it.

---

## 9. Rollout phases

1. **Server publishable** — 5a–5d (admin asset pkg, serve-path fix, asset copy, files whitelist, audit) + clean-room boot test. *No publishing yet.*
2. **First app-tier publish** — flip private (5e), changesets fixed group, bootstrap-publish `server`/`admin`/`cli`, then register OIDC trusted publishers.
3. **Docker image** — GHCR workflow (§8).
4. **Scaffolder `--node` mode** (§6) + README/DEPLOYMENT docs for the thin-repo model.
5. **Docs sweep** — CLAUDE.md, README Getting Started (new "own repo, npm" path), an `examples/node-server` repo, MCP/DEPLOYMENT cross-refs.

## 10. Open decisions (need sign-off)

1. **Admin packaging** — separate `@sitesurge/admin` static-asset package (recommended, §4) vs bundle into server. 
2. **Version strategy** — fixed group `{server, admin, cli}`, libs independent (recommended, §7) vs one lockstep version for everything.
3. **Docker registry** — GHCR (recommended: free, repo-tied, OIDC) vs Docker Hub.
4. **Server license** — `GPL-2.0-only` like the libs? Note GPLv2 (not AGPL) does **not** trigger on network use, so running a *modified* server as a hosted service needs no source release; **distributing** a modified server package does. If SaaS-style copyleft is wanted, AGPL for the server is the lever. Consumer frontends (their own code calling `@sitesurge/client`) are unaffected either way. **This is a licensing call, not a technical one.**
5. **App-tier starting version** — `0.1.0` (signal pre-1.0) vs `1.0.0` (stable).
