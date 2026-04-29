# CMS SDK design

## Goal

Give every CMS capability a single, plain-Node, framework-free entry point so:

- Routes are thin shims (HTTP shape ↔ SDK call).
- Scripts, tests, and future plugins can drive the system without going through Express.
- New capabilities follow a uniform contract, so adding `cms.media` or `cms.surveys` is a fill-in-the-blanks exercise rather than a bespoke design.

## Layering

```
HTTP route (Express)        →  translates HTTP to/from typed calls
        ↓
SDK service (cms.<name>)    →  domain logic, validation, cache + audit
        ↓
Repository (.repo.ts)       →  parameterised SQL, row mapping
        ↓
Postgres / Redis / disk
```

Concerns by layer:

| Layer | Owns |
|---|---|
| **Route** | HTTP semantics (status codes, multipart parsing, cookies, CSRF, auth gates), response formatting. *Never* contains business logic. |
| **SDK service** | Validation beyond schema, cache invalidation, audit logging, lifecycle hooks, side effects (file writes, search-index updates). Throws typed errors. |
| **Repository** | SQL only. snake↔camel mapping. Returns plain rows. No cache, no logging, no I/O outside the database. |

A capability that doesn't have meaningful domain logic still gets an SDK module — the module becomes a thin pass-through to the repo for now, and gains weight as the domain grows. Routes always import the SDK, never the repo directly.

## The Service contract

`backend/src/sdk/types.ts` defines the shape every capability follows:

```ts
export interface Service<TEntity, TCreate, TUpdate, TFilters = void> {
  list(filters?: TFilters, pagination?: PaginationOpts): Promise<ListResult<TEntity>>;
  getById(id: string): Promise<TEntity | null>;
  create(input: TCreate, ctx: AuditContext): Promise<TEntity>;
  update(id: string, patch: TUpdate, ctx: AuditContext): Promise<TEntity>;
  remove(id: string, ctx: AuditContext): Promise<TEntity | null>;
}
```

Most capabilities also expose:

- A slug-or-public lookup (`getBySlug`, `getPublicById`) that applies the public-visibility gate.
- Capability-specific subroutines (e.g. `cms.posts.saveContentBlocks`, `cms.fonts.findByCustomId`).

Capabilities are **not required** to implement the full `Service` interface — fonts has no `update`, settings has no `getById` (it's keyed by string). The interface is a target, not a constraint.

## Errors

The SDK throws typed errors from `middleware/error.ts`:

- `NotFoundError` → 404
- `ValidationError` → 400
- `AuthError` → 401 / 403

The route layer catches via the existing `handleRouteError` and the global error middleware. Plugins / scripts catch the typed error directly and react in code.

## Audit + cache

Both lifecycles are SDK responsibilities:

- **Audit**: every write takes an `AuditContext` (`{ userId, ipAddress?, userAgent? }`) and emits a row through `services/audit.logAudit`. The route layer pulls these from `req.user` / `req.ip` / `req.headers` and hands them to the SDK.
- **Cache**: each capability owns the keys it writes. `cms.pages` invalidates `page:slug:*` and `page:homepage`; `cms.posts` invalidates `post:slug:*`. SDK helpers wrap the existing `services/cache` module.

This means a future plugin that calls `cms.pages.create(data, ctx)` automatically gets cache invalidation + audit logging — none of that lives at the route layer.

## Lifecycle hooks (forward-looking)

To support plugins, every Service exposes a small event surface:

```ts
cms.pages.on('create', async (page, ctx) => { /* search index update */ });
cms.pages.on('remove', async (page, ctx) => { /* cleanup links */ });
```

Implementation v1 ships **without** the hook system — the design space is reserved (the doc identifies it) but the code surface stays small until a real plugin shows up. When we add it, the pattern is a small `EventEmitter`-like helper in `sdk/types.ts` that every Service instantiates internally.

## Frontend mirror

Long-term, `frontend/src/sdk/` mirrors the backend shape so admin code reads `cms.pages.list()` instead of `api.get('/pages')`. v1 keeps the existing `services/*.ts` files; the mirror is built capability-by-capability as needed.

## Migration strategy

Routes migrate to the SDK incrementally, capability by capability. The order:

1. **Greenfield** capabilities (fonts done, plugins later) start at the SDK and never touch repos directly.
2. **High-touch** capabilities (pages, posts) get an SDK module first; the create/update endpoints migrate one at a time.
3. **Long-tail** capabilities (campaigns, forms, messages, social) get SDK modules when their routes need substantial work anyway — no churn for the sake of churn.

The win compounds: every migrated route is shorter, every SDK module is reusable, and plugin code can hit any migrated capability without reinventing the call.

## What's in this work

- `sdk/types.ts` — contracts.
- `sdk/index.ts` — `cms` aggregator.
- `sdk/fonts.ts` — already shipped.
- `sdk/pages.ts`, `sdk/posts.ts`, `sdk/settings.ts` — added in this work.
- One route per capability migrated (POST /pages, POST /posts) to demonstrate the layering. Other routes still call repos directly; they'll migrate as touched.

Future work (separate sessions):

- `sdk/campaigns`, `sdk/forms`, `sdk/messages`, `sdk/swatches`, `sdk/media`.
- Lifecycle event surface.
- Frontend SDK mirror.
- Plugin discovery + lifecycle.
