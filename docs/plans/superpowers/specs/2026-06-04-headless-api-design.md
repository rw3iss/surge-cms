# Headless API Design — Typed Route Manifest, Service Layer, API Keys

Date: 2026-06-04
Status: Approved

## Goal

Prepare the entire CMS backend for headless operation: any client (the bundled
SolidJS frontend, mobile apps, standalone agents, third-party integrations) can
consume the full `/api/v1/` surface with proper token auth, role-shaped
responses, a single well-defined error format, and a machine-readable route
manifest from which a client SDK can later be generated.

## Decisions (settled with the user)

1. **Refactor depth:** routes become thin HTTP shells; ALL business logic and
   SQL live in one canonical service module per entity. The existing internal
   `cms.*` SDK (`backend/src/sdk/`) is absorbed/evolved into this service
   layer — used as a reference, not a constraint.
2. **Contract form:** a typed route manifest in code (no OpenAPI YAML). All
   shared types centralized in the `shared` workspace (`@rw/shared`),
   organized by module. Backend, frontend, and future SDKs all import from
   `shared`. DRY is a hard requirement.
3. **Auth:** Bearer JWT for users (login via normal auth routes) + real API
   keys for standalone clients/agents (no user, no login flow). CSRF exempts
   header-authenticated requests.
4. **Route paths:** breaking normalization is allowed. The bundled frontend is
   the only consumer and is updated in the same pass.

## Architecture

```
shared/src/
├── types/<module>.ts        # entity + DTO types, one file per module
├── api/
│   ├── contract.ts          # ApiResponse<T>, ApiErrorBody, ErrorCode, pagination types
│   ├── auth.ts              # AuthTier = 'public' | 'optional' | 'user' | 'admin' | 'apiKey'
│   └── routes/<module>.ts   # per-endpoint input/output DTO types (future client SDK imports these)
└── utils/                   # existing + anything hoisted from backend/frontend duplication

backend/src/
├── api/
│   ├── defineRoute.ts       # defineRoute({ method, path, auth, input, handler }) → RouteDef
│   ├── registry.ts          # collects RouteDefs; mount(router) + manifest() emitter
│   └── apiKeys.ts           # API-key auth middleware + verification
├── services/<module>.ts     # canonical service per entity (evolved from sdk/*)
├── repositories/            # stays beneath services (SQL + row mapping)
└── routes/<module>.ts       # defineRoute() declarations only — zero business logic
```

### defineRoute / registry

- Each endpoint is one `defineRoute()` call: `method`, `path`, `auth` tier,
  zod `input` schema (params/query/body), and a typed `handler(ctx)` that
  calls the service and **returns** data (or throws an `AppError`).
- The wrapper provides: auth enforcement per tier, zod validation
  (failures → `VALIDATION_ERROR` with field details), async try/catch
  forwarding to the central error middleware, and response shaping into
  `ApiResponse<T>`. No hand-written `res.json`, no per-route try/catch.
- The registry collects every RouteDef, builds the Express router, and emits
  a manifest (JSON + markdown) — the machine-readable source of truth for
  docs and later SDK generation.
- Special cases (file streaming, webhooks with raw bodies, redirects like
  `/u/:token` unsubscribe, RSS/sitemap XML) may use an escape hatch
  (`raw: true` handler receiving `req/res`) but still register in the
  manifest with auth tier + description.

### Service layer

- Keep from existing `cms.*`: `AuditContext` on all writes,
  `auditFromRequest(req)`, `ListResult<T>` + `PaginationOpts` shapes.
- Extend to full coverage: media, payments, settings, mail (templates, lists,
  send jobs), connections, social, search, dashboard, audit, auth/session
  management — every operation a route performs today.
- Services own cache read/invalidate calls (Redis), sanitization, and
  cross-entity orchestration. Repositories own SQL.

## Auth model

| Tier       | Who                        | Mechanism |
|------------|----------------------------|-----------|
| `public`   | anyone                     | none |
| `optional` | anon or logged-in          | response shaped by role (admins see drafts; gated content unlocks per membership) |
| `user`     | any authenticated user     | Bearer JWT (or cookie for bundled frontend) |
| `admin`    | admin role                 | Bearer JWT / cookie |
| `apiKey`   | standalone clients, agents | `Authorization: Bearer ssk_…` — no user identity |

- **CSRF:** requests carrying an `Authorization` header (valid JWT or API key)
  skip the CSRF cookie/header check; cookie-authenticated browser requests
  keep it. Change isolated to `middleware/csrf.ts`.
- **API keys:** new migration `api_keys` (id, name, key_hash, scopes[],
  created_by, last_used_at, revoked_at, created_at). Plaintext key (prefix
  `ssk_`) shown exactly once at creation; stored hashed (sha256). Scopes are
  coarse: `read`, `write`, `admin`. Admin-tier routes accept an admin JWT OR
  an API key with sufficient scope. Admin endpoints: create / list / revoke,
  plus a minimal **Settings → API Keys** panel in the admin UI.
- API-key writes audit-log with a synthetic actor (`api-key:<name>`).

## Route normalization (breaking)

Uniform REST convention per module; the `/public` suffix is removed —
`optional` auth shapes the response instead:

```
GET    /<module>                 list (anon → published/visible only; admins may filter ?status=…)
GET    /<module>/:id             by id
GET    /<module>/slug/:slug      by slug (pages, posts, campaigns, forms)
POST   /<module>                 create   (admin)
PUT    /<module>/:id             update   (admin)
DELETE /<module>/:id             delete   (admin)
POST   /forms/:id/submissions    sub-resources are nouns, not verbs
```

All 27 route files are normalized to this convention. `frontend/src/services/api.ts`
(and any other frontend call sites) are updated module-by-module in the same
commits so the app never breaks between phases.

## Error handling

- One envelope, defined in `shared/src/api/contract.ts`:
  `{ success: false, error: { code: ErrorCode, message: string, details?: unknown } }`.
- `ErrorCode` is a shared enum (UNAUTHORIZED, FORBIDDEN, NOT_FOUND,
  VALIDATION_ERROR, CONFLICT, RATE_LIMITED, BAD_REQUEST, INTERNAL_ERROR,
  SERVICE_UNAVAILABLE) so clients can switch on it.
- Everything funnels through the central error middleware; the defineRoute
  wrapper guarantees no unhandled rejection escapes. Unknown errors map to
  `INTERNAL_ERROR` with no internals leaked in production.

## Documentation

- `npm run docs:api` script renders the registry manifest →
  `docs/API.md` (human-readable: method, path, auth tier, description,
  input/output type names) and `docs/api-manifest.json` (machine-readable,
  consumed by the future SDK generator).
- README gains a "Headless Mode" section: auth flows (login → access/refresh,
  Bearer usage, refresh without cookies), API-key creation and usage, CORS
  (`CORS_ORIGINS`), curl examples, link to `docs/API.md`.
- CLAUDE.md updated: new architecture (api/ framework, services as canonical
  layer), auth tiers, route conventions, docs generation command.

## Phased execution

1. **Foundation** — shared types reorg + `api/contract.ts` + `api/auth.ts`;
   defineRoute/registry framework; CSRF Bearer exemption; error
   standardization. Convert one pilot module (**posts**) end-to-end —
   service, manifest routes, normalized paths, frontend update — to prove
   the pattern.
2. **API keys** — migration, middleware, admin endpoints, Settings panel.
3. **Module sweep** — convert remaining modules in batches:
   content (pages/blocks/blockStyles/fonts), commerce (campaigns/payments),
   engagement (forms/messages/users/auth), platform (media/social/settings/
   search/dashboard/audit/connections), mail (templates/lists/send/
   unsubscribe), misc (feed/sitemap/health/setup/dev). Normalize paths +
   update frontend per batch; build verified after each batch.
4. **Docs** — manifest generator, `docs/API.md`, README headless section,
   CLAUDE.md sync.

## Out of scope (YAGNI)

- No OpenAPI/Swagger emission (manifest can grow one later if needed).
- No webhooks, no GraphQL, no multi-version API serving.
- No published npm client SDK yet — this pass makes generating it trivial;
  generation is the agreed follow-up.

## Risks / mitigations

- **Breadth** (~7,300 route lines + frontend call sites): phased batches,
  build + smoke after each; frontend updated in the same commit as each
  module's renames.
- **Behavioral drift during route → service extraction:** preserve existing
  semantics (cache keys, sanitization, role gating) verbatim first; improve
  only where the spec demands (auth tiers, error format, paths).
- **Special routes** (Stripe webhooks raw-body, media streaming, RSS/XML,
  setup wizard): explicit `raw` escape hatch so they keep exact behavior
  while remaining in the manifest.
