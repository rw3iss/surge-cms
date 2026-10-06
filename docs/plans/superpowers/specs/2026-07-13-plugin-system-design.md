# Plugin System — Design & Plan

**Status:** Design / proposed (2026-07-13)
**Goal:** A first-class **Plugins** system for Surge CMS — modeled on the existing **Features** module system, but for open-ended, admin-installable, third-party extensions. Ships as a gated feature, adds an `/admin/plugins` section, supports install / enable / disable / uninstall / **update** lifecycle hooks, per-plugin custom config pages, a public-site widget mount, a (stubbed) marketplace + zip-upload flow, and full SDK + MCP integration. First demo plugin: **PageLoop** (re-integrating the commenting library that's currently hardcoded).

---

## 1. Scope & principles

**What a plugin is:** a self-contained folder under a host `plugins/` directory containing a manifest, a Node-side module (lifecycle hooks), and a browser-side ESM bundle (widget + config UI). Plugins are **admin-installed and trusted** (WordPress-style), not sandboxed in v1 — see §9 security.

**Design principles (locked by the codebase exploration):**

1. **Framework-agnostic plugin client code.** Plugin browser bundles **must not import their own `solid-js`** — Solid's reactivity/Context is singleton-per-module-instance, so a plugin's `useAuth()`/Router context would resolve `undefined`. Plugins expose a plain **`mount(el, host)` / `unmount()`** DOM contract and receive everything they need via a **host-provided context object** (`host.user`, `host.isAdmin`, `host.config`, `host.saveConfig`, `host.api`, `host.settings`). This is more robust *and* fits PageLoop's pure-DOM `@pageloop/vanilla` renderer.
2. **Same-origin client bundles.** Plugin JS is served from `/api/v1/plugins/:name/client.js` (the backend already serves the SPA on the same origin), so it passes the existing production CSP `scriptSrc 'self'` with **zero CSP changes**. Third-party/CDN bundles are explicitly out of scope (would need CSP edits). Load via `import(/* @vite-ignore */ url)` so the bundler leaves it as a native runtime import.
3. **Data-driven, not hand-synced.** Unlike Features (whose frontend catalog `config/features.ts` is a hand-maintained mirror of the backend registry, over a closed `FeatureKey` union), the plugin list is **dynamic** and served from the API. The frontend never hardcodes plugin identities.
4. **Model the lifecycle on Features, but scope ownership to the plugin.** Reuse the proven enable→migrate→disable→uninstall transaction pattern (`installFeatureStep`/`uninstallFeature`), but each plugin owns its own tables/data/config and its hooks run in isolation with explicit idempotency contracts.
5. **The Plugins system is itself a Feature** (`plugins`), toggled from Settings → Features like the others. Off by default. Enabling it creates the `plugins` table and reveals the `/admin/plugins` nav item.

---

## 2. Anatomy of a plugin

```
plugins/
  pageloop/
    plugin.json          # manifest (required)
    server.js            # Node module — lifecycle hooks (CommonJS; required)
    client.js            # browser ESM bundle — mount/unmount + config UI (optional)
    client/              # static assets served under /api/v1/plugins/pageloop/assets/*
    migrations/*.sql     # optional plugin-owned SQL (namespaced; see §5)
    README.md
```

### 2.1 `plugin.json` manifest

```jsonc
{
  "name": "pageloop",                         // unique id == folder name (kebab)
  "label": "PageLoop Comments",
  "description": "Drop-in commenting / annotation layer.",
  "version": "0.1.0",
  "author": "Surge CMS",
  "homepage": "https://pageloop.dev",
  "apiVersion": 1,                            // plugin API contract version (host checks compatibility)
  "server": "server.js",                     // Node entry (optional)
  "client": "client.js",                     // browser entry (optional)
  "capabilities": ["public-widget", "config-page"],  // declares what it provides
  "adminOnlyToggle": true,                    // exposes the "admins only" visibility option
  "configSchema": [                           // declarative config (host renders a form if no custom mountConfig)
    { "key": "endpoint", "label": "Server endpoint", "type": "url", "required": true, "default": "https://pageloop.dev" },
    { "key": "projectId", "label": "Project ID", "type": "string", "required": true },
    { "key": "installType", "label": "Storage", "type": "select", "options": ["remote", "local-sqlite"], "default": "remote" },
    { "key": "publicComments", "label": "Allow public commenting", "type": "boolean", "default": false },
    { "key": "adminOnly", "label": "Show only to signed-in admins", "type": "boolean", "default": false }
  ]
}
```

### 2.2 `server.js` — Node lifecycle contract

CommonJS module exporting an object (or factory). Every hook is **optional** and receives a `PluginServerContext`. All hooks must be **idempotent** and must **self-detect prior state** (never overwrite/corrupt existing data):

```ts
interface PluginServerContext {
  name: string;
  dir: string;                       // absolute path to this plugin's folder
  version: string;                   // manifest version
  installedVersion: string | null;   // version recorded in DB (null on first install)
  db: PluginDb;                       // scoped query helper (see §5) — NOT a raw pool
  config: Record<string, unknown>;   // current saved config
  logger: Logger;
  storage: PluginStorage;            // read/write files under the plugin's own dir + a data dir
  http: typeof fetch;                // for downloading deps/code
}

interface PluginServerModule {
  install?(ctx): Promise<void>;      // first-time setup (download deps, create tables/data). Idempotent.
  uninstall?(ctx): Promise<void>;    // remove owned tables/data. Idempotent.
  onEnable?(ctx): Promise<void>;     // when toggled on
  onDisable?(ctx): Promise<void>;    // when toggled off
  onLoad?(ctx): Promise<void>;       // on every server boot for ENABLED plugins (register routes/crons/etc.)
  update?(ctx): Promise<UpdateResult>; // pull latest code + migrate data; re-run init as needed. Idempotent.
  routes?: RouteDef[];               // optional: plugin-contributed API routes, mounted under /api/v1/plugins/:name/*
  validateConfig?(cfg): { ok: boolean; errors?: Record<string,string> };
}
type UpdateResult = { fromVersion: string; toVersion: string; migrated: boolean; notes?: string };
```

**Idempotency contract (critical, per the request):** `install`/`update` MUST check `ctx.installedVersion` and probe actual state (files present? tables exist?) before acting, and MUST NOT clobber existing config or data. `update` compares `ctx.installedVersion` → `ctx.version`, performs only the forward delta, and returns what it did.

### 2.3 `client.js` — browser contract (framework-agnostic)

ESM default export, served same-origin, loaded via dynamic `import()`. No `solid-js` import.

```ts
interface PluginHost {
  name: string;
  config: Record<string, unknown>;    // current plugin config
  settings: PublicSettings;           // site appearance/settings snapshot
  user: { id: string; role: string } | null;
  isAdmin: boolean;
  saveConfig(patch): Promise<void>;    // admin config page → persists (admin only)
  api: { get(path): Promise<any>; post(path, body): Promise<any> }; // scoped to /api/v1/plugins/:name/*
  mountPoint: HTMLElement;
  onCleanup(fn): void;
}

export default {
  // Global public-site widget (optional). Called on each public page if enabled + visibility allows.
  mountWidget?(el: HTMLElement, host: PluginHost): void | (() => void),
  // Admin per-plugin config page (optional). If absent, host renders the declarative configSchema form.
  mountConfig?(el: HTMLElement, host: PluginHost): void | (() => void),
};
```

Returning a function = teardown (SolidJS `onCleanup` calls it). This is the seam that keeps plugins isolated from the host's Solid graph.

---

## 3. Lifecycle & state machine

Per-plugin DB state: `discovered → installed → enabled ⇄ disabled → (uninstalled)`.

| Action | Trigger | Server hooks | DB effect |
|---|---|---|---|
| **Discover** | boot scan / upload / marketplace install | — | insert row `installed=false`, `enabled=false`, record version+location |
| **Install** | admin "Install" | `install()` | mark installed; run plugin migrations; record `installed_version` |
| **Enable** | admin toggle | `onEnable()` then `onLoad()` | `enabled=true` |
| **Disable** | admin toggle | `onDisable()` | `enabled=false` (data preserved) |
| **Update** | admin "Update" | `update()` | bump `version`/`installed_version`, record notes |
| **Uninstall** | admin type-to-confirm | `uninstall()` | drop owned tables, delete config, remove row (optionally delete folder) |
| **onLoad** | every boot | `onLoad()` for each enabled plugin | none |

Mirrors the Features flow (`installFeatureStep` → migrations → `onEnable`; `uninstallFeature` → `onUninstall` → drop → delete rows), transaction-wrapped with an advisory lock keyed `plugin:<name>`.

---

## 4. Backend architecture

New module `plugins` added end-to-end (repo → service → route → DTO → sdk → client → MCP), per the standard checklist.

### 4.1 The `plugins` feature
- Add `'plugins'` to `FeatureKey` (backend `features/registry.ts`, frontend `config/features.ts`, shared `SiteFeatures`).
- `FEATURE_REGISTRY.plugins`: `{ key:'plugins', label:'Plugins', defaultEnabled:false, migrations:['0NN_create_plugins.sql'], tables:['plugins'], onEnable: seed no-op }`. Tagged migration `-- @feature plugins`.
- Enabling it (Settings → Features) creates the `plugins` table and flips `plugins_enabled`.

### 4.2 DB schema (`plugins` table)
```sql
-- @feature plugins
CREATE TABLE IF NOT EXISTS plugins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(64) UNIQUE NOT NULL,   -- == folder name
  label         VARCHAR(160) NOT NULL,
  version       VARCHAR(32) NOT NULL,          -- manifest version on disk
  installed_version VARCHAR(32),               -- version install()/update() last ran for
  source        VARCHAR(16) NOT NULL DEFAULT 'manual', -- manual | upload | marketplace
  location      TEXT NOT NULL,                 -- relative path under PLUGINS_DIR
  installed     BOOLEAN NOT NULL DEFAULT false,
  enabled       BOOLEAN NOT NULL DEFAULT false,
  config        JSONB NOT NULL DEFAULT '{}',
  manifest      JSONB NOT NULL DEFAULT '{}',   -- cached plugin.json
  error         TEXT,                          -- last load/install error (for the table's status column)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```
Plugin-owned tables (created by the plugin's own migrations/`install`) are **prefixed** `plugin_<name>_*` and dropped on uninstall — never interpolate un-prefixed identifiers (closes the Features caveat #7).

### 4.3 Plugin loader/registry (`packages/api/src/plugins/`)
- **`PLUGINS_DIR`** env (default `./plugins` resolved from `process.cwd()`), so it lives in the **consumer project** (survives `@sitesurge/server` npm upgrades) — for rw-cms dev it's `packages/api/plugins/`.
- `discoverPlugins()` — scan `PLUGINS_DIR`, read each `plugin.json`, validate `apiVersion`, reconcile with DB rows (insert new as `discovered`, mark missing-on-disk).
- `loadPlugin(name)` — `require()` the `server.js` (cached), build `PluginServerContext`.
- `runHook(name, hook, ...)` — transaction + `pg_advisory_xact_lock(hashtext('plugin:'+name))`, error captured to `plugins.error`.
- `bootPlugins()` — called from `bootRunningMode()` after migrations: for each `enabled` plugin, `onLoad()` (and mount its `routes`). A failing plugin is isolated (logged, `error` set) and never crashes boot.
- `pluginDb(name)` — a scoped query wrapper that only permits DDL/DML on `plugin_<name>_*` tables (validates identifiers).

### 4.4 Routes (`/api/v1/plugins`) — auth tiers
| Method + path | Auth | Purpose |
|---|---|---|
| `GET /plugins/enabled` | **public** | inherent: list enabled plugins + client bundle URLs + public config subset (for the site to self-load) |
| `GET /plugins/:name/client.js` | public | serve the plugin's browser bundle (same-origin) |
| `GET /plugins/:name/assets/*` | public | serve static plugin assets |
| `GET /plugins` | **admin** | full list (table view) |
| `GET /plugins/:name` | admin | one plugin (detail + config + schema) |
| `POST /plugins/:name/install` | admin | run `install()` |
| `PUT /plugins/:name/config` | admin | save config (validated) |
| `POST /plugins/:name/enable` \| `/disable` | admin | toggle |
| `POST /plugins/:name/update` | admin | run `update()` |
| `POST /plugins/:name/uninstall` | admin | `{confirm:true}` → `uninstall()` + drop |
| `POST /plugins/upload` | admin | multipart zip → unzip to `PLUGINS_DIR` → discover (disabled) |
| `GET /plugins/marketplace` | admin | **stubbed** search |
| `POST /plugins/marketplace/:id/install` | admin | **stub**: copy code → `PLUGINS_DIR` → register |
| `POST /plugins/:name/*` (plugin routes) | per-route | plugin-contributed API |

Everything except the two inherent public reads is **admin-only**. The module is mounted feature-gated: `registerModule('plugins', pluginsRoutes, { mountPath:'/api/v1/plugins', feature:'plugins' })` — disabled ⇒ 404.

### 4.5 Upload flow
`POST /plugins/upload` (multer, zip only, size-limited) → safe-unzip (path-traversal guarded, reject symlinks) into `PLUGINS_DIR/<name>/` → validate `plugin.json` → `discoverPlugins()` → row inserted `installed=false, enabled=false`. Admin then Installs → Enables.

---

## 5. Plugin-owned migrations

Plugins ship `migrations/*.sql` in their folder. On `install()`/`update()` the loader applies unapplied files, recording them in a plugin-scoped ledger:
```sql
CREATE TABLE IF NOT EXISTS plugin_migrations (
  plugin VARCHAR(64) NOT NULL, filename VARCHAR(255) NOT NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (plugin, filename)
);
```
This avoids the core's single globally-sorted `schema_migrations` directory (Features caveat #5) — plugin migrations are namespaced and never collide with core numbering. Uninstall deletes the plugin's `plugin_migrations` rows and drops its `plugin_<name>_*` tables.

---

## 6. Frontend architecture

### 6.1 Feature flag + nav
- `config/features.ts`: add `'plugins'` to `FeatureKey` + a `FEATURES` entry (`{ key:'plugins', label:'Plugins', description:'External plugins & extensions.' }`).
- `AdminLayout.tsx` `NAV_ITEMS`: insert `{ path:'/admin/plugins', label:'Plugins', icon:'developer', feature:'plugins' }` **immediately before** the Settings item; add `'plugins'` to the `NavItem.feature` union. Gated by `isFeatureEnabled('plugins')` (flashes in after `/settings/public` resolves — matches Shop behavior).

### 6.2 Pages
- `pages/admin/Plugins.tsx` → `/admin/plugins`: table of installed plugins (name, version, source, status badge, enabled toggle, Update button when a newer disk version exists, row → config). "Upload plugin (.zip)" button + "Browse marketplace" (stub modal). Uses `cms.plugins.list()`, `cms.plugins.enable/disable/update/upload`.
- `pages/admin/PluginConfig.tsx` → `/admin/plugins/:name`: loads the plugin, shows status + install/enable controls, then renders its config page:
  - If the plugin's `client.js` exports **`mountConfig`** → dynamically `import(/* @vite-ignore */ '/api/v1/plugins/:name/client.js')` and call `mountConfig(el, host)`.
  - Else → host renders a form from the declarative `configSchema` (a small `PluginConfigForm` component).
  - Save → `cms.plugins.saveConfig(name, patch)`.

### 6.3 Dynamic client loader (`services/pluginLoader.ts`)
A tiny host runtime that: fetches `GET /plugins/enabled`, and for each plugin with a widget, dynamically imports its `client.js` and calls `mountWidget(el, host)` inside a host-managed container. Caches modules by URL+version. Builds the `PluginHost` object from the auth store (`useIsAdmin`), `siteSettings()`, and a scoped fetch. Teardown via returned cleanup fns.

### 6.4 Public widget mount
In `components/layout/Layout.tsx`, after `<Footer>` inside `.layout`, render `<PluginWidgetHost />` — a component that (only when `isFeatureEnabled('plugins')`) runs the loader for plugins declaring `public-widget`. Per-plugin visibility: if the plugin's `adminOnly` config is true, the widget mounts **only when `useIsAdmin()()` is true**; otherwise for everyone. The host passes `{ user, isAdmin, config, settings }` so the plugin itself can further gate.

---

## 7. SDK + MCP integration

- **Shared** `packages/shared/src/types/plugin.ts` (`Plugin`, `PluginManifest`, `PluginConfigField`, `PluginStatus`) + `api/routes/plugins.ts` DTOs; barrel both.
- **Backend** repo `plugins.repo.ts`, service `services/plugins.ts` (wraps the loader/registry + audit), `sdk/plugins.ts` shim, add to `sdk/index.ts`, routes `routes/plugins.ts`, mount in `routes/index.ts`.
- **Client** `cms-client/src/modules/plugins.ts` (`PluginsModule`) + assembly + `ROUTE_COVERAGE` entries + `check:drift`.
- **MCP** `cms-mcp/src/tools/plugins.ts`: `list_plugins` (read), and `write:true` admin tools `install_plugin`, `enable_plugin`, `disable_plugin`, `update_plugin`, `uninstall_plugin`, `configure_plugin`, `upload_plugin` (path/base64 zip), `search_plugin_marketplace` (stub). All authorize via the configured `ssk_` admin key (there's no separate admin flag — admin scope = the key's scope). Add to `allTools()`.

**Permissions matrix:** all management actions **admin-only**. The two inherent reads (`GET /plugins/enabled`, `client.js`/assets) are **public** so the running site loads widgets without auth. `configure/install/update/uninstall/enable/disable/upload` require admin (JWT or admin-scoped `ssk_`).

---

## 8. The PageLoop demo plugin

### 8.1 Remove the current hardcoded integration first
Per the exploration, delete: the two root `package.json` deps (`@pageloop/client`, `@pageloop/vanilla`); the `PageLoopProvider` import + CSS import + wrapper in `packages/cms/src/App.tsx` (and the unused `usePageLoop` import); the `optimizeDeps.exclude: ['@pageloop/*']` line in `config/cms/vite.config.ts`; leave `.gitignore` `.pageloop/`/`pageloop.json` (still used by the plugin's local mode); `pnpm install` to prune the lockfile.

### 8.2 Plugin `plugins/pageloop/`
- **Client bundle strategy:** PageLoop's `@pageloop/vanilla` is a **pure-DOM renderer** (no Solid) — ideal. The plugin's `install()` downloads the PageLoop **vanilla widget bundle** (`pageloop.js` + `vanilla.css`) — either from the configured `endpoint` (`<endpoint>/pageloop/pageloop.js`, the loader path) or from npm/unpkg — into `plugins/pageloop/client/` (idempotent: skip if present + version matches). `client.js` then imports that local bundle and mounts `VanillaRenderer` with the `PageLoop` headless core using the configured `endpoint`/`projectId`. This avoids bundling Solid and satisfies same-origin CSP (bundle served from `/api/v1/plugins/pageloop/assets/pageloop.js`).
- **`mountWidget(el, host)`**: reads `host.config` (endpoint, projectId, publicComments, adminOnly); if `adminOnly` and `!host.isAdmin` → no-op; else `new PageLoop({endpoint, projectId, token?}, {renderer:new VanillaRenderer()}).start()`; returns teardown that unmounts.
- **`mountConfig(el, host)`**: renders the config form (or we use the declarative `configSchema` — the demo will use a **custom `mountConfig`** to fully exercise the plugin config-page API, showing live connection status via `host.api`).
- **Config options** (from PageLoop's `PageLoopConfig` + `pageloop.json`): `installType` (`remote` | `local-sqlite`), `endpoint`, `projectId`, `publicComments`, `token` (SSO), `ui.toolbarPosition`/`sidebarPosition`/`theme`, `transport`, and the host-level **`adminOnly`** visibility toggle (show widget only to signed-in admins). `local-sqlite` mode surfaces the `dbUrl`/`port` and notes it needs the PageLoop server running locally.
- **`update()`**: re-downloads the widget bundle for the pinned channel, records the new version, no data touched.
- **Role-gating**: when `adminOnly` is on, the widget mounts only for `host.isAdmin`. For per-comment auth, PageLoop takes an SSO `token`; the plugin can mint one from the CMS session (deficiency — see §9).

---

## 9. PageLoop deficiencies (separate doc to author)

Write `docs/plans/completed/pageloop-plugin-deficiencies.md` capturing gaps found for a clean dynamic-install workflow, e.g.: (a) config is currently **build-time hardcoded** in the provider — need runtime config injection / a documented headless+vanilla path with no framework wrapper; (b) no first-class **SSO token endpoint** to bridge the host's logged-in user/role into PageLoop for admin-only/role-gated comments; (c) the framework wrappers **lazy-load `@pageloop/vanilla` and require `solid-js`**, unsuitable for isolated plugin loading — the vanilla `VanillaRenderer` path should be the documented, first-class integration for embedders; (d) widget bundle discovery (`<endpoint>/pageloop/pageloop.js`) vs npm pinning should be a documented, versioned contract for third-party hosts; (e) `local-sqlite` mode assumes a CLI-managed local server — needs an embeddable/programmatic start for host-managed installs.

## 10. Security posture (v1)
Plugins run **trusted, in-process** Node code (admin-installed) — documented explicitly; not sandboxed. Mitigations: admin-only management; zip-upload path-traversal + symlink guards; plugin DB access scoped to `plugin_<name>_*`; client bundles same-origin only (CSP unchanged); per-plugin error isolation on boot. A future hardening pass (worker/VM isolation, capability manifest, signed marketplace bundles) is noted but out of scope.

---

## 11. Implementation plan (phased)

1. **Core plumbing** — `plugins` feature + migration + `plugins` table; loader/registry (`discover/load/runHook/bootPlugins/pluginDb`); `PLUGINS_DIR`. Backend module (repo/service/routes/DTO/sdk) with the auth matrix; serve `client.js`/assets. Unit tests for lifecycle + idempotency.
2. **Frontend** — feature flag + nav; `/admin/plugins` table (+ upload + marketplace-stub modal); `/admin/plugins/:name` config page with the dynamic `mountConfig` loader + declarative-schema fallback; `pluginLoader` + `PluginWidgetHost` in `Layout`.
3. **SDK + MCP** — client module + drift entries; MCP admin tools.
4. **PageLoop plugin** — remove the hardcoded integration; build `plugins/pageloop/` (manifest, `server.js` with download/install/update, `client.js` vanilla mount + custom config page); wire the config options + admin-only gating; author the deficiencies doc.
5. **Docs** — README/CLAUDE Plugins section; `docs/how-it-works/PLUGINS.md` (authoring guide + the plugin API contract); regenerate `docs/API.md`.

## 12. Open decisions (need sign-off)
1. **Config-page model** — support **both** a declarative `configSchema` (host-rendered form, safe/simple) **and** an optional custom `mountConfig` (full control). PageLoop demo uses custom `mountConfig`. *(Recommended: both.)*
2. **Plugin backend code = trusted in-process** (WordPress model) for v1, sandboxing deferred. *(Recommended; flagged in §10.)*
3. **`PLUGINS_DIR` location** — consumer-project `./plugins` (default), `packages/api/plugins/` in the monorepo dev. *(Recommended.)*
4. **PageLoop client bundle source** — download the **vanilla** bundle into the plugin dir on install (from `endpoint` or npm), serve same-origin. *(Recommended over bundling Solid wrappers.)*
5. **Marketplace** — fully stubbed (static list + copy-from-local) in v1; real registry later.
</content>
