# Plugins

SiteSurge supports **plugins** — admin-installable extensions that live in a
backend `plugins/` directory, modeled on the [Features](../../CLAUDE.md) system but
over an open, data-driven set. Design spec:
`docs/plans/superpowers/specs/2026-07-13-plugin-system-design.md`.

Enable the **Plugins** feature (Settings → Features) to reveal **Admin →
Plugins**. Reference plugin: `packages/api/plugins/pageloop/`.

## Anatomy

```
plugins/<name>/
  plugin.json      # manifest (required)
  server.js        # Node lifecycle hooks (CommonJS; optional)
  client.js        # browser ESM bundle: mount/unmount + config UI (optional)
  client/          # static assets served at /api/v1/plugins/<name>/assets/*
  migrations/*.sql # optional plugin-owned SQL (tables prefixed plugin_<name>_*)
```

### `plugin.json`
```jsonc
{
  "name": "pageloop",              // == folder name (kebab, unique)
  "label": "PageLoop Comments",
  "version": "0.1.0",
  "apiVersion": 1,                 // host plugin-API version
  "server": "server.js",
  "client": "client.js",
  "capabilities": ["public-widget", "config-page"],
  "adminOnlyToggle": true,
  "configSchema": [                // host renders a form from this if no custom mountConfig
    { "key": "endpoint", "label": "Server endpoint", "type": "url", "required": true },
    { "key": "adminOnly", "label": "Admins only", "type": "boolean", "default": false }
  ]
}
```
Field types: `string | url | number | boolean | select | secret | textarea`.
`secret` fields are stripped from the public projection.

### `server.js` — Node hooks (all optional, idempotent, self-detecting)
```js
module.exports = {
  async install(ctx)  { /* download deps, create tables/data */ },
  async uninstall(ctx){ /* cleanup (owned tables dropped by the host) */ },
  async onEnable(ctx) {},
  async onDisable(ctx){},
  async onLoad(ctx)   { /* every boot for enabled plugins */ },
  async update(ctx)   { return { fromVersion, toVersion, migrated, notes }; },
  validateConfig(config) { return { ok: true }; },
  // Named backend operations (optional) — the admin invokes these without the
  // plugin registering Express routes. Used e.g. to proxy a secret-keyed API.
  actions: { async myAction(ctx, payload) { return { ok: true }; } },
};
```
`ctx` = `{ name, dir, version, installedVersion, config, db, storage, logger, http, httpJson }`.

**Action RPC.** `POST /api/v1/plugins/:name/action/:action` (admin) dispatches to
`server.js` `actions[action](ctx, payload)` and returns its JSON. This is the
sanctioned way for a plugin to expose backend logic (a plugin can't register its
own routes). Not txn-wrapped (actions usually make external HTTP calls); an action
that writes plugin tables should manage its own transaction. Client SDK:
`cms.plugins.action(name, action, payload)`. Reference plugins: **GiveButter**
(`docs/how-it-works/GIVEBUTTER.md`) and **Shopify** (`docs/how-it-works/SHOPIFY.md`) — the latter an
**override-style** plugin that takes over the whole Shop feature (public storefront
+ admin) via the action-RPC and a frontend `shopifySource` seam gated on
`isPluginEnabled('shopify')`.
- `ctx.db` — `query(sql,params)`, `tableName(suffix)` → `plugin_<name>_<suffix>`, `migrate()`.
- `ctx.storage` — `dir`, `dataDir`, `read/write/exists`, `download(url, rel, {force})`.
- `ctx.httpJson(url, {method, headers, jsonBody})` — JSON HTTP with a normalized
  `{ ok, status, data } | { ok:false, status, error }` envelope (never throws). The
  sanctioned way to call a third-party JSON/GraphQL API without re-implementing
  fetch+error handling (GiveButter/Shopify plugins use it).
- **Idempotency:** check `ctx.installedVersion` + actual state before acting; never overwrite existing data. `update()` applies only the forward delta.

### `client.js` — framework-agnostic browser module
Default-export; **must not import `solid-js`** (mount via plain DOM):
```js
export default {
  mountWidget(el, host) { /* public-site widget; return teardown */ },
  mountConfig(el, host) { /* admin config page; return teardown */ },
};
```
`host` = `{ name, config, settings, user, isAdmin, saveConfig(patch), api, mountPoint, onCleanup(fn), ui }`.
`host.ui.form(cfg)` → `{ group, input, select, checkbox }` — admin-styled, config-bound
DOM builders so a `mountConfig` page doesn't redefine them (`const { input } = host.ui.form(cfg)`).
Bundles are served **same-origin** (`/api/v1/plugins/<name>/client.js`) and loaded via
dynamic `import()`, so they satisfy the admin SPA's `scriptSrc 'self'` CSP.

### Content-Security-Policy
The host CSP (production) is **extended while a plugin is enabled** so its widget
can reach its backend. Origins of the plugin's `type:'url'` config values are
added to `connect-src` automatically (e.g. PageLoop's `endpoint` →
`https://pageloop.dev`); for anything the config doesn't cover — a CDN the widget
loads scripts/styles/images/iframes from — declare static origins in the manifest
`csp` block (`{ connectSrc?, scriptSrc?, styleSrc?, imgSrc?, frameSrc? }`). The
policy is recomputed on every enable/disable/configure/uninstall + at boot.

## Lifecycle

`discovered → installed → enabled ⇄ disabled → (uninstalled)`. Hooks run in a
transaction with a `pg_advisory_xact_lock('plugin:<name>')`. Enabling the widget
respects the per-plugin `adminOnly` config (mounts only for signed-in admins).

Public widgets mount from a **single host at the app root** (`App.tsx`), above
both the public `Layout` and the `AdminLayout`. So a widget loads on every
route — public *and* admin — persists across client-side navigation, and is
restored after a hard refresh on either side. Because there is exactly one host
(and `client.js` is dynamically imported once, cached by URL), a widget can
never be mounted twice; plugins that inject global DOM (e.g. a floating toolbar)
should still guard against a duplicate `init()` defensively.

## Packaging a plugin

A plugin is a **folder**, not a repo clone: `plugin.json` (the manifest — the
required structure) + `server.js` + `client.js` (+ optional `README.md`). No
build step. The vendor bundle in `client/` is optional — a plugin's `install()`
hook can fetch it. Build an uploadable zip with:

```bash
npm run plugin:pack <plugin-dir>     # e.g. plugin:pack plugins/pageloop → pageloop-<v>.zip
```

The zip has `plugin.json` at its root (the installer also accepts it one level
down) and includes `client/` when present (self-contained).

## Install paths

- **Manual:** drop a folder into `PLUGINS_DIR`, then Admin → Plugins → **Rescan**
  (or restart — boot rescans).
- **Upload:** Admin → Plugins → **Upload .zip** (path-traversal guarded; registered disabled).
- **Marketplace:** lists the **first-party catalog bundled inside `@sitesurge/server`**
  (`dist/plugins-catalog/`, produced by the build from `plugins/*` minus vendor
  bundles). **Install** copies the plugin into the consumer's `PLUGINS_DIR` and
  runs the normal install lifecycle — one click, no plugin source needed in the
  consumer repo. (An open third-party registry can later extend
  `marketplaceInstall` to fetch a `downloadUrl` zip through the same path.)

## API + SDK + MCP

- Routes under `/api/v1/plugins` — **admin-only** except `GET /plugins/enabled`
  and the `client.js`/`assets` reads (public, so the site self-loads widgets).
  Mounted feature-gated (`plugins`) → 404 when disabled.
- SDK/client: `cms.plugins.*` (`list`, `getByName`, `install`, `saveConfig`,
  `enable`, `disable`, `update`, `uninstall`, `upload`, `rescan`, `marketplaceSearch`).
- MCP: `list_plugins`, `get_plugin`, `install_plugin`, `configure_plugin`,
  `enable_plugin`, `disable_plugin`, `update_plugin`, `uninstall_plugin`,
  `rescan_plugins`, `search_plugin_marketplace` (all mutations `write`).

## Where plugins live + config

`PLUGINS_DIR` (env, default `./plugins` from cwd) — in the **consumer project**
so plugins survive `@sitesurge/server` npm upgrades. In the monorepo it resolves
to `packages/api/plugins/`.

## Security (v1)

Plugin backend code runs **trusted, in-process** (WordPress-style; not sandboxed).
Mitigations: admin-only management, zip path-traversal/symlink guards, plugin DB
access scoped to `plugin_<name>_*`, same-origin-only client bundles, per-plugin
boot error isolation. Worker/VM sandboxing + signed marketplace bundles are future work.
