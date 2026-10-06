# cms-web → @sitesurge/client Full Typed Migration — Design

Date: 2026-06-08
Status: Approved

## Goal

Migrate the `@sitesurge/admin` SolidJS app (`packages/cms`) to consume
`@sitesurge/client` for ALL backend communication. Delete `services/api.ts`
and its envelope; every call site uses the typed client singleton
(`cms.<module>.<method>()`), with try/catch error handling and the
client's error bus for cross-cutting 401/503 behavior. Cookie auth mode
preserves today's httpOnly+CSRF session with no backend change.

Survey: 253 call sites / 53 files; ~100 `if(response.success)` branches;
cookie auth today; two high-leverage hooks (usePaginatedList,
useBulkActions). Mapping table in the survey (api.ts → cms.*).

## Settled decisions

1. **Pagination:** the client's paginated list methods return
   `Paginated<T> = { data: T[]; meta: PageMeta }` (PageMeta =
   `{ page, limit, total, totalPages }`, all optional to match the
   envelope). Single-entity GETs return the entity directly. This
   requires a client change (Phase A) before the app migration.
2. **List hook:** `usePaginatedList` takes a typed fetcher
   `fetch: (params) => Promise<Paginated<T>>`. `useBulkActions` takes
   `bulk: (body) => Promise<...>`. ~10 + ~5 call sites updated to pass
   the typed method.
3. **api.ts:** DELETED. Named helpers + namespaced API objects + the
   ApiService class all go away; call sites use `cms.*` directly.

## Phase A — client: paginated meta (prerequisite, in @sitesurge/client)

- `packages/shared/src/api/contract.ts`: export `PageMeta` (alias of the
  meta shape) and `Paginated<T> = { data: T[]; meta: PageMeta }`.
- `packages/cms-client/src/modules/base.ts`: add
  `protected getPaged<T>(path, opts): Promise<Paginated<T>>` that routes
  through the core but returns BOTH data and meta. The core's
  `performRequest`/`send` currently discards `payload.meta`; add a core
  path that surfaces it. Approach: `CmsClientCore.sendPaged<T>(req)`
  returns `{ data, meta }` by reading the envelope's meta (a small
  variant of `send` that does not strip meta; still caches under the same
  key — cache stores `{data, meta}` for paged reads). Keep the plain
  `send`/`get` for entity reads unchanged.
- Update every list/paginated method across the 26 module files to return
  `Paginated<EntityDTO>` via `getPaged` (posts.list, pages.list,
  campaigns.list/listPublic, forms.list/listPublic, users.list,
  messages.list, media.list, audit.list, mailingLists.list/subscribers,
  mailSend.listJobs/jobRecipients, payments.transactions/admin lists,
  social feeds where paginated, connections list if paginated, etc.).
  Non-paginated collection reads (e.g. blockStyles.list returns all,
  settings.listSwatches) stay as bare arrays — only routes whose backend
  emits `meta` become Paginated. Verify against each route's handler
  (reply with meta vs bare data).
- Update DTOs/docs: the route DTO files' `XListResponse` stays the element
  array (the wire `data`); the client method's RETURN becomes
  `Paginated<Element>`. Update `docs/api-manifest.json`? No (routes
  unchanged). Update `packages/cms-client/docs/Overview.md` list-method
  signatures + add a "Pagination" subsection. Drift check unaffected
  (paths unchanged).
- Tests: extend the client unit tests — a paged list returns
  `{ data, meta }` with total/totalPages from the envelope; an
  entity get still returns the entity. tsc + build + check:drift green.
- Bump client version (0.2.0). One or more commits.

## Phase B — cms-web foundation

- Add `@sitesurge/client` dep to `packages/cms/package.json`
  (`file:../cms-client`); `npm install`.
- `packages/cms/src/services/cmsClient.ts`: the singleton —
  `createClient({ baseUrl: window.location.origin, auth: { mode: 'cookie' },
  cache: { adapter: 'localstorage' } })` (localStorage adapter: SWR cache
  survives reloads, IndexedDB optional later). Export `cms`. Wire the
  error bus: `cms.onError(e => { ... })` replicating api.ts's cross-cutting
  behavior — on `UnauthorizedError` from a non-auth path → call the
  registered session-expired handler (keep the `setUnauthorizedHandler`
  indirection or a small event); on `ServiceUnavailableError`/NEEDS_SETUP
  → redirect to `/setup` (unless already there). Document the nuance:
  login/auth 401s must NOT trigger the session-expired modal (filter by
  error.requestId/path or handle in the auth store's own try/catch).
- Decide SolidJS adapter usage: where a page wants reactive SWR updates,
  use `createCmsResource` from `@sitesurge/client/solid`; otherwise plain
  `createResource(() => cms.x.y())` is fine. Not mandatory everywhere.

## Phase C — hooks + auth store

- `usePaginatedList`: signature → `{ fetch: (params) => Promise<Paginated<T>>,
  initialLimit?, params?: () => Record<string,unknown> }`. Internally
  call `fetch(params)`, read `result.data`/`result.meta.total`/`totalPages`;
  errors surface via the bus (the hook returns empty + the bus toasts).
  Update all ~10 callers to pass `fetch: (p) => cms.<module>.list(p)`.
- `useBulkActions`: `{ bulk: (body) => Promise<{updated:number}>, onComplete? }`
  (or keep entityType and map to `cms[entity].bulk`). Update ~5 callers.
- `stores/auth.tsx`: replace `api.post('/auth/login')`/`api.get('/auth/me')`
  /logout/autologin with `cms.auth.login/me/logout/autologin`. Login
  returns AuthResponse (typed) — set user from `res.user`; cookie mode
  means tokens are backend-managed, so the client's bearer token store is
  unused (cookie mode), but cms.auth.login still POSTs and returns the
  user. me() throws UnauthorizedError on no session → catch → setUser(null)
  / session-expired. Preserve the manuallyLoggedOut flag, the
  verifySession tab-focus check, loginWithPatreon redirect, the modal.

## Phase D — call-site migration (batched by area)

Per the survey's mapping table. Each batch: rewrite the area's call sites
to `cms.*`, convert `if(response.success)` → try/catch (or rely on the
bus for non-critical reads), read `{data, meta}` for lists. tsc --noEmit
+ build green per batch; one commit per batch.

- **D1 Public pages + helpers' callers:** Home, Posts, Post, Campaign(s),
  Donate, Form, Contact, Search, Shop, DynamicPage, Subscribe, layout
  (Header/Footer/nav), the `fetch*` helper call sites. Public reads;
  ContentLockedError already handled in Post/DynamicPage — keep.
- **D2 Admin list/editor pages (hook-driven + direct):** Posts, Pages,
  Campaigns, Forms, Users, Messages, Media, MailingLists, Connections,
  Settings, Dashboard + the editors (PostEditor, PageEditor,
  CampaignEditor, FormEditor, etc.). Uses the new hooks + direct cms.*.
- **D3 Blocks + block editor:** BlockRenderer, PostListBlock, SocialBlock,
  CampaignBlock, FormBlock, etc. — the block data loaders.
- **D4 Components/modals/panels + services:** MediaUploadModal/SelectModal,
  RevisionsPanel, settings panels, MailSend/MailTemplate flows, and the
  internal services (postsService, blockStyles, siteColors, fonts,
  requestCache usage) — fold request-scoped caching into the client's SWR
  or keep requestCache wrapping cms.* calls.
- **D5 Delete api.ts:** remove `services/api.ts` once zero importers;
  `grep` confirms; remove its tests if any. Fix stragglers.

## Phase E — verify + docs

- Full `npm run build` (all workspaces), `tsc --noEmit -p packages/cms`,
  client tests, check:drift. A manual side-port smoke: boot API on 3101,
  run cms dev build, spot-check login + a public page + an admin list
  load against the live API (or at least confirm the built app's network
  calls hit the right endpoints).
- Docs: update CLAUDE.md (cms-web now consumes the client; api.ts gone;
  the cmsClient singleton is the one networking path; hook signatures).
  Update client Overview.md pagination. Update client-sdk-plan.md
  (@sitesurge/admin migrated).

## Risks / mitigations

- **Scale (253 sites):** batch by area; tsc + build gate every batch; the
  typed methods make wrong endpoints/DTOs compile errors.
- **Meta change ripples the client:** Phase A lands + client tests before
  the app touches it; bump client version.
- **Auth behavior parity:** cookie mode + the error bus replicate
  401/503/session-expired; auth-path 401s filtered from the modal.
- **Lost envelope branches:** each `if(response.success)` becomes
  try/catch; reads that merely display data can lean on the error bus and
  a fallback value rather than bespoke per-call handling.
- **requestCache vs SWR double-caching:** prefer the client's SWR; where
  requestCache stays, ensure it wraps cms.* without conflicting TTLs.

## Out of scope

- Switching the app to bearer auth (cookie mode retained).
- Backend changes (none needed).
- Migrating to the SolidJS adapter everywhere (used where it adds value).
