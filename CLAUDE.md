# SiteSurge CMS

## Project Overview

SiteSurge (a.k.a. SiteSurge CMS) is a self-hosted, feature-based, block-based general-purpose CMS. Pages, posts, campaigns, forms, users, media, social connections, plus a custom header/footer editor and a global appearance system (swatches, fonts, block-style templates).

Monorepo with four workspaces under `packages/*`: `api` (`@rw/cms-api`, Express/Node), `cms` (`@rw/cms-web`, SolidJS), `shared` (`@rw/cms-shared`, types/DTOs/utils consumed by all), `cms-client` (`@rw/cms-client`, headless TS client — **fully implemented**). All build/tool config lives in `./config`.

**Stack:** SolidJS + Vite | Express + PostgreSQL + Redis | Stripe | Patreon OAuth | S3/Local storage

The repo directory and `@rw/cms-*` scope are historical and will be renamed to SiteSurge in a future cut. Treat them as opaque package names — the product is SiteSurge.

## Core Capabilities
- **Block-based editor** — categorized AddBlockMenu (Text / Media / Blocks / Layout, collapsible per category, feature-flag gated). Blocks: Rich Text, Custom HTML, URL Link, Image (multi-image), Video, Document, Hero, Carousel, Posts, Campaign, Form, Social, Group, Spacer. Click-outside-to-deselect + Escape close the flyout. Per-block trash icon. Recent-items submenus on Campaign/Form/Posts pre-fill the new block's id.
- **Group block** — recursive composition via `parent_block_id` (migration 026). Flex container with direction, 1-16 columns, item min/max width+height, wrap, align/justify. Each slot is a `group_item` holding ≤1 child; empty slots show an inline picker. Tree assembly via `buildBlockTree(flat)` shared utility.
- **Inline editing** — Rich Text and Custom HTML edit in place on the block preview. HTML block has a code ↔ preview toggle (CodeMirror 6 with HTML lang), drag-resize on the bottom edge, and per-block height persisted in `localStorage` under `sitesurge.editor.blockHeights`.
- **Image block** — multi-image with thumbnail strip, per-image Select Media / Upload New / URL paste / alt / caption / link / allowMaximize. Block-level direction + item min/max width+height (any CSS length).
- **Social block** — provider + count + per-slot pinning. Auto-feed when no slots are filled; pinned posts otherwise. Per-slot inline search dropdown of recent posts; "Edit…" opens a full search modal preconfigured to the provider.
- **Preview mode** — wraps content in the public `<Layout>` so previews render the real site header, footer, navigation, swatches, fonts, and appearance. Pages also wrap in `.dynamic-page.page-wrapper`; posts in `.post-page.page-wrapper`.
- **Posts & pages** — drafts, publish, revisions, SSR body for SEO, RSS at `/feed.xml`, full-text search.
- **Campaigns + donations** — Stripe Elements, recurring subscriptions, public-donor toggle.
- **Forms / surveys / polls** — typed question library, submission inbox, CSV export.
- **Users & roles** — email/password + Patreon OAuth, member tiers, gated content, user/IP bans.
- **Mailing lists** — opt-in feature module (`mailing_lists`, requires `users`). Per-list subscribers (registered users or email-only), token-based one-click `/u/:token` unsubscribe + RFC 8058 `List-Unsubscribe` headers, optional per-list double opt-in. Mail templates reuse the existing block editor; backend email renderer adapts every block type to table-based inline-style HTML and resolves `swatch:{id}` refs to literal hex via the palette. Send wizard creates tracked jobs (`mail_send_jobs` + `mail_send_recipients`) processed by an in-process worker with concurrency/delay knobs and a boot-time resumer. Provider abstraction (`MailProvider`): SMTP (Nodemailer, default — works with any SMTP relay incl. SendGrid/Mailgun/Postmark/SES) and stubs for native REST adapters. Welcome / donation-receipt emails flow through the same pipeline.
- **Feature module system** — `FEATURE_REGISTRY` (`packages/api/src/features/registry.ts`) declares prerequisites + lazy-install migrations. `PUT /settings` runs the dependency planner (`validateEnable`) and applies pending migrations under `pg_advisory_xact_lock` before flipping each feature's `*_enabled` row. SQL migrations are tagged with `-- @feature <key>` headers; the runner skips disabled features on boot. `bootRunningMode()` runs `runMigrations()` at startup so post-enable migrations land on the next restart without manual `npm run db:migrate`.
- **Media library** — sharp thumbnails, local FS or S3. Reusable `MediaSelectModal` and `MediaUploadModal` mounted via Portal.
- **Social connections** — pull-based sync (YouTube, Instagram, X, Facebook, TikTok, Patreon).
- **Header & footer editors** — drag-and-drop rows + columns, fully styled.
- **Appearance** — shared color swatches (`swatch:{id}` references), custom fonts (`@font-face` injection), reusable block-style templates.
- **API keys** — Settings → API Keys issues scoped `ssk_` keys for headless clients (hash at rest, shown once, revocable). `admin`/`apiKey`/`optional`-tier routes accept them; admin-shaped responses bypass the public cache.
- **Backend SDK** — `cms.*` typed surface for routes / scripts / future plugins. `cms.pages.reorderBlocks(pageId, parentBlockId, blockIds, ctx)` is per-parent. (migrating to `services/<module>.ts` — see Key Patterns)
- **Block IDs** — admin generates real UUIDs (`crypto.randomUUID`) so a child block can reference its parent before either has saved. Backend `createBlock` accepts a client-supplied `id`.
- **First-run setup wizard** — `/setup` walks env, migrations, seed, admin creation.
- **PWA + CDN-ready** — static frontend bundle, app shell.

## Removed / merged block types
- `post` (single embed) → merged into Posts (`post_list` type, labelled "Posts" in the picker). Migration 027 deletes legacy rows.
- `gallery` → folded into the multi-image upgrade of `image`. Migration 027 deletes legacy rows; public renderer shows a polite fallback note for any that survived.
- `social_media` + `social_feed` → unified as a single `social` block type (label: "Social"). Migration 028 deletes legacy `social_media` rows; migration 029 renames `social_feed` rows to `social` and adds the `social` enum value. Single-post and feed UX live in one editor.
- Enum values stay in `block_type` for safety; the picker just doesn't surface them.

## Admin styles
- `packages/cms/src/pages/admin/AdminLayout.scss` is a slim index — actual rules live in `packages/cms/src/pages/admin/styles/_*.scss` partials grouped by feature (admin shell, block editor, inline editors, dashboard, settings, etc.) and in `packages/cms/src/styles/shared/` for things both the admin and the main site use.
- **Read `packages/cms/src/components/admin/ADMIN_STYLES.md` before adding admin styles.** It documents which partial owns what, when to hoist to `styles/shared/` vs keep admin-local, and the convention for `@use 'sass:color';` + `@use '../../../styles/variables' as *;` at the top of each partial.
- Repeated inline `style={{ ... }}` patterns belong in a partial. Common shared helpers (`.confirm-modal*`, `.preview-empty-message`, `.form-help-muted`) live in `styles/shared/` or `global.scss`.

## Theme tokens (CSS custom properties)
- **Site-wide** (`Layout` applies these from `AppearanceSettings`): `--site-primary`, `--site-link`, `--site-heading`, `--site-bg`, `--site-text`, `--site-text-muted`, `--site-border`, `--site-font`, `--site-heading-font`, `--site-heading-weight`, `--site-radius`, `--site-gutter`, `--site-max-width`, `--site-block-padding`, `--site-line-height`. Public-side inline styles should reference these (e.g. `color: var(--site-text-muted, #6b7280)`) so an operator-set theme propagates.
- **Admin shell** (declared in `pages/admin/styles/_admin-typography.scss`): `--admin-text`, `--admin-text-muted`, `--admin-border`, `--admin-bg-subtle`, plus `--admin-font-display`, `--admin-font-body`, `--admin-font-mono`. Admin-side inline styles use these. The token values come from `styles/variables.scss`.
- Hardcoded grays (`#888`, `#999`, `#bbb`, `#ccc`, `#d0d0d0`) in SCSS partials are already swept onto `$text-light` / `$text-color` / `$border-color` from the token palette. Don't add new literal hex values — extend `variables.scss` instead.

## Architecture

```
rw-cms/
├── packages/
│   ├── api/         # @rw/cms-api  — Express REST API (port 3001), SSR, migrations
│   ├── cms/         # @rw/cms-web  — SolidJS SPA (port 3000, proxies API to 3001)
│   ├── shared/      # @rw/cms-shared — types, src/api/routes/ DTOs, format/validation utils
│   └── cms-client/  # @rw/cms-client — headless HTTP client (implemented)
├── config/          # all build/tool config (per-package subdirs + repo-wide)
└── docs/            # API.md, api-manifest.json, client-sdk-plan.md, plans/specs
```

### Monorepo Setup
- npm workspaces `packages/*`: `@rw/cms-api`, `@rw/cms-web`, `@rw/cms-shared`, `@rw/cms-client`
- `npm run dev` runs api + web app via concurrently
- `npm run build` is **dependency-ordered**: shared → api → cms → cms-client (shared compiles first)
- `npm test` runs `--workspaces --if-present` (only api ships tests today)
- Node >= 20.0.0 required
- `@rw/cms-shared` (types + API DTOs + format/validation utils) is imported by all other packages; it imports from none of them

## Backend

### Architecture (SOLID Principles)
```
packages/api/src/
├── api/             # Route framework: defineRoute(), registry (mount + manifest), auth tiers, role helpers
├── repositories/    # Data access layer (SQL queries, row mapping)
│   ├── base.repo.ts       # Shared pagination, findById, updateById, deleteById
│   ├── pages.repo.ts      # Pages & blocks queries
│   ├── posts.repo.ts      # Posts & content blocks queries
│   ├── campaigns.repo.ts  # Campaigns & donations queries
│   ├── users.repo.ts      # Users & bans queries
│   ├── forms.repo.ts      # Forms, questions, submissions queries
│   └── messages.repo.ts   # Contact messages queries
├── routes/          # HTTP layer (validation, auth, response formatting)
├── services/        # Business logic (auth, email, payment, social, audit)
├── middleware/       # Cross-cutting concerns (auth, csrf, content-access, error)
├── utils/           # Shared utilities
│   ├── mapRow.ts          # snake_case → camelCase mapping
│   ├── response.ts        # Standardized API response helpers
│   ├── sanitize.ts        # HTML sanitization (sanitize-html)
│   └── logger.ts          # Winston logger
└── db/              # Database schema, migrations, seed
```

### Entry Points
- `packages/api/src/index.ts` - main entry, connects DB/Redis, starts server
- `packages/api/src/app.ts` - Express app factory with middleware chain

### Database
- PostgreSQL with raw `pg` queries (no ORM)
- Schema: `packages/api/src/db/schema.sql` (idempotent, uses IF NOT EXISTS)
- Migrations: `packages/api/src/db/migrations/` (numbered SQL files)
- Seed: `packages/api/src/db/seed.ts` (admin user, sample data)
- Key tables: users, pages, blocks, posts, post_content_blocks, campaigns, donations, forms, form_questions, form_submissions, contact_messages, media, social_connections, social_posts, site_settings, subscription_plans, subscriptions, transactions, audit_log, api_keys

### Authentication
- JWT access tokens (15min) + refresh tokens (7d)
- Tokens set in httpOnly cookies AND returned in response
- Patreon OAuth flow for member registration
- Email/password for admin accounts (bcrypt, 12 rounds)
- Middleware: `authenticate(required?)`, `requireRole(...roles)`, `requireAdmin`
- Sessions stored in `user_sessions` table

### Routes (all under `/api/v1/`)
| Prefix | File | Auth | Description |
|--------|------|------|-------------|
| /auth | auth.ts | varies | Login, OAuth, refresh, logout |
| /pages | pages.ts | public + admin | CMS pages with blocks |
| /posts | posts.ts | public + admin | Blog posts with content blocks |
| /campaigns | campaigns.ts | public + admin | Fundraising campaigns |
| /payments | payments.ts | varies | Stripe donations & subscriptions |
| /forms | forms.ts | public + admin | Form builder & submissions |
| /users | users.ts | admin | User management & banning |
| /messages | messages.ts | public + admin | Contact form messages |
| /media | media.ts | admin | File upload & management |
| /social | social.ts | public + admin | Social media feed sync |
| /settings | settings.ts | public + admin | Site configuration |
| /search | search.ts | public + admin | Full-text search |
| /health | health.ts | none | Health/readiness checks |
| /api-keys | apiKeys.ts | admin (JWT only) | API key management |

Root-mounted raw modules (outside `/api/v1`, registered in `app.ts`): `feed` (`/feed.xml`, RSS), `sitemap` (`/sitemap.xml`), `unsubscribe` (`/u/:token`, `/lists/:slug/confirm/:token`, HTML). Each also has `/api/v1` aliases where noted. The full 28-module/196-route surface is in `docs/API.md` + `docs/api-manifest.json`.

### Services
- **auth** - JWT generation, Patreon OAuth, session management
- **cache** - Redis wrapper with typed get/set and per-entity invalidation helpers
- **email** - Nodemailer SMTP (welcome emails, donation receipts)
- **payment/** - Stripe provider (payment intents, customers, subscriptions)
- **social** - YouTube, Twitter, Facebook, Instagram, TikTok API fetchers
- **storage/** - Local filesystem or S3 (factory pattern), thumbnail generation with sharp

### Config
- `packages/api/src/config/index.ts` - Zod-validated env vars
- All external service credentials optional (graceful degradation)
- `.env` / `.env.example` live at `packages/api/` (dotenv default path — a documented `./config` exception)
- See `packages/api/.env.example` or README for full variable list

### Key Patterns
- Snake_case in DB, camelCase in API responses (mapped in repositories/services via `mapRow`)
- Redis caching on public endpoints with pattern-based invalidation
- Multer for file uploads, sharp for image thumbnails, nanoid for filenames
- Custom error classes (AppError, NotFoundError, ValidationError, etc.)
- PostgreSQL triggers for: updated_at, campaign totals, form submission counts, search vectors
- **Route manifest framework** — `defineRoute({ method, path, auth, summary, input(zod), handler })` + `registerModule()` in `packages/api/src/api/`. Auth tiers: `public | optional | user | admin | apiKey`; `admin` and `apiKey`-tier routes accept an admin JWT **or** a scoped `ssk_` API key (`Authorization: Bearer ssk_…`; GET/HEAD→`read+`, mutations→`write+`, hierarchy `read < write < admin`); `optional`-tier routes also accept keys (valid key = machine client, gets admin-shaped response; invalid key fails with 401). Keys cannot manage keys (`/api-keys` rejects key auth with 403). Key writes audit as `api-key:<name>`. Admin-shaped responses bypass the public Redis cache. Handlers return data or `reply(data, {meta, status})`; errors throw → `middleware/error.ts`. `manifest()` emits the machine-readable route list. Bearer-authenticated requests skip CSRF. **Sweep complete: all 28 route modules are on the manifest** — the legacy `handleRouteError`/`send*`/`handleBulkAction` helpers and `utils/response.ts` are deleted.
- **Services own business logic** — `services/<module>.ts` is the canonical home; `routes/` are thin manifests (no inline SQL, no `res.json`, no try/catch); SQL lives in `repositories/` and `services/`; `sdk/` re-exports from `services/` (`cms.*` still works).
- **API docs generated from the manifest** — `npm run docs:api` builds the running-mode app, reads `manifest()`, and writes `docs/API.md` + `docs/api-manifest.json` (do not hand-edit those two).
- **Unified list endpoints** — converted modules drop `/public` suffixes: one `GET /<module>` with `optional` auth, role-shaped (anon → published only; admins passing `status`/`sort` get the all-statuses view). Gated content returns `error.code 'CONTENT_LOCKED'` with a preview in `error.details` (`ContentLockedDetails`). First instance: posts (`/posts/public` is gone).
- **Shared request/response DTOs** — every module's wire types live in `@rw/cms-shared` at `packages/shared/src/api/routes/<module>.ts` (all 28 modules covered; conventions documented in the barrel header `packages/shared/src/api/index.ts` — module-prefixed names, list responses = element arrays with pagination on `meta`, entity types referenced never duplicated). The backend **binds** its zod schemas to these: `input` schemas use `satisfies z.ZodType<XBody>` where clean, else an `AssertCompatible<z.infer<typeof schema>, XQuery>` compile-time assertion (for query schemas whose coercion makes input ≠ output). **DTO drift is a compile error.** Clients and the backend share ONE definition per shape.

## Frontend

### Framework
- SolidJS with `@solidjs/router` and `@solidjs/meta`
- Vite build with solid plugin, SCSS, PWA (workbox)
- Code-split with `lazy()` on all page components

### State Management
- `stores/auth.tsx` - AuthProvider context (user, login, logout, refresh)
- `createSignal` for component state
- `createResource` for async data fetching

### API Client
- **`@rw/cms-client` is the one networking path.** `services/api.ts` is DELETED — there is no envelope wrapper, no `fetch*` helpers, no `ApiService` class. Every backend call goes through the typed client singleton.
- `services/cmsClient.ts` exports `cms` — `createClient({ baseUrl: window.location.origin, auth: { mode: 'cookie' }, cache: { adapter: 'localstorage' } })`. Cookie mode preserves the httpOnly + CSRF session (no backend change). `cms.onError(...)` is the cross-cutting bus: a non-auth `UnauthorizedError` → session-expired handler; `ServiceUnavailableError`/`NEEDS_SETUP` → redirect to `/setup`. Auth-path 401s are filtered so login failures don't trip the session-expired modal.
- Call sites use `cms.<module>.<method>()` with `try/catch`. Errors are typed (`UnauthorizedError`, `ContentLockedError`, `ServiceUnavailableError`, …). Paginated list methods return `{ data, meta }` (`PageMeta = { page, limit, total, totalPages }`); single-entity GETs return the entity directly.
- Hooks take typed fetchers: `usePaginatedList({ fetch: (params) => cms.<module>.list(params), initialLimit?, params? })`; `useBulkActions({ entityType })` maps to `cms[entity].bulk({ ids, action, value })`. All entity `BulkBody` DTOs agree on `{ ids, action, value }`.
- **Deferred (still on inline `fetch`):** Join's `POST /auth/register` and UrlLinkBlock's `GET /utils/url-preview` remain raw `fetch` calls — known follow-ups to fold into `cms.*` once those routes are exposed on the client.

### Public Pages
| Route | Component | Description |
|-------|-----------|-------------|
| / | Home | Hero + social feed + campaigns |
| /login | Login | Patreon OAuth + email login |
| /join | Join | Registration |
| /posts | Posts | Blog listing with filters |
| /posts/:slug | Post | Single post view |
| /donate | Donate | Campaign listing |
| /donate/:slug | Campaign | Single campaign + donation form |
| /subscribe | Subscribe | Subscription plans (Stripe) |
| /contact | Contact | Contact form |
| /forms/:slug | Form | Dynamic form rendering |
| /search | Search | Full-text search |
| /:slug | DynamicPage | CMS pages with BlockRenderer |

### Admin Pages (under /admin)
Dashboard, Pages, PageEditor, Posts, PostEditor, Campaigns, CampaignEditor, Forms, FormEditor, Users, Messages, MessageView, Media, Connections, ConnectionEditor, Settings

### Key Components
- **BlockRenderer** - Renders page blocks (hero, rich_text, image, video, post, form, campaign, html)
- **ContentBlock** - Admin block editor wrapper with drag/drop
- **Block types**: TextBlock, ImageBlock, VideoBlock, DocumentBlock, SocialMediaBlock, UrlLinkBlock
- **MediaPickerModal** - Reusable media selection dialog
- **DonationForm** - Stripe Elements integration
- **VideoPlayer** - Plyr-based video player

### Styling
- SCSS with `variables.scss` (colors, typography, spacing, breakpoints, mixins)
- `global.scss` (reset, utilities, rich-text rendering)
- Component-scoped `.scss` files
- Primary color: #e63946, Secondary: #1d3557

## Shared Package (@rw/cms-shared)

### Types (packages/shared/src/types/)
- `api.ts` - ApiResponse, ApiError, ApiMeta, PaginationParams, SearchParams
- `campaign.ts` - Campaign, Donation, DonationIntent, CampaignStats, DonationSummary
- `content.ts` - Page, Block, BlockSettings, Post, SocialPost, Media, NavigationItem, SiteSettings
- `form.ts` - Form, FormQuestion, FormSubmission, FormAnswer, FormResults, QuestionResult
- `message.ts` - ContactMessage, ContactMessageInput, MessageFilters
- `user.ts` - User, UserBan, UserSession, PatreonMembership, LoginCredentials, AuthResponse

### API DTOs (packages/shared/src/api/routes/)
- One `<module>.ts` per route module (28 total) with request DTOs (`<Module><Action>Query`/`Body`/`Params`) + response DTOs (`<Module><Action>Response`), re-exported via the `src/api/index.ts` barrel. Conventions live in that barrel's header comment. Backend zod schemas bind to these.

### Utils (packages/shared/src/utils/)
- `format.ts` - formatCurrency, formatNumber, formatDate, formatDateTime, formatRelativeTime, formatFileSize, formatPercentage, pluralize
- `validation.ts` - isValidEmail, isValidSlug, isValidPassword, generateSlug, sanitizeHtml, truncate
- `isAdminRole` and other role predicates hoisted here so api + cms share one definition

## Development Commands

```bash
npm run dev                  # api + web app concurrently
npm run dev:frontend         # @rw/cms-web only (port 3000)
npm run dev:backend          # @rw/cms-api only (port 3001)
npm run build                # all workspaces, dependency-ordered (shared → api → cms → cms-client)
npm run db:migrate           # run migrations (→ packages/api)
npm run db:seed              # seed initial data
npm test                     # all workspaces --if-present (vitest in api)
npm run docs:api             # regenerate docs/API.md + docs/api-manifest.json from the live manifest
npm run lint                 # oxlint -c config/.oxlintrc.json packages/*/src   (lint:fix for --fix)
npm run format               # dprint fmt --config config/dprint.json           (format:check for CI gate)
npm run docker:up            # docker compose -f config/docker-compose.yml up -d (also docker:down / docker:build)
```

## Gotchas
- **Config stubs:** each package's root `tsconfig.json` is a one-line `extends` shim pointing at `config/<pkg>/tsconfig.json`. The real config (incl. vite/vitest) lives in `config/`; vite/vitest are invoked with `--config config/<pkg>/...` flags (those set `root`/`envDir` back to the package). Edit the file in `config/`, not the stub.
- **.env exception:** `.env` / `.env.example` stay at `packages/api/` (dotenv default path), NOT in `./config`. Other documented exceptions kept at root: `.editorconfig`, `.dockerignore`, `pnpm-workspace.yaml` + lockfiles, `.github/`, `packages/cms/index.html`.
- **Import scope:** the workspace scope is `@rw/cms-*` (was `@rw/shared`). Import shared types/DTOs/utils from `@rw/cms-shared`. `@rw/cms-shared` imports from no sibling package.
- **dprint pre-existing drift:** ~250 files predate the formatter config, so `npm run format:check` currently FAILS (known/expected). Don't bulk-reformat as a side effect; format only files you touch.
- **DTO convention + drift:** request/response DTOs for all 28 modules live in `packages/shared/src/api/routes/` — conventions in the barrel header (`packages/shared/src/api/index.ts`). Backend zod binds to them (`satisfies z.ZodType<X>` / `AssertCompatible`), so a DTO mismatch is a compile error.
- **cms-client — IMPLEMENTED:** `packages/cms-client` (`@rw/cms-client`) is fully built: 26 module namespaces, all 198 API routes covered, SWR cache, token auto-load, typed error bus, SolidJS adapter. See `packages/cms-client/docs/Overview.md`.
  - **Doctrine (realized):** All client-side requests route through `@rw/cms-client` (`createClient`). It exposes `cms.<module>.<method>()` for all 198 routes, with SWR caching, token auto-load, and a typed error bus. **`@rw/cms-web` is fully migrated** — `services/api.ts` is deleted and the `cms` singleton (`packages/cms/src/services/cmsClient.ts`, cookie mode) is the sole networking path. Two endpoints remain on inline `fetch` as known follow-ups: Join's `POST /auth/register` and UrlLinkBlock's `GET /utils/url-preview`.
  - Usage: `const cms = createClient({ baseUrl: 'https://cms.example.com', auth: { apiKey: 'ssk_…' } }); const posts = await cms.posts.list();`
  - `npm run check:drift -w packages/cms-client` — guards client↔API coverage against `docs/api-manifest.json`.
  - `npm run test:integration -w packages/cms-client` — manual live-API smoke test (requires `SMOKE_API_KEY` env + running server).

## External Services
- **PostgreSQL** - Primary database
- **Redis** - Caching layer
- **Stripe** - Payments (donations + subscriptions)
- **Patreon** - OAuth + membership integration
- **AWS S3** - Optional file storage (falls back to local)
- **SMTP** - Email notifications (optional)
- **Social APIs** - YouTube, Twitter, Instagram, Facebook, TikTok (all optional)

## Important Notes
- No ORM - SQL is hand-written, living in `repositories/` and `services/` (routes are thin manifest handlers)
- DB field mapping (snake_case → camelCase) handled in the repository/service layer via `mapRow`
- Auth tokens stored in both cookies and response body for flexibility
- Public endpoints are cached in Redis, admin mutations invalidate relevant caches
- File uploads go through multer → sharp (thumbnails) → storage provider
- Social media sync is pull-based (admin triggers sync, posts stored locally)
