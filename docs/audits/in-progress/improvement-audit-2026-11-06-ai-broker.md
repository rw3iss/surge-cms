# Improvement audit 2026-11-06 — AI module, claude-broker plugin, plugin system

Scope: `services/ai/**`, `routes/ai.ts`, `plugins/claude-broker/**`, the plugin action RPC + admin plugin routes, plugin widget visibility / remount / PageLoop teardown, Settings → AI, `docs/how-it-works/AI.md` + `PLUGINS.md` (commits since f28ea8ae). No migrations were needed (206–207 unused).

| # | Title | Risk | Status |
|---|-------|------|--------|
| 1 | Plugin credentials sent to the browser / MCP / API keys | B | applied |
| 2 | Claude sign-in token could reach the browser | A | applied |
| 3 | `plugins:manage` declared but never checked | B | applied |
| 4 | Every AI route 403'd an API key | A | applied |
| 5 | Pool status counted usage-limited / signed-out sessions as healthy | B | applied |
| 6 | "No session is attached" when sessions were attached but unusable; explicit session not health-checked | A | applied |
| 7 | Polled jobs lost the session label | A | applied |
| 8 | Plugin config page test prompt waited 120 s through a 60 s proxy | B | applied |
| 9 | No Cancel for a running test prompt (Settings → AI and plugin page) | A | applied |
| 10 | Settings → AI showed a Save that always 403'd without `ai:manage` | A | applied |
| 11 | Pool count limits disagreed (64 / 16 / unbounded) | A | applied |
| 12 | Widget mount race: unmounted before the bundle loaded → widget mounted with no teardown | B | applied |
| 13 | A failed login / session refresh tore down and remounted every widget | A | applied |
| 14 | Setup script: ExecStartPre could fail the start; env file overwritten; root run; `grep -P` | A | applied |
| 15 | Anthropic over HTTP is cut at 55 s with no job to poll | C | planned |
| 16 | Broker `ask()` waits only the plugin Wait timeout (120 s) | A | documented |
| 17 | Admin `PluginConfig.tsx` has the same async-mount race as #12 | A | lead follow-up |

## Findings

### 1. Plugin credentials sent to the browser, MCP and API keys
- **Location:** `packages/api/src/services/plugins.ts` `withUpdateFlag` / `getOne` / `list` / `saveConfig`.
- **Problem:** Every admin read (`GET /plugins`, `GET /plugins/:name`, every lifecycle response, MCP `get_plugin`) returned the raw `config`, including `type: 'secret'` values: the claude-broker token, GiveButter API key, Shopify storefront/admin tokens, Printify key. Any XSS in the admin, a leaked admin session or a read-scope API key exposed them.
- **Fix:** `maskPluginSecrets()` replaces every set `type: 'secret'` value with `••••••••` in all outward plugin rows; `saveConfig` drops an echoed mask (`dropEchoedSecrets`) so saving an untouched form keeps the stored value, `''` still clears it. `secret: true` on other field types is NOT masked — it only means "not public" and claude-broker uses it on fields its page must edit (pools, URL). Server code reads the repo row, so actions are unaffected. Every plugin config page that renders the token as a password input keeps working (claude-broker already only sends the token when edited).
- **Status:** applied; test `services/plugins.secrets.test.ts`.

### 2. Claude sign-in token could reach the browser
- **Location:** `plugins/claude-broker/server.js` `setupStatus` (`out.auth = auth.data`) and `loginSubmit` (`token: r.data.token`).
- **Problem:** Both passed the broker's `/auth` payload straight to the config page. If a broker version includes the token value there, the long-lived Claude credential every session uses lands in the admin browser.
- **Fix:** `lib.authView()` whitelists `claude {installed, version, path}`, `token {set, created_at, expires_at}`, `login {pending, url, error}`; `loginSubmit` returns only `{ set, created_at, expires_at }`.
- **Status:** applied; tested (`authView never passes the token value through`).

### 3. `plugins:manage` declared but never checked
- **Location:** `packages/api/src/routes/plugins.ts`.
- **Problem:** The catalog defines `plugins:manage` (default admin) but no route checked it, so an operator could not narrow plugin management (including the action RPC, which can start/stop Claude sessions or call third-party APIs with stored keys).
- **Fix:** every admin plugin route (reads, lifecycle, upload, marketplace, config, action RPC) calls `requirePermission(…, 'plugins:manage')` for JWT users; API keys pass on their tier scope. Defaults keep today's access.
- **Status:** applied.

### 4. Every AI route 403'd an API key
- **Location:** `packages/api/src/routes/ai.ts` `use`.
- **Problem:** The `staff` tier accepts `ssk_` keys, but the handler then ran `requirePermission({id:null, role:null}, 'ai:use')` → 403. The in-admin help shows curl examples with `Bearer ssk_…` that could never work.
- **Fix:** `allow(key)` skips the user permission when the request came in on an API key (scope already enforced by the tier); applied to `ai:use` and `ai:manage` routes.
- **Status:** applied.

### 5. Pool status counted unusable sessions as healthy
- **Location:** `plugins/claude-broker/lib.js` `poolStatus`; `services/ai/providers/broker.ts` `status`.
- **Problem:** Routing already skipped `usage_limited` / `login_required` / … sessions, but status reported `healthy = attached >= expected` and the provider as "ready" — Settings → AI showed green while every request failed with 503.
- **Fix:** `AiPool.ready` (attached AND healthy), `idle` = ready and not busy, `healthy = ready >= expected`; each session carries `healthy` + `state`. The broker provider reads "Sessions are attached, but none can take a job now…" when nothing is ready. Settings → AI shows a **Ready** column (`ready/expected (N attached)`, states in the tooltip); the plugin page shows ready counts and per-session states.
- **Status:** applied; `AiPool` DTO extended (`ready`, session `healthy`/`state`).

### 6. Misleading "no session attached"; explicit session not health-checked
- **Location:** `server.js` `resolveTarget`.
- **Fix:** `lib.noSessionReason()` — "No session in pool "x" can take a job right now (stopped: Claude usage limit reached …)". A request naming a `session` that cannot work is refused 503 with its state instead of queuing a job that expires.
- **Status:** applied; tested.

### 7. Polled jobs lost the session label
- **Location:** `lib.js` `normalizeJob`, `server.js` `submit`.
- **Problem:** `sessionLabel` (→ `AiResult.model`) was only added on the submit response; `GET /ai/jobs/:id`, `jobs` and `wait` came back `model: null`.
- **Fix:** the plugin records `session: <label>` in the job meta; `normalizeJob` reads it.
- **Status:** applied; tested.

### 8. Plugin page test prompt behind a proxy
- **Location:** `plugins/claude-broker/client.js` test section.
- **Problem:** `submit` with `wait: true` and no timeout used the plugin Wait timeout (120 s) inside one HTTP request — nginx closes the upstream at 60 s → a 504 for any slow answer.
- **Fix:** submit with `wait: false`, then poll the `wait` action ≤ 50 s per request (up to 10 min), keeping the session label.
- **Status:** applied.

### 9. No Cancel for a running test prompt
- **Fix:** Cancel button on both test prompts (plugin page: available as soon as the job id is known; Settings → AI: while a broker job is still running after the first wait) → `cancel` action / `cms.ai.cancel`. Settings → AI also lists the job's progress notes.
- **Status:** applied.

### 10. Settings → AI without `ai:manage`
- **Problem:** A staff member with `ai:use` only saw the provider form with defaults and a Save that 403'd.
- **Fix:** `canManage` — the form shows only after `GET /ai/settings` succeeds; otherwise a one-line note; status + test prompt stay.
- **Status:** applied.

### 11. Pool count limits disagreed
- **Problem:** `normalizePools` capped at 64, `fleetSpec` at 16, the page input not at all — a pool of 20 read as "20 expected" but the broker started 16, so it showed unhealthy forever.
- **Fix:** `lib.MAX_POOL_SIZE = 16` used by both; the page clamps 1–16.
- **Status:** applied; tested.

### 12. Widget mount race
- **Location:** `packages/cms/src/components/plugins/PluginWidgetHost.tsx`, `packages/cms/src/plugins/host.ts`.
- **Problem:** `loadPluginModule` is async. If the mount was removed before it resolved (user switch, the remount key from b1a01722), `onCleanup` ran over an empty list and `mountWidget` then ran into a detached element with nothing to tear it down — e.g. PageLoop injecting its toolbar into `<body>` for the wrong user. Async mounts' returned teardown was also ignored (`typeof Promise !== 'function'`).
- **Fix:** a `disposed` flag: no mount after disposal; `host.onCleanup` registered after disposal runs at once (`buildHost({ isDisposed })`); the mount result is awaited. `PluginClientModule` mount types accept a promise (`PluginMountResult`).
- **Status:** applied.

### 13. Widgets remounted on a failed login
- **Problem:** `userKey` returned `null` whenever `auth.isLoading` — `login()` and the auth refresh toggle it, so a wrong password tore every widget down and remounted it.
- **Fix:** `createMemo` keeps the last settled key during later loading phases; only the first load hides widgets.
- **Status:** applied.

### 14. Setup script hardening
- **Location:** `plugins/claude-broker/setup/setup-server.sh`.
- **Fixes:** refuse to run as root unless `ALLOW_ROOT=1` (sessions must run as the CMS user; Claude Code refuses permission-skipping as root); `ExecStartPre=-/bin/rm …` (a stale `/tmp/claude-broker.sock` owned by another user made `rm` fail → the service never started); an env file without a token now gets the token APPENDED instead of being overwritten (other settings kept; newline-safe); env file forced to 0600; `grep -oP` → `sed` (PCRE grep not everywhere). Still `set -euo pipefail`, idempotent, no destructive step (the half-installed broker dir is moved aside, not deleted).
- **Status:** applied (`bash -n` clean; not executed — no server run allowed).

### 15. Anthropic requests over HTTP are cut at 55 s (planned)
- **Problem:** The route caps `timeoutSec` at 55 for every provider. A long Anthropic answer is aborted and returns `failed` ("timed out") with no job to poll.
- **Plan:** for `provider: 'anthropic'` with `wait: false`, run the request in-process, store the `AiResult` in Redis under `CACHE_KEYS.aiJob(id)` (new key — lead, `cache.ts` contract) with a 1 h TTL, return `{ id: 'anthropic:<uuid>', status: 'in_progress' }`, and let `job(id)` read it instead of 404ing. Contained to `services/ai/`, but needs a `CACHE_KEYS` entry and a multi-process story (the job must be readable from any worker — Redis gives that).
- **Status:** planned.

### 16. Server `ask()` waits only the plugin Wait timeout
- `ai.ask()` passes no `timeoutSec`, so a broker request waits the plugin's Wait timeout (default 120 s) and may come back `timedOut` (then `askJson` returns null). Documented in AI.md; callers needing longer pass `timeoutSec`.
- **Status:** documented.

### 17. Admin plugin config page async race
- `packages/cms/src/pages/admin/PluginConfig.tsx` `ConfigArea` has the same pattern as #12 (outside this area's scope). See follow-up.

## Lead follow-up

1. **`packages/cms/src/services/help/sdkReference.ts`** (`CLAUDE_BROKER_DOC`): in "A **pool** is a session label…" append: `"Count is 1–16. Only sessions that can work count as ready — a usage-limited or signed-out session is attached but skipped."`; in the API table change `` '`GET /ai/pools`', 'Configured pools with attached / expected / busy sessions' `` → `'Configured pools: ready / attached / expected / busy / idle sessions'`.
2. **`packages/cms/src/pages/admin/PluginConfig.tsx`** `ConfigArea`: add `let disposed = false;`, `if (disposed) return;` after `await loadPluginModule`, pass `isDisposed: () => disposed` to `buildHost`, `const teardown = await mod.mountConfig(el, host);` + `if (typeof teardown === 'function') host.onCleanup(teardown);`, and in `onCleanup` set `disposed = true` before running the cleanups.
3. **CLAUDE.md** (AI module bullet): add "`AiPool.ready` = attached sessions able to work; `healthy = ready >= expected`; plugin `type:'secret'` config is masked on every admin read (`maskPluginSecrets`, echoed mask = unchanged); admin plugin routes check `plugins:manage`; AI routes accept API keys on their scope." Plugins bullet: "widget mounts are dispose-safe (`isDisposed`), async mounts allowed".
4. **`npm run docs:api`** — no route shapes changed, but `AiPool` gained fields (DTO only).

## Verification

- `cd packages/shared && npm run build` — OK.
- `cd packages/api && npx tsc --noEmit -p .` — 0 errors.
- `cd packages/api && npx vitest run src/services/ai src/services/plugins.secrets.test.ts` — 3 files, 16 tests passed (new: `brokerLib.test.ts` 7, `plugins.secrets.test.ts` 2).
- `cd packages/cms && npx tsc --noEmit -p .` — my files clean; remaining errors only in known files and `PageEditor.tsx` (`autoSlug` exports — another agent mid-edit).
- `node --check` on `server.js`, `lib.js`, `client.js` (as ESM) — OK. `bash -n setup-server.sh` — OK.
- Not verified: live broker behavior (no broker daemon run, per the brief), the setup script end to end, and the plugin config page in a browser.
