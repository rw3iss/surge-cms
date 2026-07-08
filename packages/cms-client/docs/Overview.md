# @rw/cms-client — Overview

`@rw/cms-client` is the **headless TypeScript client** for any SiteSurge /
hosted CMS backend. It mirrors the backend's in-process `cms.*` service
aggregate over HTTP through per-module namespaces (`cms.posts`, `cms.pages`,
`cms.settings`, …), typed end-to-end against the DTOs in `@rw/cms-shared`.

**Why it exists.** There is exactly one client all consumers route through:

- **`@rw/cms-web`** — our own SolidJS SPA (an optional `./solid` adapter ships
  reactive resources for it). **Used in production by `@rw/cms-web` (cookie
  mode)** — the SPA routes every backend call through this client.
- **External apps** — any browser or server app that talks to a SiteSurge
  instance gets the same typed surface.
- **Node / agent scripts** — works in Node ≥ 18 (inject a `fetch` for older).

It has **zero runtime dependencies**, is fetch-based, ships dual ESM + CJS +
`.d.ts`, and carries production features out of the box: token lifecycle with
auto-load on page refresh, an SWR client cache over a pluggable storage
adapter, a typed error hierarchy with a consumer error bus, GET auto-retry, and
opt-in SolidJS bindings.

**Doctrine:** all client-side API requests for SiteSurge route through this
package — do not hand-roll `fetch` against the API.

---

## Install

In-repo (workspace link — already wired):

```jsonc
// package.json
{ "dependencies": { "@rw/cms-client": "workspace:*" } }
```

Future npm (the package is publish-ready — ESM + CJS + `.d.ts`, `exports` map
with `.` and `./solid`; no actual publish yet):

```bash
npm install @rw/cms-client
```

---

## 60-second quickstart

```ts
import { createClient } from '@rw/cms-client';

// 1. API-key client (server/agent). Presence of apiKey selects apiKey mode.
const cms = createClient({
    baseUrl: 'https://cms.example.com',
    auth: { apiKey: 'ssk_…' },
});

// 2. A typed, cached, paginated list → { data, meta }.
const { data: posts, meta } = await cms.posts.list({ status: 'all' });
//    posts: Post[]   meta: { page?, limit?, total?, totalPages? }

// 3. Or a Bearer session: login persists tokens (localStorage by default),
//    and every later call is authenticated automatically.
const browser = createClient({ baseUrl: 'https://cms.example.com' }); // bearer default
await browser.auth.login({ email: 'admin@example.com', password: 'secret' });
const me = await browser.auth.me();                       // AuthMeResponse (never cached)
```

`createClient(config)` returns a `CmsClient` — the wired core plus every
`cms.<module>` namespace. Modules are properties, not factories: call
`cms.posts.list(…)` directly.

---

## Config reference

`createClient(config: CmsClientConfig)`. Every field except `baseUrl` is
optional.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `baseUrl` | `string` | **required** | Site root, e.g. `https://cms.example.com`. Trailing slashes trimmed. JSON routes mount under `${baseUrl}/api/v1`; raw routes (`/feed.xml`, `/sitemap.xml`) sit at the root. |
| `auth.mode` | `'bearer' \| 'apiKey' \| 'cookie'` | `'bearer'` (or `'apiKey'` if `auth.apiKey` is set) | Credential transport. See [Auth modes](#auth-modes). |
| `auth.apiKey` | `string` | – | Static `ssk_…` key. Sent as `Authorization: Bearer ssk_…`. Setting it auto-selects `apiKey` mode. |
| `auth.tokens` | `AuthTokens` | – | Seed `{ accessToken, refreshToken, expiresAt? }` (bearer). Saved to the store on construction. |
| `auth.store` | `TokenStore \| null` | localStorage store (browser) / memory (Node) | Token persistence. `null` ⇒ memory-only (no persistence). Provide a custom `{ load, save, clear }` for SSR/secure storage. |
| `auth.storageKey` | `string` | `'cms.auth'` | localStorage key for the default store. |
| `cache` | `boolean \| { adapter, ttl, namespace }` | `true` | `false` disables caching globally. See [Caching](#caching-swr). |
| `cache.adapter` | `CacheAdapter \| 'auto' \| 'indexeddb' \| 'localstorage' \| 'memory'` | `'auto'` | Storage backend (auto-detects IndexedDB → localStorage → memory) or a custom adapter. |
| `cache.ttl` | `Partial<TtlMap>` | `{ list: 30000, entity: 60000, settings: 300000 }` | Per-resource staleness (ms). Merged over defaults. |
| `cache.namespace` | `string` | `'cms'` | Cache-key prefix (isolate multiple clients). |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Inject a fetch impl for Node < 18 or testing. Throws at construction if none is available. |
| `timeoutMs` | `number` | `30000` | Per-request timeout (`AbortController`). |
| `retry` | `Partial<RetryPolicy>` | `{ attempts: 3, backoffMs: 300, maxBackoffMs: 5000, retryStatuses: [429,500,502,503,504] }` | GET retry policy (writes opt in per-call). See [Retry](#retry). |
| `headers` | `Record<string, string>` | `{}` | Static extra headers added to every request. |
| `onError` | `(e: CmsError) => void` | – | Convenience subscription to the error bus (same as `cms.onError(handler)`). |

`AuthTokens = { accessToken: string; refreshToken: string; expiresAt?: string | number }`.

---

## Auth modes

Switch via `auth.mode`. The credential travels with every request; the cache,
retry, and error machinery are identical across modes.

### `bearer` (default)

Email/password login mints an access + refresh token pair.

- `cms.auth.login({ email, password, rememberMe? })` → `AuthResponse`. Tokens
  are stored (localStorage by default) and attached as
  `Authorization: Bearer <accessToken>` on every later call.
- **Auto-refresh on 401:** a request that fails with `UnauthorizedError` whose
  message matches `/expired/i` triggers a `refresh()` and the original request
  is replayed once. Refresh is **single-flight** — concurrent 401s share one
  `POST /auth/refresh`; if it fails, tokens clear, `auth:expired` fires, and the
  original `UnauthorizedError` propagates.
- **Persistence + auto-load:** the `AuthManager` reads the store in its
  constructor, so a page refresh restores the session. Pass `auth.tokens` to
  seed; pass `auth.store: null` for memory-only.

### `apiKey`

Static `ssk_` key sent as `Authorization: Bearer ssk_…`. No login, no refresh,
no CSRF.

- Selected automatically when `auth.apiKey` is set, or force with
  `auth.mode: 'apiKey'`.
- **Scopes** (server-enforced): `read < write < admin`. A `read` key reaches
  GET routes; `write` adds mutations; `admin` is full. **Keys cannot manage
  keys** — the `cms.apiKeys` module rejects an API-key caller (use a Bearer
  admin session to create/revoke keys).
- `cms.setApiKey(key)` swaps the key (and mode) at runtime.

### `cookie`

For same-origin browser apps that rely on the backend's httpOnly cookies. The
client performs a CSRF round-trip: it ensures a `csrf-token` cookie (fetching
`GET /api/v1/health/live` once if absent) and echoes it as the `x-csrf-token`
header on unsafe methods (non-GET/HEAD/OPTIONS). All requests use
`credentials: 'include'`.

> Bearer is the default and recommended mode; the client supersedes the SPA's
> historical cookie transport.

---

## Caching (SWR)

GET reads (excluding `raw` XML routes) flow through a **stale-while-revalidate**
cache:

1. **Instant stale read** — if a value is cached (even past its TTL), it returns
   immediately.
2. **Background revalidate** — when missing or stale, the fetcher runs in the
   background and writes the fresh value.
3. **Subscriber notify** — listeners on that key (`cache.subscribe`) fire only
   when the value actually changed.

**Adapters.** One async `CacheAdapter` interface
(`get / set / delete / deletePrefix / clear`) over three backends; `'auto'`
detects the best available: **IndexedDB → localStorage → memory**. Force one
with `cache.adapter: 'memory' | 'localstorage' | 'indexeddb'`, or pass a custom
`CacheAdapter`.

**TTL.** Resource-class defaults (ms): `list: 30000`, `entity: 60000`,
`settings: 300000`. Override globally via `cache.ttl`, or per call via the
`options.ttl`. (List TTL is the default applied to a GET unless overridden.)

**Per-call control.** Read methods accept `options`:
`{ cache?: boolean; ttl?: number; signal?: AbortSignal }`. `cache: false`
bypasses the cache for that read. Several reads pass `cache: false` internally
because they must always be live: `auth.me`, `auth.autologin`, every
`health.*`, and `setup.status`.

**Invalidation.** Each mutation declares the bare module names it dirties;
on success the client drops the **whole module's** cached reads (coarse,
predictable prefix invalidation). E.g. `posts.create` → drops `cms:posts:*`.
(Per-key invalidation is a future enhancement; writes go to the network then
invalidate — there is no optimistic/offline write queue.)

**Subscriptions.** `cms.subscribe(module, path, args, cb)` registers a callback
that fires on SWR revalidation. The SolidJS adapter wraps this into a reactive
resource (see below). The `(module, path, args)` triple must match the cache key
the GET built — `path` is the **route path** (e.g. `'/posts'`), `args` is the
query object (or `null`).

**Disabling.** `cache: false` at the client level turns off caching entirely
(every GET hits the network).

---

## Error handling

Every failed call rejects with a `CmsError` (or a subclass). The same error is
also emitted on the **error bus** for cross-cutting handling.

### The hierarchy

All carry `code` (wire `ErrorCode`), `status` (HTTP, `0` for transport),
optional `details`, and `requestId`.

| Class | `code` | status | Special fields | Thrown when |
|-------|--------|--------|----------------|-------------|
| `CmsError` | (any) | (any) | – | Base; also the fallback for an unmapped `code`. |
| `BadRequestError` | `BAD_REQUEST` / `REFERENCE_ERROR` / `NO_FILE` | 400 | – | Malformed request, FK violation, missing file. |
| `UnauthorizedError` | `UNAUTHORIZED` / `CSRF_ERROR` | 401 | – | Missing/expired token, CSRF mismatch. |
| `ForbiddenError` | `FORBIDDEN` | 403 | – | Authenticated but lacks the role/scope. |
| `NotFoundError` | `NOT_FOUND` | 404 | – | No such resource. |
| `ValidationError` | `VALIDATION_ERROR` | 400/422 | `fieldErrors: Record<string,string>` | Schema validation failed; `fieldErrors` is `field → first message` from `details.errors[]`. |
| `ConflictError` | `CONFLICT` / `DUPLICATE` / `ALREADY_INSTALLED` | 409 | – | Slug clash, duplicate, already-installed. |
| `RateLimitedError` | `RATE_LIMITED` | 429 | `retryAfter?: number` (seconds) | Throttled; honored by the retry backoff. |
| `ContentLockedError` | `CONTENT_LOCKED` | 403 | `accessLevel: string`, `preview` | Gated content (e.g. a patron post); `preview` carries `{ title, description, featuredImage }`. |
| `ServiceUnavailableError` | `SERVICE_UNAVAILABLE` / `SERVICE_NOT_CONFIGURED` | 503 | – | Dependency down or feature unconfigured. |
| `InternalError` | `INTERNAL_ERROR` | 500 | – | Unhandled server error. |
| `FeatureCascadeError` | `CONFLICT` | 409 | `result: SettingsFeatureCascadeResult` | `cms.settings.update()` rejected a feature toggle; `result.kind` is `missing_prerequisites` (read `result.missing`) or `has_dependents` (read `result.dependents`). |
| `NetworkError` | `NETWORK_ERROR` | 0 | – | Transport failure (offline, DNS, CORS). |
| `TimeoutError` | `TIMEOUT` | 0 | – | Request exceeded `timeoutMs`. |
| `AbortError` | `UNKNOWN_ERROR` | 0 | – | Caller's `AbortSignal` fired. |

`errorFromEnvelope(status, error, retryAfter?)` builds the right subclass from a
failure envelope; transport failures are constructed directly by the request
core.

### The error bus

```ts
const off = cms.onError((e) => {
    if (e instanceof ValidationError) return;       // handled at the form
    toast.error(e.message);                          // everything else → toast
});
// `off()` to unsubscribe. `onError` in config wires the same handler.
```

Every thrown `CmsError` is emitted, so you can centralize toasts/logging without
wrapping each call.

### Form binding

```ts
try {
    await cms.posts.create(body);
} catch (e) {
    if (e instanceof ValidationError) setFieldErrors(e.fieldErrors); // { slug: 'Required', … }
    else throw e;
}
```

### Feature cascade (settings 409)

```ts
try {
    await cms.settings.update({ features: { mailing_lists: true } });
} catch (e) {
    if (e instanceof FeatureCascadeError) {
        // e.result.kind === 'missing_prerequisites' → e.result.missing
        // confirm with the operator, then retry:
        await cms.settings.update({ features: { mailing_lists: true }, enableDependencies: true });
    }
}
```

---

## SolidJS adapter (`@rw/cms-client/solid`)

Optional reactive bindings — imported only by Solid consumers; the core never
imports `solid-js`.

- **`createCmsResource(core, module, path, args, fetcher)`** → `[accessor, { refetch }]`.
  Seeds immediately, then subscribes for SWR background updates. The accessor is
  `T | undefined` until the first fetch resolves.
- **`bindCmsErrors(core, onError)`** — subscribes a handler to the error bus
  inside a Solid tracking scope; auto-unsubscribed on cleanup.

```ts
import { createCmsResource, bindCmsErrors } from '@rw/cms-client/solid';

const [posts, { refetch }] = createCmsResource(
    cms,            // the CmsClient (a CmsClientCore)
    'posts',        // module
    '/posts',       // route PATH (not the HTTP verb)
    { page: 1 },    // args — the query object (or null)
    () => cms.posts.list({ page: 1 }),  // fetcher
);

bindCmsErrors(cms, (e) => setError(e));
```

**Key alignment.** The `(module, path, args)` triple MUST match the cache key
the core built for the corresponding `send()` — `module` is the namespace name,
`path` is the route path, `args` is the query object (or `null`). Mismatched
keys silently never update.

---

## Retry

- **GET (and HEAD)** auto-retry by default: on `NetworkError`, `TimeoutError`,
  or a retryable status (`429`, `500`, `502`, `503`, `504`), up to
  `retry.attempts` (default 3) with exponential backoff
  (`backoffMs · 2^n`, capped at `maxBackoffMs`). A `RateLimitedError.retryAfter`
  overrides the backoff. Non-retryable errors (e.g. 404) rethrow immediately.
- **Writes** (POST/PUT/PATCH/DELETE) never auto-retry. Opt a single call in with
  `options: { retry: true, idempotencyKey: '…' }`. The `Idempotency-Key` header
  is sent for forward-compat (**not yet enforced server-side**).

---

## Modules

Each `<details>` lists every public method with its signature
(params → return DTO), the HTTP method + path, the auth tier from
`docs/api-manifest.json`, and cache behavior (`cached GET` / `mutation` /
`raw`). All DTO names are exported from `@rw/cms-shared`.

Auth tiers: **public** (no auth) · **optional** (anon allowed; auth enriches) ·
**user** (any authenticated user) · **admin** (admin role / `admin` API-key scope).

### Pagination

List methods whose backend route replies with page meta return
`Paginated<T> = { data: T[]; meta: PageMeta }` (both exported from
`@rw/cms-shared`; `PageMeta = { page?, limit?, total?, totalPages? }` — all
optional, matching the envelope). Destructure the result:

```ts
const { data, meta } = await cms.posts.list({ status: 'all', page: 1 });
//    data: Post[]        meta.total / meta.totalPages drive the pager
```

The `{ data, meta }` object is cached as a whole under the normal SWR key,
so a paginated read still serves from cache and refreshes in the background.

Paginated methods (return `Paginated<T>`): `posts.list`, `posts.search`,
`pages.list`, `campaigns.list` (admin), `campaigns.donations`,
`campaigns.allDonations`, `forms.list` (admin), `forms.listSubmissions`,
`users.list`, `users.listBanned`, `messages.list`, `media.list`,
`audit.list`, `payments.transactions`, `payments.adminSubscriptions`,
`payments.adminTransactions`, `payments.adminUserTransactions`,
`social.listPosts`, `social.platformPosts`.

Collection reads whose route returns a **bare array** (no meta) keep
returning the array directly: `campaigns.listPublic`, `forms.listPublic`,
`mailingLists.list`, `mailSend.listJobs`, `connections.list`,
`social.feed`/`platformFeed`/`homepage`, `payments.subscriptions`/`plans`,
`blockStyles.list`, `fonts.list`, `settings.listSwatches`, and the grouped
`search.query`/`adminSearch`. The `{ items, total }`-shaped reads
(`mailingLists.subscribers`, `mailSend.jobRecipients`) are likewise unchanged.

<details><summary><code>cms.posts</code> — blog posts, revisions, block reorder (12 methods)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `list` | `(query?: PostListQuery) → Paginated<Post>` | `GET /posts` | optional | cached GET (paginated) |
| `search` | `(query: PostSearchQuery) → Paginated<Post>` | `GET /posts/search` | public | cached GET (paginated) |
| `getBySlug` | `(slug: string, query?: PostBySlugQuery) → PostBySlugResponse` | `GET /posts/slug/:slug` | optional | cached GET (throws `ContentLockedError` on gated content) |
| `getById` | `(id: string) → PostByIdResponse` | `GET /posts/:id` | admin | cached GET |
| `create` | `(body: PostCreateBody) → PostCreateResponse` | `POST /posts` | admin | mutation → posts |
| `update` | `(id: string, body: PostUpdateBody) → PostUpdateResponse` | `PUT /posts/:id` | admin | mutation → posts |
| `remove` | `(id: string) → PostDeleteResponse` | `DELETE /posts/:id` | admin | mutation → posts |
| `bulk` | `(body: PostBulkBody) → PostBulkResponse` | `POST /posts/bulk` | admin | mutation → posts |
| `listRevisions` | `(id: string) → PostRevisionListResponse` | `GET /posts/:id/revisions` | admin | cached GET |
| `getRevision` | `(id: string, version: number) → PostRevisionResponse` | `GET /posts/:id/revisions/:version` | admin | cached GET |
| `restoreRevision` | `(id: string, version: number) → PostRevisionRestoreResponse` | `POST /posts/:id/revisions/:version/restore` | admin | mutation → posts |
| `reorderBlocks` | `(id: string, body: PostReorderBlocksBody) → PostReorderBlocksResponse` | `PUT /posts/:id/blocks/reorder` | admin | mutation → posts |

```ts
const { data: posts } = await cms.posts.list({ status: 'published', page: 1 });
const post = await cms.posts.getBySlug('hello-world');
```
</details>

<details><summary><code>cms.pages</code> — CMS pages, revisions, block CRUD (16 methods)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `navigation` | `() → PageNavigationResponse` | `GET /pages/navigation` | public | cached GET |
| `homepage` | `() → PageHomepageResponse` | `GET /pages/homepage` | public | cached GET |
| `getBySlug` | `(slug: string, query?: PageBySlugQuery) → PageBySlugResponse` | `GET /pages/slug/:slug` | optional | cached GET (throws `ContentLockedError`) |
| `list` | `(query?: PageListQuery) → Paginated<Page>` | `GET /pages` | admin | cached GET (paginated) |
| `getById` | `(id: string) → PageByIdResponse` | `GET /pages/:id` | admin | cached GET |
| `create` | `(body: PageCreateBody) → PageCreateResponse` | `POST /pages` | admin | mutation → pages |
| `update` | `(id: string, body: PageUpdateBody) → PageUpdateResponse` | `PUT /pages/:id` | admin | mutation → pages |
| `remove` | `(id: string) → PageDeleteResponse` | `DELETE /pages/:id` | admin | mutation → pages |
| `bulk` | `(body: PageBulkBody) → PageBulkResponse` | `POST /pages/bulk` | admin | mutation → pages |
| `listRevisions` | `(id: string) → PageRevisionListResponse` | `GET /pages/:id/revisions` | admin | cached GET |
| `getRevision` | `(id: string, version: number) → PageRevisionResponse` | `GET /pages/:id/revisions/:version` | admin | cached GET |
| `restoreRevision` | `(id: string, version: number) → PageRevisionRestoreResponse` | `POST /pages/:id/revisions/:version/restore` | admin | mutation → pages |
| `createBlock` | `(pageId: string, body: PageBlockBody) → PageBlockCreateResponse` | `POST /pages/:pageId/blocks` | admin | mutation → pages |
| `updateBlock` | `(pageId: string, blockId: string, body: PageBlockUpdateBody) → PageBlockUpdateResponse` | `PUT /pages/:pageId/blocks/:blockId` | admin | mutation → pages |
| `deleteBlock` | `(pageId: string, blockId: string) → PageBlockDeleteResponse` | `DELETE /pages/:pageId/blocks/:blockId` | admin | mutation → pages |
| `reorderBlocks` | `(pageId: string, body: PageReorderBlocksBody) → PageReorderBlocksResponse` | `PUT /pages/:pageId/blocks/reorder` | admin | mutation → pages |

```ts
const nav = await cms.pages.navigation();
const page = await cms.pages.getBySlug('about');
```
</details>

<details><summary><code>cms.campaigns</code> — fundraising campaigns + donations (11 methods)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `listPublic` | `(query?: CampaignListQuery) → CampaignPublicListResponse` | `GET /campaigns` | optional | cached GET (bare published array) |
| `list` | `(query?: CampaignListQuery) → Paginated<Campaign>` | `GET /campaigns?all=true` | optional | cached GET (paginated all-statuses) |
| `getBySlug` | `(slug: string) → CampaignBySlugResponse` | `GET /campaigns/slug/:slug` | public | cached GET |
| `donations` | `(id: string, query?: CampaignDonationsQuery) → Paginated<PublicDonation>` | `GET /campaigns/:id/donations` | public | cached GET (masked, paginated) |
| `donationSummary` | `() → CampaignDonationSummaryResponse` | `GET /campaigns/donations/summary` | admin | cached GET |
| `allDonations` | `(query?: CampaignAllDonationsQuery) → Paginated<Donation>` | `GET /campaigns/donations/all` | admin | cached GET (paginated) |
| `getById` | `(id: string) → CampaignByIdResponse` | `GET /campaigns/:id` | admin | cached GET |
| `create` | `(body: CampaignCreateBody) → CampaignCreateResponse` | `POST /campaigns` | admin | mutation → campaigns |
| `update` | `(id: string, body: CampaignUpdateBody) → CampaignUpdateResponse` | `PUT /campaigns/:id` | admin | mutation → campaigns |
| `remove` | `(id: string) → CampaignDeleteResponse` | `DELETE /campaigns/:id` | admin | mutation → campaigns |
| `bulk` | `(body: CampaignBulkBody) → CampaignBulkResponse` | `POST /campaigns/bulk` | admin | mutation → campaigns |

```ts
const live = await cms.campaigns.listPublic();             // bare Campaign[]
const { data: all, meta } = await cms.campaigns.list({ status: 'draft' }); // adds all=true; paginated
```
</details>

<details><summary><code>cms.forms</code> — forms/surveys/polls, questions, CSV export (15 methods)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `listPublic` | `(query?: FormListQuery) → FormPublicListResponse` | `GET /forms` | optional | cached GET (bare published array) |
| `list` | `(query?: FormListQuery) → Paginated<Form>` | `GET /forms?all=true` | optional | cached GET (paginated all-statuses) |
| `getBySlug` | `(slug: string) → FormBySlugResponse` | `GET /forms/slug/:slug` | optional | cached GET |
| `results` | `(slug: string) → FormResultsResponse` | `GET /forms/slug/:slug/results` | public | cached GET |
| `submit` | `(slug: string, body: FormSubmitBody) → FormSubmitResponse` | `POST /forms/slug/:slug/submit` | optional | mutation → forms |
| `getById` | `(id: string) → FormByIdResponse` | `GET /forms/:id` | admin | cached GET |
| `listSubmissions` | `(id: string, query?: FormSubmissionsQuery) → Paginated<FormSubmission>` | `GET /forms/:id/submissions` | admin | cached GET (paginated) |
| `exportSubmissions` | `(id: string) → FormSubmissionsExportResponse` | `GET /forms/:id/submissions/export` | admin | raw (CSV string) |
| `create` | `(body: FormCreateBody) → FormCreateResponse` | `POST /forms` | admin | mutation → forms |
| `update` | `(id: string, body: FormUpdateBody) → FormUpdateResponse` | `PUT /forms/:id` | admin | mutation → forms |
| `remove` | `(id: string) → FormDeleteResponse` | `DELETE /forms/:id` | admin | mutation → forms |
| `bulk` | `(body: FormBulkBody) → FormBulkResponse` | `POST /forms/bulk` | admin | mutation → forms |
| `createQuestion` | `(id: string, body: FormQuestionCreateBody) → FormQuestionCreateResponse` | `POST /forms/:id/questions` | admin | mutation → forms |
| `updateQuestion` | `(formId: string, questionId: string, body: FormQuestionUpdateBody) → FormQuestionUpdateResponse` | `PUT /forms/:formId/questions/:questionId` | admin | mutation → forms |
| `deleteQuestion` | `(formId: string, questionId: string) → FormQuestionDeleteResponse` | `DELETE /forms/:formId/questions/:questionId` | admin | mutation → forms |

```ts
const form = await cms.forms.getBySlug('survey');
await cms.forms.submit('survey', { answers: [/* … */] });
const csv = await cms.forms.exportSubmissions(form.data.id);
```
</details>

<details><summary><code>cms.media</code> — media library, multipart uploads (7 methods)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `upload` | `(file: Blob, fields?: MediaUploadFields) → MediaUploadResponse` | `POST /media` | admin | mutation → media (multipart, field `file`) |
| `blockUpload` | `(file: Blob, fields?: MediaBlockUploadFields) → MediaBlockUploadResponse` | `POST /media/block-upload` | admin | mutation → media (echoes postId/blockId) |
| `bulkUpload` | `(files: Blob[]) → MediaBulkUploadResponse` | `POST /media/bulk` | admin | mutation → media (field `files`, max 10) |
| `list` | `(query?: MediaListQuery) → Paginated<MediaWire>` | `GET /media` | admin | cached GET (paginated) |
| `getById` | `(id: string) → MediaByIdResponse` | `GET /media/:id` | admin | cached GET |
| `update` | `(id: string, body: MediaUpdateBody) → MediaUpdateResponse` | `PUT /media/:id` | admin | mutation → media |
| `remove` | `(id: string) → MediaDeleteResponse` | `DELETE /media/:id` | admin | mutation → media |

```ts
const up = await cms.media.upload(fileBlob, { alt: 'Hero' });
```
</details>

<details><summary><code>cms.users</code> — user CRUD, avatar, bans (12 methods)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `list` | `(query?: UserListQuery) → Paginated<User>` | `GET /users` | admin | cached GET (paginated) |
| `getById` | `(id: string) → UserByIdResponse` | `GET /users/:id` | admin | cached GET |
| `create` | `(body: UserCreateBody) → UserCreateResponse` | `POST /users` | admin | mutation → users |
| `update` | `(id: string, body: UserUpdateBody) → UserUpdateResponse` | `PUT /users/:id` | admin | mutation → users |
| `remove` | `(id: string) → UserDeleteResponse` | `DELETE /users/:id` | admin | mutation → users |
| `setPassword` | `(id: string, body: UserPasswordBody) → UserPasswordResponse` | `POST /users/:id/password` | admin | mutation → users |
| `uploadAvatar` | `(id: string, file: Blob) → UserAvatarUploadResponse` | `POST /users/:id/avatar` | admin | mutation → users (multipart, field `avatar`) |
| `ban` | `(id: string, body?: UserBanBody) → UserBanResponse` | `POST /users/:id/ban` | admin | mutation → users |
| `unban` | `(id: string) → UserUnbanResponse` | `POST /users/:id/unban` | admin | mutation → users |
| `banIp` | `(body: UserBanIpBody) → UserBanIpResponse` | `POST /users/ban-ip` | admin | mutation → users |
| `listBanned` | `(query?: UserBanListQuery) → Paginated<UserBanRow>` | `GET /users/banned/list` | admin | cached GET (paginated) |
| `removeBan` | `(banId: string) → UserBanDeleteResponse` | `DELETE /users/banned/:banId` | admin | mutation → users |

```ts
const { data: users, meta } = await cms.users.list({ role: 'admin' });
await cms.users.ban(userId, { reason: 'spam' });
```
</details>

<details><summary><code>cms.messages</code> — contact-form submit + admin inbox (8 methods)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `submit` | `(body: MessageSubmitBody) → MessageSubmitResponse` | `POST /messages` | optional | mutation → messages |
| `list` | `(query?: MessageListQuery) → Paginated<ContactMessage>` | `GET /messages` | admin | cached GET (paginated) |
| `getById` | `(id: string) → MessageByIdResponse` | `GET /messages/:id` | admin | cached GET (marks unread → read) |
| `updateStatus` | `(id: string, body: MessageStatusUpdateBody) → MessageStatusUpdateResponse` | `PUT /messages/:id/status` | admin | mutation → messages |
| `remove` | `(id: string) → MessageDeleteResponse` | `DELETE /messages/:id` | admin | mutation → messages |
| `bulk` | `(body: MessageBulkBody) → MessageBulkResponse` | `POST /messages/bulk` | admin | mutation → messages (action=`delete`\|`status`) |
| `bulkStatus` | `(body: MessageBulkStatusBody) → MessageBulkStatusResponse` | `POST /messages/bulk-status` | admin | mutation → messages (legacy) |
| `bulkDelete` | `(body: MessageBulkDeleteBody) → MessageBulkDeleteResponse` | `POST /messages/bulk-delete` | admin | mutation → messages (legacy) |

```ts
await cms.messages.submit({ name: 'A', email: 'a@b.c', message: 'Hi' });
```
</details>

<details><summary><code>cms.social</code> — stored posts, live feeds, sync, homepage (8 methods)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `listPosts` | `(query?: SocialPostsQuery) → Paginated<SocialPost>` | `GET /social/posts` | public | cached GET (paginated) |
| `platformPosts` | `(platform: string, query?: SocialPlatformPostsQuery) → Paginated<SocialPost>` | `GET /social/posts/:platform` | public | cached GET (paginated) |
| `feed` | `(query?: SocialFeedQuery) → SocialFeedResponse` | `GET /social/feed` | public | cached GET (live merged) |
| `platformFeed` | `(platform: string, query?: SocialFeedQuery) → SocialPlatformFeedResponse` | `GET /social/feed/:platform` | public | cached GET |
| `homepage` | `() → SocialHomepageResponse` | `GET /social/homepage` | public | cached GET |
| `setHomepage` | `(body: SocialHomepageSetBody) → SocialHomepageSetResponse` | `PUT /social/homepage` | admin | mutation → social |
| `sync` | `(body?: SocialSyncBody) → SocialSyncResponse` | `POST /social/sync` | admin | mutation → social |
| `deletePost` | `(id: string) → SocialPostDeleteResponse` | `DELETE /social/posts/:id` | admin | mutation → social |

```ts
const feed = await cms.social.feed({ limit: 20 });
await cms.social.sync({ platform: 'youtube' });
```
</details>

<details><summary><code>cms.search</code> — grouped full-text search (2 methods)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `query` | `(q: string, query?: Omit<SearchQuery, 'q'>) → SearchResponse` | `GET /search` | public | cached GET (grouped `{ posts?, pages?, campaigns? }`) |
| `adminSearch` | `(q: string, query?: Omit<AdminSearchQuery, 'q'>) → AdminSearchResponse` | `GET /search/admin` | admin | cached GET (all content, any status) |

```ts
const hits = await cms.search.query('climate', { limit: 10 });
```
</details>

<details><summary><code>cms.audit</code> — audit-log view (1 method)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `list` | `(query?: AuditListQuery) → Paginated<AuditLogEntry>` | `GET /audit` | admin | cached GET (paginated; entity/action/user/date filters) |

```ts
const { data: log, meta } = await cms.audit.list({ entity: 'post', page: 1 });
```
</details>

<details><summary><code>cms.dashboard</code> — admin summary (1 method)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `summary` | `() → DashboardSummaryResponse` | `GET /dashboard/summary` | admin | cached GET |

```ts
const dash = await cms.dashboard.summary();
```
</details>

<details><summary><code>cms.auth</code> — session lifecycle + Patreon (8 HTTP methods + runtime surface)</summary>

`cms.auth` both exposes the auth HTTP endpoints AND forwards the `AuthManager`
runtime surface (`ready`, `authHeaders`, `getTokens`, `isAuthenticated`,
`setApiKey`, `onChange`, `onExpired`). `login` / `logout` / `refresh` delegate
to the manager so token persistence is never duplicated. OAuth **callback**
routes are not exposed (browser redirects).

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `login` | `(credentials: LoginCredentials & { rememberMe?: boolean }) → AuthResponse` | `POST /auth/login` | public | mutation (persists tokens) |
| `logout` | `() → void` | `POST /auth/logout` | public | mutation (clears tokens) |
| `refresh` | `() → AuthResponse` | `POST /auth/refresh` | public | single-flight refresh |
| `me` | `() → AuthMeResponse` | `GET /auth/me` | user | GET, `cache: false` (always fresh) |
| `patreonStart` | `() → AuthPatreonResponse` | `GET /auth/patreon` | public | cached GET (authorize URL + state) |
| `patreonSync` | `() → AuthPatreonSyncResponse` | `POST /auth/patreon/sync` | user | mutation |
| `logoutAll` | `() → AuthLogoutAllResponse` | `POST /auth/logout-all` | user | mutation |
| `autologin` | `() → AuthAutologinResponse` | `GET /auth/autologin` | public | GET, `cache: false` (**DEV ONLY** — localhost admin session) |

```ts
await cms.auth.login({ email: 'admin@example.com', password: 'secret' });
const session = await cms.auth.me();
cms.auth.onExpired(() => redirectToLogin());
```
</details>

<details><summary><code>cms.apiKeys</code> — API key management (3 methods)</summary>

> Admin only and **not reachable with an API key** — use a Bearer admin session.

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `list` | `() → ApiKeyListResponse` | `GET /api-keys` | admin | cached GET (hashes never returned) |
| `create` | `(body: ApiKeyCreateBody) → ApiKeyCreateResponse` | `POST /api-keys` | admin | mutation → apiKeys (plaintext returned once) |
| `revoke` | `(id: string) → ApiKeyDeleteResponse` | `DELETE /api-keys/:id` | admin | mutation → apiKeys |

```ts
const created = await cms.apiKeys.create({ name: 'ci', scopes: ['read'] });
```
</details>

<details><summary><code>cms.connections</code> — social connection credentials (7 methods)</summary>

OAuth **callback** route is not exposed (raw redirect); only the authorize-URL
endpoint is.

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `list` | `() → ConnectionListResponse` | `GET /connections` | admin | cached GET (creds masked) |
| `getByProvider` | `(provider: string) → ConnectionGetResponse` | `GET /connections/:provider` | admin | cached GET (or null) |
| `upsert` | `(body: ConnectionUpsertBody) → ConnectionUpsertResponse` | `POST /connections` | admin | mutation → connections |
| `update` | `(provider: string, body: ConnectionUpdateBody) → ConnectionUpdateResponse` | `PUT /connections/:provider` | admin | mutation → connections |
| `remove` | `(provider: string) → ConnectionDeleteResponse` | `DELETE /connections/:provider` | admin | mutation → connections |
| `reorder` | `(provider: string, body: ConnectionReorderBody) → ConnectionReorderResponse` | `PUT /connections/:provider/reorder` | admin | mutation → connections |
| `oauthAuthorize` | `(provider: string) → ConnectionOAuthAuthorizeResponse` | `GET /connections/:provider/oauth/authorize` | admin | cached GET (OAuth URL + state) |

```ts
const conns = await cms.connections.list();
const { url } = await cms.connections.oauthAuthorize('patreon');
```
</details>

<details><summary><code>cms.blockStyles</code> — reusable block-style templates (5 methods)</summary>

Mounted at `/block-styles` (kebab); cache identity is `blockStyles`.

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `list` | `() → BlockStyleListResponse` | `GET /block-styles` | admin | cached GET |
| `getById` | `(id: string) → BlockStyleGetResponse` | `GET /block-styles/:id` | admin | cached GET |
| `create` | `(body: BlockStyleCreateBody) → BlockStyleCreateResponse` | `POST /block-styles` | admin | mutation → blockStyles |
| `update` | `(id: string, body: BlockStyleUpdateBody) → BlockStyleUpdateResponse` | `PUT /block-styles/:id` | admin | mutation → blockStyles |
| `remove` | `(id: string) → BlockStyleDeleteResponse` | `DELETE /block-styles/:id` | admin | mutation → blockStyles |

```ts
const styles = await cms.blockStyles.list();
```
</details>

<details><summary><code>cms.fonts</code> — custom fonts (3 methods)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `list` | `() → FontListResponse` | `GET /fonts` | public | cached GET (with `@font-face` source URL) |
| `upload` | `(file: Blob, fields?: FontUploadBody) → FontUploadResponse` | `POST /fonts` | admin | mutation → fonts (multipart, field `file`) |
| `remove` | `(id: string) → FontDeleteResponse` | `DELETE /fonts/:id` | admin | mutation → fonts |

```ts
const fonts = await cms.fonts.list();
```
</details>

<details><summary><code>cms.dev</code> — developer tools: cron registry (2 methods)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `listCrons` | `() → DevCronListResponse` | `GET /dev/crons` | admin | cached GET |
| `getCron` | `(name: string) → DevCronGetResponse` | `GET /dev/crons/:name` | admin | cached GET (or null) |

```ts
const crons = await cms.dev.listCrons();
```
</details>

<details><summary><code>cms.health</code> — liveness/readiness probes (4 methods)</summary>

All probes pass `cache: false` (always live). `detailed`/`ready` answer 503 when
degraded — read the HTTP status / the thrown error.

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `basic` | `() → HealthBasicResponse` | `GET /health` | public | GET, `cache: false` |
| `detailed` | `() → HealthDetailedResponse` | `GET /health/detailed` | public | GET, `cache: false` |
| `ready` | `() → HealthReadyResponse` | `GET /health/ready` | public | GET, `cache: false` |
| `live` | `() → HealthLiveResponse` | `GET /health/live` | public | GET, `cache: false` |

```ts
await cms.health.live();
```
</details>

<details><summary><code>cms.setup</code> — first-run installer (7 methods)</summary>

Setup-mode only. `status` is never cached. Test endpoints return a
discriminated `{ ok: true | false }` result.

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `status` | `() → SetupStatusResponse` | `GET /setup/status` | public | GET, `cache: false` |
| `testDb` | `(body: SetupTestDbBody) → SetupTestDbResponse` | `POST /setup/test-db` | public | mutation (no invalidation) |
| `testRedis` | `(body: SetupTestRedisBody) → SetupTestRedisResponse` | `POST /setup/test-redis` | public | mutation |
| `testSmtp` | `(body: SetupTestSmtpBody) → SetupTestSmtpResponse` | `POST /setup/test-smtp` | public | mutation |
| `testS3` | `(body: SetupTestS3Body) → SetupTestS3Response` | `POST /setup/test-s3` | public | mutation |
| `generateJwt` | `() → SetupGenerateJwtResponse` | `POST /setup/generate-jwt` | public | mutation |
| `install` | `(body: SetupInstallBody) → SetupInstallResponse` | `POST /setup/install` | public | mutation (process restarts after) |

```ts
const status = await cms.setup.status();
```
</details>

<details><summary><code>cms.mailingLists</code> — lists + subscribers (admin) and public subscribe (12 methods)</summary>

Dual mount under one handle: admin CRUD + subscriber management at
`/mailing-lists/*`; the single PUBLIC subscribe endpoint at `/lists/:slug/subscribe`.

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `list` | `() → MailingListListResponse` | `GET /mailing-lists` | admin | cached GET |
| `getById` | `(id: string) → MailingListGetResponse` | `GET /mailing-lists/:id` | admin | cached GET |
| `create` | `(body: MailingListCreateBody) → MailingListCreateResponse` | `POST /mailing-lists` | admin | mutation → mailingLists |
| `update` | `(id: string, body: MailingListUpdateBody) → MailingListUpdateResponse` | `PUT /mailing-lists/:id` | admin | mutation → mailingLists |
| `remove` | `(id: string) → MailingListDeleteResponse` | `DELETE /mailing-lists/:id` | admin | mutation → mailingLists |
| `subscribers` | `(listId: string, query?: MailingListSubscribersQuery) → MailingListSubscribersResponse` | `GET /mailing-lists/:id/subscribers` | admin | cached GET (`{ items, total }`) |
| `addSubscriber` | `(listId: string, body: MailingListSubscriberCreateBody) → MailingListSubscriberCreateResponse` | `POST /mailing-lists/:id/subscribers` | admin | mutation → mailingLists |
| `updateSubscriber` | `(listId: string, subId: string, body: MailingListSubscriberUpdateBody) → MailingListSubscriberUpdateResponse` | `PUT /mailing-lists/:id/subscribers/:subId` | admin | mutation → mailingLists |
| `removeSubscriber` | `(listId: string, subId: string) → MailingListSubscriberDeleteResponse` | `DELETE /mailing-lists/:id/subscribers/:subId` | admin | mutation → mailingLists |
| `bulkDeleteSubscribers` | `(listId: string, body: MailingListSubscribersBulkDeleteBody) → MailingListSubscribersBulkDeleteResponse` | `POST /mailing-lists/:id/subscribers/bulk-delete` | admin | mutation → mailingLists |
| `forceConfirmSubscriber` | `(listId: string, subId: string) → MailingListSubscriberForceConfirmResponse` | `POST /mailing-lists/:id/subscribers/:subId/force-confirm` | admin | mutation → mailingLists |
| `subscribe` | `(slug: string, body: ListSubscribeBody) → ListSubscribeResponse` | `POST /lists/:slug/subscribe` | optional | mutation → mailingLists (PUBLIC; double-opt-in-aware) |

```ts
await cms.mailingLists.subscribe('newsletter', { email: 'a@b.c' });
```
</details>

<details><summary><code>cms.mailTemplates</code> — block-editor email templates (8 methods)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `list` | `() → MailTemplateListResponse` | `GET /mail-templates` | admin | cached GET (meta only) |
| `getById` | `(id: string) → MailTemplateGetResponse` | `GET /mail-templates/:id` | admin | cached GET (meta + block tree) |
| `variables` | `() → MailTemplateVariablesResponse` | `GET /mail-templates/variables` | admin | cached GET (token catalog) |
| `create` | `(body: MailTemplateCreateBody) → MailTemplateCreateResponse` | `POST /mail-templates` | admin | mutation → mailTemplates |
| `update` | `(id: string, body: MailTemplateUpdateBody) → MailTemplateUpdateResponse` | `PUT /mail-templates/:id` | admin | mutation → mailTemplates |
| `remove` | `(id: string) → MailTemplateDeleteResponse` | `DELETE /mail-templates/:id` | admin | mutation → mailTemplates |
| `preview` | `(body: MailTemplatePreviewBody) → MailTemplatePreviewResponse` | `POST /mail-templates/preview` | admin | mutation (idempotent render; no invalidation) |
| `replaceBlocks` | `(id: string, body: MailTemplateBlocksReplaceBody) → MailTemplateBlocksReplaceResponse` | `PUT /mail-templates/:id/blocks` | admin | mutation → mailTemplates (transactional) |

```ts
const html = await cms.mailTemplates.preview({ templateId: id });
```
</details>

<details><summary><code>cms.mailSend</code> — tracked send jobs (6 methods)</summary>

`send` returns 202 (Accepted); the worker is async. Job/recipient lists use
offset/limit paging carried inside `data`.

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `send` | `(body: MailSendBody) → MailSendResponse` | `POST /mail/send` | admin | mutation → mailSend (202) |
| `listJobs` | `(query?: MailJobsListQuery) → MailJobsListResponse` | `GET /mail/jobs` | admin | cached GET (newest first) |
| `getJob` | `(id: string) → MailJobGetResponse` | `GET /mail/jobs/:id` | admin | cached GET (status snapshot) |
| `jobRecipients` | `(id: string, query?: MailJobRecipientsQuery) → MailJobRecipientsResponse` | `GET /mail/jobs/:id/recipients` | admin | cached GET (`{ items, total }`) |
| `retryJob` | `(id: string) → MailJobRetryResponse` | `POST /mail/jobs/:id/retry` | admin | mutation → mailSend |
| `cancelJob` | `(id: string) → MailJobPatchResponse` | `PATCH /mail/jobs/:id` | admin | mutation → mailSend (sends `{ status: 'cancelled' }`) |

```ts
const job = await cms.mailSend.send({ templateId, listId });
```
</details>

<details><summary><code>cms.payments</code> — Stripe donations, subscriptions, plans (13 methods)</summary>

`donate`/`plans` are public/optional-auth (the client still attaches a token if
present). The Stripe `webhook` route is deliberately NOT exposed.

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `donate` | `(body: PaymentsDonateBody) → PaymentsDonateResponse` | `POST /payments/donate` | optional | mutation |
| `subscribe` | `(body: PaymentsSubscribeBody) → PaymentsSubscribeResponse` | `POST /payments/subscribe` | user | mutation (may return `clientSecret`) |
| `unsubscribe` | `() → PaymentsUnsubscribeResponse` | `POST /payments/unsubscribe` | user | mutation (cancel at period end) |
| `createCustomer` | `() → PaymentsCreateCustomerResponse` | `POST /payments/create-customer` | user | mutation |
| `subscriptions` | `() → PaymentsSubscriptionsResponse` | `GET /payments/subscriptions` | user | cached GET |
| `transactions` | `(query?: PaymentsTransactionsQuery) → Paginated<UserTransaction>` | `GET /payments/transactions` | user | cached GET (paginated) |
| `plans` | `() → PaymentsPublicPlansResponse` | `GET /payments/plans` | public | cached GET |
| `adminSubscriptions` | `(query?: PaymentsAdminSubscriptionsQuery) → Paginated<AdminSubscription>` | `GET /payments/admin/subscriptions` | admin | cached GET (paginated) |
| `adminTransactions` | `(query?: PaymentsAdminTransactionsQuery) → Paginated<AdminTransaction>` | `GET /payments/admin/transactions` | admin | cached GET (paginated) |
| `adminUserTransactions` | `(userId: string) → Paginated<UserTransaction>` | `GET /payments/admin/user/:userId/transactions` | admin | cached GET (paginated) |
| `adminPlans` | `() → PaymentsAdminPlansResponse` | `GET /payments/admin/plans` | admin | cached GET |
| `createPlan` | `(body: PaymentsPlanCreateBody) → PaymentsPlanCreateResponse` | `POST /payments/admin/plans` | admin | mutation → payments |
| `updatePlan` | `(id: string, body: PaymentsPlanUpdateBody) → PaymentsPlanUpdateResponse` | `PUT /payments/admin/plans/:id` | admin | mutation → payments (union response) |

```ts
const plans = await cms.payments.plans();
await cms.payments.donate({ campaignId, amount: 2500 });
```
</details>

<details><summary><code>cms.settings</code> — public/admin settings + feature toggles (21 methods)</summary>

`update()` runs the feature dependency planner and throws `FeatureCascadeError`
on a rejected toggle (see [Feature cascade](#feature-cascade-settings-409)).
There is no `GET /settings/:key` — reads go through the literal-path getters.

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `getPublic` | `() → SettingsPublicResponse` | `GET /settings/public` | public | cached GET |
| `getAll` | `() → SettingsGetAllResponse` | `GET /settings` | admin | cached GET |
| `update` | `(body: SettingsUpdateBody) → SettingsUpdateResponse` | `PUT /settings` | admin | mutation → settings (feature toggles relay `features: [{ key, enabled, appliedMigrations }]`; throws `FeatureCascadeError` on 409) |
| `uninstallFeature` | `(key: string) → SettingsFeatureUninstallResponse` | `POST /settings/features/:key/uninstall` | admin | mutation → settings (sends `{ confirm: true }`; drops the feature's tables + data → `{ droppedTables }`) |
| `setKey` | `(key: string, body: SettingsRawKeyBody) → SettingsRawKeyResponse` | `PUT /settings/:key` | admin | mutation → settings |
| `deleteKey` | `(key: string) → SettingsRawKeyDeleteResponse` | `DELETE /settings/:key` | admin | mutation → settings |
| `getHomepageHero` | `() → SettingsHomepageHeroResponse` | `GET /settings/homepage-hero` | public | cached GET |
| `setHomepageHero` | `(body: SettingsHomepageHeroBody) → SettingsRawKeyResponse` | `PUT /settings/homepage-hero` | admin | mutation → settings |
| `getSiteHeader` | `() → SettingsSiteHeaderResponse` | `GET /settings/site-header` | public | cached GET |
| `siteHeader` | `(body: SettingsSiteHeaderBody) → SettingsRawKeyResponse` | `PUT /settings/site-header` | admin | mutation → settings |
| `getAdminAppearance` | `() → SettingsAdminAppearanceResponse` | `GET /settings/admin-appearance` | admin | cached GET |
| `adminAppearance` | `(body: SettingsAdminAppearanceBody) → SettingsRawKeyResponse` | `PUT /settings/admin-appearance` | admin | mutation → settings |
| `getSiteFooter` | `() → SettingsSiteFooterResponse` | `GET /settings/site-footer` | public | cached GET |
| `siteFooter` | `(body: SettingsSiteFooterBody) → SettingsRawKeyResponse` | `PUT /settings/site-footer` | admin | mutation → settings |
| `getSiteBranding` | `() → SettingsSiteBrandingResponse` | `GET /settings/site-branding` | public | cached GET |
| `siteBranding` | `(body: SettingsSiteBrandingBody) → SettingsRawKeyResponse` | `PUT /settings/site-branding` | admin | mutation → settings |
| `getAppearance` | `() → SettingsAppearanceResponse` | `GET /settings/appearance` | public | cached GET |
| `appearance` | `(body: SettingsAppearanceBody) → SettingsRawKeyResponse` | `PUT /settings/appearance` | admin | mutation → settings |
| `listSwatches` | `() → SettingsSiteColorsResponse` | `GET /settings/site-colors` | public | cached GET (bare array) |
| `replaceSwatches` | `(body: SettingsSiteColorsBody) → SettingsSiteColorsReplaceResponse` | `PUT /settings/site-colors` | admin | mutation → settings |
| `swatchUsages` | `(id: string) → SettingsSwatchUsagesResponse` | `GET /settings/site-colors/usages/:id` | admin | cached GET |

```ts
const pub = await cms.settings.getPublic();
await cms.settings.update({ features: { mailing_lists: true } });
```
</details>

<details><summary><code>cms.shop</code> — ecommerce: catalog, reviews, checkout, orders, settings (grouped sub-objects)</summary>

Mounted at `/api/v1/shop`; **every method 404s when the `shop` feature is
disabled** (`NotFoundError`). Exposed as grouped sub-objects
(`cms.shop.products`, `.categories`, `.collections`, `.tags`, `.reviews`,
`.checkout`, `.orders`, `.settings`) rather than a flat method list.

**`cms.shop.products`** — catalog entries with nested options/variants/media.

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `listPublic` | `(query?: ShopProductListQuery) → Paginated<ShopProductListItem>` | `GET /shop/products` | public | cached GET (active-only, paginated; adds `fromPriceCents`/`primaryImageUrl`) |
| `list` | `(query?: ShopProductListQuery) → Paginated<ShopProductListItem>` | `GET /shop/products?all=true` | public | cached GET (all-statuses, admin) |
| `getBySlug` | `(slug: string, preview?: 'admin') → ShopProductBySlugResponse` | `GET /shop/products/slug/:slug` | public | cached GET (full nested detail) |
| `getById` | `(id: string) → ShopProductByIdResponse` | `GET /shop/products/:id` | admin | cached GET |
| `create` | `(body: ShopProductCreateBody) → ShopProductCreateResponse` | `POST /shop/products` | admin | mutation → shop |
| `update` | `(id: string, body: ShopProductUpdateBody) → ShopProductUpdateResponse` | `PUT /shop/products/:id` | admin | mutation → shop |
| `remove` | `(id: string) → ShopProductDeleteResponse` | `DELETE /shop/products/:id` | admin | mutation → shop |
| `bulk` | `(body: ShopProductBulkBody) → ShopProductBulkResponse` | `POST /shop/products/bulk` | admin | mutation → shop |

**`cms.shop.categories`** (hierarchical) — `list` · `getBySlug` · `create` · `update` · `remove` (GET public / writes admin).
**`cms.shop.collections`** (curated) — `list` (public published; `all=true` admin) · `getBySlug` · `create` · `update` · `remove`.
**`cms.shop.tags`** — `list()` → distinct tag list (public).

**`cms.shop.reviews`** — moderation + rating denormalization.

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `list` | `(productId, params?) → Paginated<ShopReview>` | `GET /shop/products/:productId/reviews` | public | cached GET (approved-only) |
| `create` | `(productId, body: ShopReviewCreateBody) → …` | `POST /shop/products/:productId/reviews` | user | mutation → shop (pending; verified-purchase badge) |
| `markHelpful` | `(reviewId) → …` | `POST /shop/reviews/:id/helpful` | public | mutation → shop |
| `adminList` | `(params?) → Paginated<…>` | `GET /shop/reviews` | admin | cached GET (moderation queue) |
| `moderate` | `(reviewId, body) → …` | `PUT /shop/reviews/:id` | admin | mutation → shop (approve/reject; recomputes rating) |
| `remove` | `(reviewId) → …` | `DELETE /shop/reviews/:id` | admin | mutation → shop |

**`cms.shop.checkout`** — the on-site Stripe flow.

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `preview` | `(body: ShopCheckoutPreviewBody) → ShopCheckoutPreviewResponse` | `POST /shop/checkout/preview` | optional | mutation (server-priced totals; no order) |
| `create` | `(body: ShopCheckoutBody) → ShopCheckoutResponse` | `POST /shop/checkout` | optional | mutation → shop (`{ clientSecret, orderId, orderNumber, totalCents }`) |

**`cms.shop.orders`** — role-shaped (users see own, admins all); never cached.

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `list` | `(query?) → Paginated<…>` | `GET /shop/orders` | user (own) / admin (all) | cached GET |
| `get` | `(id) → ShopOrderResponse` | `GET /shop/orders/:id` | user / admin | cached GET |
| `getByNumber` | `(orderNumber) → …` | `GET /shop/orders/number/:orderNumber` | user / admin | cached GET (confirmation page) |
| `update` | `(id, body) → …` | `PATCH /shop/orders/:id` | admin | mutation → shop (status/fulfillment/tracking/refund) |
| `resendReceipt` | `(id) → …` | `POST /shop/orders/:id/resend-receipt` | admin | mutation |
| `downloadUrl` | `(orderNumber, token) → { url }` | `GET /shop/orders/:orderNumber/download/:token` | token-gated | GET (digital delivery) |

**`cms.shop.settings`** — `getPublic()` (storefront-safe projection, public) · `getAdmin()` (full config, admin) · `update(body)` (`PUT /shop/settings`, admin merge).

```ts
const { data: products } = await cms.shop.products.listPublic({ page: 1 });
const product = await cms.shop.products.getBySlug('t-shirt');
const preview = await cms.shop.checkout.preview({ items: [{ variantId, qty: 2 }] });
const { clientSecret, orderNumber } = await cms.shop.checkout.create({ /* items + address */ });
```
</details>

<details><summary><code>cms.feed</code> — RSS 2.0 (1 method)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `xml` | `() → FeedXmlResponse` (string) | `GET /feed.xml` | public | raw (root-mounted, skips `/api/v1`) |

```ts
const rss = await cms.feed.xml(); // XML string
```
</details>

<details><summary><code>cms.sitemap</code> — sitemap XML + regenerate (2 methods)</summary>

| Method | Signature | HTTP | Auth | Cache |
|--------|-----------|------|------|-------|
| `xml` | `() → SitemapXmlResponse` (string) | `GET /sitemap.xml` | public | raw (root-mounted) |
| `regenerate` | `() → SitemapRegenerateResponse` | `POST /admin/sitemap/regenerate` | admin | mutation → sitemap (normal JSON envelope) |

```ts
const xml = await cms.sitemap.xml();
await cms.sitemap.regenerate();
```
</details>

---

## Drift & coverage

The method surface mirrors `docs/api-manifest.json` (29 modules / 234 routes).
`src/modules/coverage.ts` declares `ROUTE_COVERAGE` (one entry per client
method, in manifest form) and `INTENTIONALLY_UNEXPOSED`.
`npm run check:drift -w packages/cms-client` (`scripts/check-drift.ts`) asserts
that **every** manifest route appears in exactly one of the two sets — a new
uncovered backend route fails CI.

**The 6 intentionally-unexposed routes** (server-internal redirects, raw HTML,
or the signature-verified webhook — no consumer-facing client surface):

| Route | Why unexposed |
|-------|---------------|
| `POST /api/v1/payments/webhook` | Stripe webhook — raw body, signature-verified server-side. |
| `GET /api/v1/auth/patreon/callback` | OAuth callback — browser redirect that sets cookies. |
| `GET /api/v1/connections/:provider/oauth/callback` | OAuth callback — browser redirect. |
| `GET /u/:token` | Unsubscribe — raw HTML page served to the browser. |
| `GET /u/:token/resubscribe` | Resubscribe — raw HTML page. |
| `GET /lists/:slug/confirm/:token` | Double-opt-in confirmation — raw HTML page. |

Feed and sitemap (`/feed.xml`, `/sitemap.xml`) ARE exposed, as raw
string-returning helpers (`cms.feed.xml()`, `cms.sitemap.xml()`).
