# Publishing SiteSurge packages

The monorepo publishes three public libraries to npm under the **`@sitesurge`**
scope, using [Changesets](https://github.com/changesets/changesets):

| Package | Published | Notes |
|---|---|---|
| `@sitesurge/types` | ✅ npm | types + API DTOs + utils (`packages/shared`) |
| `@sitesurge/client` | ✅ npm | headless HTTP SDK (`packages/cms-client`) |
| `@sitesurge/mcp` | ✅ npm | MCP server, bin `sitesurge-mcp` (`packages/cms-mcp`) |
| `@sitesurge/server` | ❌ private (Phase 4) | ships as a Docker image; npm later |
| `@sitesurge/admin` | ❌ private | app, bundled into the server |

Server/admin are marked `private: true` and are in the Changesets `ignore` list,
so they're never pushed to npm.

## Day-to-day: adding a change

When you change a published package, add a changeset in the same PR:

```bash
pnpm changeset          # pick packages + bump type (patch/minor/major), write a summary
git add .changeset && git commit
```

Internal `workspace:*` deps are rewritten to the published version range at
publish time — you don't hand-edit versions.

## Releasing — Trusted Publishing (OIDC)

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

**Ongoing flow** (`.github/workflows/release.yml`, on `main`):
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
pnpm release            # build, then publish; enter your 2FA OTP when prompted
```

Then add the trusted publishers above so CI takes over token-free.

> **pnpm `workspace:` protocol:** pnpm rewrites `workspace:*` to real version
> ranges at publish time. Verify the first publish (the published `package.json`
> deps should show real versions, not `workspace:*`). If `changeset publish`
> doesn't rewrite them, switch the `release` script to
> `pnpm -r publish --no-git-checks` after `changeset version`.

### Token-based CI (fallback, only if OIDC won't work)

Create a **granular** token (the only type now) with **Read and write** on the
`@sitesurge` scope **and "Bypass 2FA" enabled** (required with account 2FA
`auth-and-writes`), set it as the `NPM_TOKEN` repo secret, and add
`NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}` back to the workflow. Note the
**90-day max** expiry → you'll rotate it. OIDC avoids all of this.

## Pre-publish checklist

- [x] **Confirm the license.** The libraries declare `GPL-2.0-only` (GPLv2) with a
      `LICENSE` file in each published package.
- [x] **Node-resolvable `@sitesurge/types` build** (Phase 3 — ✅ done): types now
      emit CommonJS with an `exports` map, so the packages work for raw `node` as
      well as bundlers. (This also lets the api server run `node dist`.)
- [ ] npm org/scope `@sitesurge` created; after the first manual publish,
      **trusted publishers** configured for each lib (OIDC) — or a Bypass-2FA
      granular `NPM_TOKEN` secret for the token-based fallback.
- [ ] `pnpm build && pnpm test` green (CI enforces).

See the full plan: `docs/superpowers/specs/2026-07-11-packaging-and-init-design.md`.
