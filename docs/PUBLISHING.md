# Publishing & updating SiteSurge

SiteSurge has **one version — the CMS version** — carried by every published package:

| Package | Directory | What it is |
|---|---|---|
| `@sitesurge/server` | `packages/api` | backend (API + SSR); serves the admin — **the version installs check** |
| `@sitesurge/admin` | `packages/cms` | built admin SPA static assets |
| `@sitesurge/cli` | `packages/cli` | `sitesurge` ops CLI |
| `@sitesurge/types` | `packages/shared` | types + API DTOs + utils |
| `@sitesurge/client` | `packages/cms-client` | headless HTTP SDK |
| `@sitesurge/mcp` | `packages/cms-mcp` | MCP server (`sitesurge-mcp`) |
| `create-sitesurge` | `packages/create-sitesurge` | `npm create sitesurge` scaffolder |

## Where versions live

| Place | Holds | Read by |
|---|---|---|
| **npm** — `@sitesurge/server` `latest` dist-tag | the installable packages | **Check for update / Update & restart** (the source of truth: it is exactly what `npm install …@latest` gets) |
| **GitHub Release `vX.Y.Z`** | release notes + package tarballs | the CMS Version panel ("What's new"); people. Also the fallback for "latest" when npm can't be reached |
| `releases.json` (repo root) | the version index: `latest` + history | people and tooling |
| `CHANGELOG.md` | every release's change list | people |
| `ghcr.io/rw3iss/sitesurge-server:X.Y.Z` | the Docker image, built by `.github/workflows/image.yml` on the tag | Docker installs |

## Publishing a new version

**Once per machine:**

```bash
npm login        # npmjs.com account with publish rights on the @sitesurge scope (2FA applies)
gh auth login    # GitHub account with push rights on rw3iss/surge-cms
```

**Each release** — from a clean checkout of `main`:

```bash
pnpm release 1.2.0 --dry-run   # rehearse: build + tests + notes preview; publishes and pushes nothing
pnpm release 1.2.0             # or: pnpm release patch | minor | major
```

`scripts/release.mjs` then:

1. **Preflight** — on `main`, clean tree, signed in to npm and GitHub, the version is new (not tagged, not on npm, greater than the current one). Asks for confirmation (`--yes` skips).
2. **Bump** — every package (and the private root) to the version.
3. **Build + test** — `pnpm -r run build`, `pnpm -r run test` (`--skip-tests` skips the tests).
4. **Index** — prepends `CHANGELOG.md` (the commit subjects since the previous release) and updates `releases.json`.
5. **Commit + tag** — `release: vX.Y.Z` and an annotated `vX.Y.Z` tag.
6. **npm** — `pnpm -r publish --access public`. pnpm rewrites `workspace:` ranges to real versions and skips anything already on npm.
7. **Push** — `main` and the tag. The tag triggers the Docker image build.
8. **GitHub Release** — `vX.Y.Z`, marked latest, with the notes and every package tarball attached.

**If it stops part-way** (npm 2FA timed out, a network error): run the **same command** again. It sees the tag on `HEAD` and resumes from step 6; npm skips what is already published, and the push and the GitHub Release are idempotent.

Options: `--dry-run`, `--skip-tests`, `--yes`, `--otp <code>` (or `NPM_OTP`).

**npm two-factor auth.** If your npm account uses 2FA, the first run stops at the publish step with `EOTP` — everything before it (bump, build, tests, commit, tag) is done and kept locally. Run the same command again with a fresh code from your authenticator: `pnpm release X.Y.Z --yes --otp=123456`. It sees the tag on HEAD, skips build and tests, and publishes at once, so the ~30-second code is still valid. If the code expires part-way, run it again with a new code — packages already on npm are skipped. The repository can be overridden with `CMS_RELEASES_REPO=owner/repo`.

## Updating an installation

**Settings → Admin → CMS Version** (`components/admin/panels/CmsUpdatePanel.tsx`, `services/systemUpdate.ts`):

1. **Check for updates** — reads the installed `@sitesurge/server` version and npm's `latest`, and shows the GitHub Release notes for the newer version.
2. **Update & restart** — runs `npm install @sitesurge/{server,admin,cli}@latest` (whichever are installed) in the install directory, then exits so the process supervisor restarts it. Migrations apply on boot (`bootRunningMode`). The page polls until the server is back, then reloads. Takes about 30–60 seconds.

| Installation | How it updates |
|---|---|
| **npm** (`npm create sitesurge --node`, or `@sitesurge/server` as a dependency) | the **Update & restart** button — needs a supervisor (systemd, pm2, Docker restart policy) |
| **Docker** (`ghcr.io/rw3iss/sitesurge-server`) | pull the new image tag and recreate the container |
| **Source checkout** of this repository | `git fetch --tags && git checkout vX.Y.Z`, then rebuild and restart (or the deploy script). The panel detects this (`installKind: 'source'`) and disables the button — an `npm install` would shadow the workspace packages |

Back up the database before updating (Settings → Admin → Backup & Restore). In-admin guide: `/admin/help/releases`.

## Optional: publishing from CI (Changesets + OIDC)

`.github/workflows/release.yml` can publish without a local npm login, using npm **trusted publishing**. It is **manual-only** (`workflow_dispatch`) so it can't race `pnpm release`; it runs `pnpm run release:changesets`. It does not tag `vX.Y.Z` or create the GitHub Release — prefer `pnpm release`.

### Trusted publishing setup (OIDC)

CI publishes **without any npm token**, using OIDC trusted publishing — npm's
recommended path since 2025 (classic tokens were permanently removed Dec 2025;
only short-lived granular tokens remain). OIDC also adds provenance automatically.

**One-time, per published package** (`@sitesurge/types`, `@sitesurge/client`,
`@sitesurge/mcp`) — npmjs.com → the package → Settings → **Trusted Publisher →
GitHub Actions**:
- Repository: `rw3iss/surge-cms`
- Workflow: `release.yml`

Trusted publishing can only be configured **after** a package's first version
exists, so bootstrap the first publish manually (below), then add the publishers.

**CI flow** (`.github/workflows/release.yml`, run manually from the Actions tab):
1. Merge PRs that contain a changeset → the action opens/refreshes a
   **"Version Packages"** PR (bumps versions + changelogs).
2. Merge that PR → the action builds and **publishes via OIDC** (with provenance).

The workflow uses `id-token: write`, Node ≥ 22.14, and npm ≥ 11.5.1 (it upgrades
npm) and sets **no** `NODE_AUTH_TOKEN` (its presence disables OIDC).

### First publish (bootstrap — do once, at Phase 3)

From your machine, after `npm login` (2FA prompts apply — `auth-and-writes`):

```bash
pnpm changeset          # mark the libs for their first 0.x release, if not yet
pnpm version-packages   # apply versions + changelogs
pnpm run release:changesets   # build, then publish; enter your 2FA OTP when prompted
```

Then add the trusted publishers above so CI takes over token-free.

> **pnpm `workspace:` protocol:** pnpm rewrites `workspace:*` to real version
> ranges at publish time. Verify the first publish (the published `package.json`
> deps should show real versions, not `workspace:*`). If `changeset publish`
> doesn't rewrite them, switch the `release:changesets` script to
> `pnpm -r publish --no-git-checks` after `changeset version`.

### Token-based CI (fallback, only if OIDC won't work)

Create a **granular** token (the only type now) with **Read and write** on the
`@sitesurge` scope **and "Bypass 2FA" enabled** (required with account 2FA
`auth-and-writes`), set it as the `NPM_TOKEN` repo secret, and add
`NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` back to the workflow. Note the
**90-day max** expiry → you'll rotate it. OIDC avoids all of this.
