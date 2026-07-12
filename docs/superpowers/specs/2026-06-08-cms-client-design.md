# @sitesurge/client — Production Headless CMS Client Design

Date: 2026-06-08
Status: Approved

## Goal

Implement `@sitesurge/client` in full: a typed, framework-agnostic, zero-runtime-
dependency TypeScript client that exposes EVERY API ability of the SiteSurge
backend through per-module namespaces, with production features — token
lifecycle with auto-load on refresh, an SWR client-side cache over a pluggable
storage adapter, standardized request/error handling, and consumer error
bindings (toast/form/custom). It is the single client all consumers route
through — our own `@sitesurge/admin` SPA, external apps, and Node/agent scripts.

Reference charter: `docs/client-sdk-plan.md`. Wire surface: `docs/API.md` +
`docs/api-manifest.json` (28 modules / 198 routes). DTOs already exist in
`@sitesurge/types` (`packages/shared/src/api/routes/<module>.ts`).

## Settled decisions (kickoff brainstorm)

1. **Generation:** hand-rolled thin client — one `request()` core + a
   hand-written namespace file per module, typed against the shared DTOs.
   Drift guarded by a CI check vs `api-manifest.json`.
2. **Default cache adapter:** auto-detect IndexedDB → localStorage → memory,
   all behind one async `CacheAdapter` interface (swappable).
3. **Freshness:** SWR — instant stale read + background revalidate + subscriber
   notify; per-resource TTL; mutations auto-invalidate affected keys.
4. **Interface:** typed Promises everywhere + a framework-agnostic
   subscription/event layer (`cache.subscribe`, `client.onError`). Optional
   SolidJS adapter as a side-file (no Solid dep in core).
5. **Auth modes (v1):** Bearer JWT (login→access/refresh, single-flight refresh
   on 401) + `ssk_` API key, both full; cookie+CSRF mode as a selectable
   transport (Bearer default). Tokens persist + auto-load on construction.
6. **Retry:** GETs auto-retry (backoff, Retry-After, 5xx/429/network); writes
   never auto-retry unless `{ retry, idempotencyKey }` is passed per-call.
   (Backend has no idempotency-key handling yet — keys are sent for forward-
   compat but documented as not-yet-enforced.)
7. **Distribution:** workspace package, npm-publish-ready (ESM+CJS+.d.ts,
   `exports` map with `.` and `./solid`), consumed in-repo via workspace link;
   no actual publish this pass.

## Architecture

```
packages/cms-client/src/
├── core/
│   ├── client.ts          # createClient(config) → CmsClient
│   ├── config.ts          # CmsClientConfig + resolveConfig (defaults)
│   ├── request.ts         # fetch core: URL build, auth, body/FormData, timeout,
│   │                      #   retry, CSRF, envelope unwrap, error throw
│   ├── http.ts            # low-level fetch wrapper (pluggable fetch for Node)
│   ├── auth/
│   │   ├── authManager.ts # token state machine; single-flight refresh; modes
│   │   └── tokenStore.ts  # persist + auto-load tokens (localStorage default)
│   ├── cache/
│   │   ├── cacheManager.ts# SWR engine: get-or-revalidate, TTL, subscribers
│   │   ├── keys.ts        # module:method:argsHash key builder
│   │   ├── invalidation.ts# mutation → affected-keys rules
│   │   └── adapters/      # indexeddb.ts | localstorage.ts | memory.ts | detect.ts
│   ├── errors.ts          # CmsError hierarchy + helpers
│   ├── events.ts          # tiny emitter (subscribe / onError / emit)
│   └── types.ts           # QueryOptions, MutationOptions, public option types
├── modules/
│   ├── base.ts            # ModuleBase: cachedGet / mutate / raw helpers
│   ├── <module>.ts        # one namespace per manifest module (~24 files)
│   └── index.ts           # assemble cms.<module>
├── adapters/
│   └── solid.ts           # optional SolidJS binding (./solid subpath)
└── index.ts               # public API: createClient, CmsClient, types, errors
```

### Layer responsibilities

- **core/request.ts** — the single funnel. Builds URL from `mountPath + path`
  (interpolates `:params`, serializes query with numbers→strings, drops
  undefined). Attaches auth (Bearer / `ssk_` / cookie+`x-csrf-token`). Sets
  `Content-Type: application/json` + JSON body, OR passes `FormData` (no
  content-type) for multipart. Enforces timeout via `AbortController`. Runs the
  retry policy. Unwraps `ApiResponse<T>` → returns `data` or throws a typed
  `CmsError`. Honors `{ raw: true }` (feed/sitemap/webhook) to return the raw
  body untouched. Honors `{ cache }` and `{ retry, idempotencyKey }` options.

- **core/auth** — `AuthManager` owns auth state and decorates each request with
  the right credential. Bearer mode: on 401 with `Token expired`, run a
  single-flight `refresh()`; re-issue the original request once; if refresh
  fails, clear tokens + emit `auth:expired` + reject `UnauthorizedError`.
  API-key mode: static `Authorization: Bearer ssk_…`, no refresh/CSRF.
  Cookie mode: ensure a `csrf-token` cookie (GET `/health/live` if absent),
  echo it as `x-csrf-token` on unsafe methods. `tokenStore` persists the token
  bundle (localStorage key `cms.auth` by default; pluggable; `null` ⇒ memory)
  and is read in the `AuthManager` constructor so a refresh restores session.
  Emits `auth:change` on every transition for consumers.

- **core/cache** — `cacheManager.read(key, fetcher, opts)` implements SWR:
  return cached value immediately if present (even if stale), kick a background
  revalidate when stale/missing, write fresh value, and notify `subscribe(key)`
  listeners only when the value changed (shallow/deep-equal guard). TTL per
  resource (defaults: lists 30s, entities 60s, settings/nav 300s — configurable
  map). `keys.ts` builds stable keys `cms:<module>:<method>:<stableHash(args)>`.
  `invalidation.ts` maps each mutation to the keys it dirties (e.g.
  `posts.create` → drop `cms:posts:list:*` and the new id's detail key) and
  triggers revalidation/notify. Adapters: IndexedDB (object store `cms-cache`),
  localStorage (prefixed keys + JSON), memory (Map). `detect.ts` picks the best
  available; consumer can force one or pass a custom `CacheAdapter`.

- **core/errors.ts** — `CmsError extends Error { code, status, details, requestId? }`
  base; subclasses keyed to `ErrorCode`: `BadRequestError`, `UnauthorizedError`,
  `ForbiddenError`, `NotFoundError`, `ValidationError` (`fieldErrors:
  Record<string,string>` derived from `details.errors[]`), `ConflictError`,
  `RateLimitedError` (`retryAfter?`), `ContentLockedError`
  (`ContentLockedDetails`), `ServiceUnavailableError`, `InternalError`, plus
  transport errors `NetworkError`, `TimeoutError`, `AbortError`. A `fromResponse`
  factory maps an envelope/status to the right subclass.

- **core/events.ts** — minimal typed emitter. `client.onError(handler, filter?)`
  registers a service-level error sink (every thrown `CmsError` is also emitted;
  consumers wire toast/log/custom; `ValidationError.fieldErrors` for forms).
  `cache.subscribe(key, cb)` for reactive reads. `client.on('auth:change'|…)`.
  Returns unsubscribe functions.

- **modules/base.ts** — `ModuleBase` gives each namespace `this.get(path, {query,
  cacheKey, ttl})`, `this.mutate(method, path, {body, invalidates})`,
  `this.raw(path)`, `this.upload(path, formData)`. Keeps every module file tiny
  and uniform.

- **modules/<module>.ts** — one class/object per manifest module. Methods named
  for intent (`list`, `get`, `getBySlug`, `create`, `update`, `remove`, `bulk`,
  module-specific verbs). Each typed with the shared DTOs (`PostListQuery` →
  `Post[]`, etc.). Dual-mount mailing lists exposed as ONE `cms.mailingLists`
  namespace (admin + public subscribe). Irregular endpoints get bespoke,
  documented methods. Raw modules (feed/sitemap/unsubscribe) exposed as
  string-returning helpers or omitted from the typed surface per the charter
  (feed/sitemap → `cms.feed.xml()` returning string; webhook excluded).

- **adapters/solid.ts** — `createCmsResource(client, () => key, fetcher)` and
  helpers turning `cache.subscribe` into SolidJS signals/resources, and
  `bindErrors` to a setter. Imported only by consumers that want it; core never
  imports Solid.

## Config surface

```ts
createClient({
  baseUrl: string,                       // required, e.g. 'https://cms.example.com'
  auth?: { mode?: 'bearer'|'apiKey'|'cookie',
           apiKey?: string,
           tokens?: AuthTokens,
           store?: TokenStore | null },  // null ⇒ memory-only
  cache?: boolean | {                    // true (default) | false | options
           adapter?: CacheAdapter | 'indexeddb'|'localstorage'|'memory'|'auto',
           ttl?: Partial<TtlMap>,
           namespace?: string },
  fetch?: typeof fetch,                  // inject for Node < 18 / testing
  timeoutMs?: number,                    // default 30000
  retry?: Partial<RetryPolicy>,          // GET defaults; writes opt-in
  headers?: Record<string,string>,       // static extra headers
  onError?: (e: CmsError) => void,       // convenience for the error bus
})
```

## Documentation deliverable

`packages/cms-client/docs/Overview.md`:
- Top: what/why, install, 60-second quickstart (createClient + a list + a login).
- Config reference table.
- Auth modes (bearer/apiKey/cookie) + token persistence/auto-load.
- Caching (SWR model, adapters, TTL, invalidation, subscriptions, disabling).
- Error handling (the hierarchy table, the error bus, form/toast binding).
- SolidJS adapter.
- **One collapsible `<details>` section PER MODULE**, each listing every public
  method: signature, request DTO, response DTO, auth tier, cache behavior, and a
  short example.
- Drift note: methods mirror `api-manifest.json`; CI guards it.

## Testing

- **Unit (vitest + mocked fetch):** request core (URL/query/params/body/FormData/
  timeout/retry/envelope-unwrap/raw); auth (bearer login, single-flight refresh,
  401 re-issue, apiKey header, cookie CSRF); cache (SWR hit/stale/revalidate,
  TTL expiry, subscriber notify-on-change, invalidation rules, adapter
  round-trip for memory + a fake IDB); errors (every ErrorCode → subclass,
  ValidationError.fieldErrors); a representative sample of module methods
  (URL + DTO shape) — not all 198, but every PATTERN (list, slug, bulk,
  multipart, dual-mount, irregular settings/search).
- **Integration smoke:** boot the real API on a side port (PORT dance, restore
  .env), seed an API key, exercise: API-key list, login→Bearer round-trip, a
  cached re-read (second call served from cache), a create→list-invalidation,
  an error path (404 → NotFoundError). Teardown.
- CI drift check: a script asserting every manifest route is reachable by some
  client method (or explicitly listed as intentionally-unexposed: webhook, raw
  redirects), failing on a new uncovered route.

## Out of scope (YAGNI / follow-ups)

- Migrating `@sitesurge/admin` to consume the client (separate project).
- Building `POST /auth/register` / `POST /utils/url-preview` clients (deferred
  backend features — charter notes).
- Real npm publish (package is publish-READY only).
- Offline write queue / optimistic mutation rollback (cache is read-through SWR;
  mutations go to network then invalidate — note as a future enhancement).
- Backend idempotency-key enforcement (client sends the header for forward-compat).

## Risks / mitigations

- **IndexedDB in tests/Node:** adapter behind an interface; memory adapter is
  the test/Node default; a fake-IDB only for the IDB adapter's own unit test.
- **Auth refresh races:** single-flight promise shared across concurrent 401s.
- **Cache staleness vs correctness:** SWR + mutation invalidation; sensitive
  reads (auth/me) bypass cache; `cache:false` escape hatch everywhere.
- **198-route surface:** ModuleBase keeps files tiny; batch modules like the
  Phase-3 sweep; the drift-check prevents silent gaps.
- **Bundle size / zero-dep:** no deps; IDB via raw API; tree-shakeable ESM;
  the SolidJS adapter is a separate entry so non-Solid consumers don't pull it.
