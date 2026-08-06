# PageLoop — deficiencies for a clean plugin-style integration

Found while building the **PageLoop plugin** (`packages/api/plugins/pageloop/`) for
the SiteSurge plugin system. These are changes to **PageLoop itself** that would
make a dynamic-install, host-embedded, per-tenant-configured integration coherent
and enterprise-grade. None block the plugin today (we worked around each), but
addressing them would remove the workarounds.

## 1. Build-time-only config in the framework wrappers
The `@pageloop/client/{react,preact,solid}` wrappers take config as a
**component prop** (`<PageLoopProvider config={{ endpoint, projectId }}>`), which
bakes the endpoint/project into the app bundle. A CMS plugin is configured at
**runtime** (per site, stored in the DB). **Ask:** document `PageLoop.init(config)`
(the vanilla path) as the first-class embedder API, and/or allow the provider to
accept a config **thunk/async loader** resolved at runtime.

## 2. Framework wrappers require a shared `solid-js`/`react` singleton
The wrappers lazy-load `@pageloop/vanilla` and depend on the host's framework
runtime. A dynamically-loaded plugin bundle cannot safely share the host's Solid
singleton (context/reactivity break). We used the **vanilla `VanillaRenderer` /
UMD `PageLoop.init()`** path instead. **Ask:** make the **vanilla/UMD bundle +
`PageLoop.init()`** the documented, supported integration for embedders (it is
the only framework-neutral path), with a stable, versioned global contract.

## 3. Widget-bundle distribution contract
Embedders need a **stable URL/versioned artifact** for the widget bundle. Today
it's served from a running PageLoop server (`<endpoint>/pageloop/pageloop.umd.js`)
or pulled from npm/CDN. We download the CDN UMD build at install time. **Ask:**
publish a documented, immutable, versioned CDN path (e.g.
`cdn.pageloop.dev/vanilla/<version>/pageloop.umd.js`) and a documented UMD global
+ `init()` signature as a **public API** (so hosts can pin/verify integrity).

## 4. No host-SSO token bridge for role-gated comments
To show the widget "only for signed-in admins" (or to identify the CMS's logged-in
user to PageLoop), PageLoop takes a pre-issued JWT `token`. There is no documented
way to **mint that token from the host session**. **Ask:** a documented SSO flow —
a shared-secret signing spec (or an endpoint that exchanges a host session for a
PageLoop token) so the host can pass `token` reflecting the CMS user + role, and
PageLoop can enforce role-based comment permissions.

## 5. `local-sqlite` mode assumes a CLI-managed server
"Local" mode (`pageloop go`, SQLite under `.pageloop/`) assumes an operator runs
the CLI separately. A host-managed install would prefer to **start/embed** the
PageLoop server programmatically. **Ask:** an embeddable server entry
(`createServer({ dbUrl })`) the host can supervise, or a documented sidecar
contract, so the plugin can offer a true one-click local mode.

## 6. Teardown / imperative lifecycle on the vanilla instance
`PageLoop.init()` returns an instance; the plugin needs a reliable
`instance.destroy()` to unmount cleanly on disable/navigation. **Ask:** guarantee
and document `destroy()` (idempotent) on the returned instance for the vanilla
build, plus a `reconfigure(config)` for live config changes without a full reload.
