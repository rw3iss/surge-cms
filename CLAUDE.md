# SiteSurge CMS

## Project Overview

SiteSurge (a.k.a. SiteSurge CMS) is a self-hosted, feature-based, block-based general-purpose CMS. Pages, posts, campaigns, forms, users, media, social connections, plus a custom header/footer editor and a global appearance system (swatches, fonts, block-style templates).

Monorepo with five workspaces under `packages/*`: `api` (`@sitesurge/server`, Express/Node), `cms` (`@sitesurge/admin`, SolidJS), `shared` (`@sitesurge/types`, types/DTOs/utils consumed by all), `cms-client` (`@sitesurge/client`, headless TS client — **fully implemented**), `cms-mcp` (`@sitesurge/mcp`, MCP server wrapping the client — **implemented**; see `docs/MCP.md`). All build/tool config lives in `./config`.

**Stack:** SolidJS + Vite | Express + PostgreSQL + Redis | Stripe | Patreon OAuth | S3/Local storage

Packages are scoped **`@sitesurge/*`** (`@sitesurge/types` = shared, `@sitesurge/server` = api, `@sitesurge/admin` = cms/web, `@sitesurge/client`, `@sitesurge/mcp`). Note the **package directory names still lag the package names** — `@sitesurge/server` lives in `packages/api`, `@sitesurge/admin` in `packages/cms`, `@sitesurge/types` in `packages/shared` (pnpm resolves by name, not path). The local repo dir (`rw-cms`) is cosmetic; the GitHub repo is `surge-cms`.

**npm distribution:** all packages publish to npm under `@sitesurge/*` (GPL-2.0-only) — `types`, `client`, `mcp` (libs), plus `server` (backend; serves the admin), `admin` (built SPA static assets; `adminDistPath()` resolver, bundled/served by the server), `cli` (`sitesurge` ops CLI), and `create-sitesurge` (`npm create sitesurge`, `--node` scaffolds a thin npm-server repo). `server`/`admin`/`cli` are a Changesets **fixed group**. The server also ships as a Docker image at `ghcr.io/rw3iss/sitesurge-server`. Consumers run the CMS without cloning: Docker image, or `@sitesurge/server` as an npm dep (`startServer()`/`createApp()`). The server's build copies `db/*.sql` into `dist` (see `packages/api/scripts/copy-assets.mjs`); fresh-install migrations are idempotent so a new DB migrates to a zero-drift schema. Design: `docs/superpowers/specs/2026-07-13-full-npm-distribution-design.md`.

## Core Capabilities
- **Block-based editor** — categorized AddBlockMenu (Text / Media / Blocks / Layout, collapsible per category, feature-flag gated). Blocks: Rich Text, Custom HTML, URL Link, Image (multi-image), Video, Document, Hero, Carousel, Posts, Campaign, Form, Social, Group, Spacer. Click-outside-to-deselect + Escape close the flyout. Per-block trash icon. Recent-items submenus on Campaign/Form/Posts pre-fill the new block's id.
- **Group block** — recursive composition via `parent_block_id` (migration 026). Flex container with direction, 1-16 columns, item min/max width+height, wrap, align/justify. Each slot is a `group_item` holding ≤1 child; empty slots show an inline picker. Tree assembly via `buildBlockTree(flat)` shared utility.
- **Inline editing** — Rich Text and Custom HTML edit in place on the block preview. HTML block has a code ↔ preview toggle (CodeMirror 6 with HTML lang), drag-resize on the bottom edge, and per-block height persisted in `localStorage` under `sitesurge.editor.blockHeights`.
- **Image block** — multi-image with thumbnail strip, per-image Select Media / Upload New / URL paste / alt / caption / link / allowMaximize. Block-level direction + item min/max width+height (any CSS length).
- **Social block** — provider + count + per-slot pinning. Auto-feed when no slots are filled; pinned posts otherwise. Per-slot inline search dropdown of recent posts; "Edit…" opens a full search modal preconfigured to the provider.
- **Carousel block** — items are either media (image/video slide) or **posts** (`HeroItem.type='media'|'posts'`, `HeroPostsConfig`). A posts item holds a post query modeled on the Posts block (specific posts + `queryEnabled`/count/before-after-days/search/`showEmptyMessage` + show-fields `showAuthor`/`showExcerpt`/`showDateCreated`/`showDateUpdated`/`showTags`; UI = `PostQueryEditor`, "Select Posts" in the add-item row). At render, `ResolvedHeroCarousel` expands each posts item into ONE slide per resolved post: banner `featuredImage` backdrop + title, then a meta line (author + date(s)), then the excerpt (CSS `-webkit-line-clamp` abbreviates over-long excerpts), then tags (smaller), then a "Read More" link (→ `HeroItem.postMeta`). The same author-then-dates-above-excerpt, tags-below layout is mirrored in `PostListRenderer` (the Posts content block). Zero posts → a single "No posts found" slide when `showEmptyMessage`, else nothing. Same resolver drives the admin preview and the public renderer. Shared admin controls in `blocks/PostQueryControls.tsx` (`SpecificPostsField` / `PostQuerySection` / `PostFieldsSection`) back both `PostListBlock` and `PostQueryEditor`.
- **Preview mode** — wraps content in the public `<Layout>` so previews render the real site header, footer, navigation, swatches, fonts, and appearance. Pages also wrap in `.dynamic-page.page-wrapper`; posts in `.post-page.page-wrapper`.
- **Posts & pages** — drafts, publish, revisions, SSR body for SEO, RSS at `/feed.xml`, full-text search.
- **Campaigns + donations** — Stripe Elements, recurring subscriptions, public-donor toggle.
- **Forms / surveys / polls** — typed question library, submission inbox, CSV export.
- **Users & roles** — email/password + Patreon OAuth, member tiers, gated content, user/IP bans. Roles: `anonymous | member | editor | admin | sysadmin`. **`editor`** = content-editing staff: signs into the admin (limited nav — no Plugins/Settings/Users/Mailing Lists/Shop), edits content (posts/pages/media/campaigns/forms/messages via the `staff` auth tier), and can be attributed as a post author. Predicates `isAdminRole` (admin/sysadmin) + `isStaffRole` (+editor) in `@sitesurge/types`. Post author = `authorId` (a staff user) with `author` (displayName) derived; the Post editor's Author dropdown reads `GET /users/authors` (staff-tier, minimal fields); new posts default the author to the creator.
- **Mailing lists** — opt-in feature module (`mailing_lists`, requires `users`). Per-list subscribers (registered users or email-only), token-based one-click `/u/:token` unsubscribe + RFC 8058 `List-Unsubscribe` headers, optional per-list double opt-in. Mail templates reuse the existing block editor; backend email renderer adapts every block type to table-based inline-style HTML and resolves `swatch:{id}` refs to literal hex via the palette. Send wizard creates tracked jobs (`mail_send_jobs` + `mail_send_recipients`) processed by an in-process worker with concurrency/delay knobs and a boot-time resumer. Provider abstraction (`MailProvider`): SMTP (Nodemailer, default — works with any SMTP relay incl. SendGrid/Mailgun/Postmark/SES) and stubs for native REST adapters. Welcome / donation-receipt emails flow through the same pipeline.
- **Shop / ecommerce** — opt-in feature module (`shop`, requires `users`). Catalog: products with ≤3 options → auto-generated variants (per-variant price/inventory/SKU), multi-image+video media with sort + main-image, hierarchical categories, curated collections, normalized tags. Reviews with admin moderation + rating denormalization (`rating_avg`/`rating_count`). On-site Stripe checkout (PaymentIntent + Elements + Stripe Tax) with guest checkout + client-side cart; server re-validates every line item's price/inventory. Orders with fulfillment/tracking/refund/receipt + digital-download tokens. Shop settings = config + storefront appearance (two `site_settings` rows). Admin `/admin/shop/*`, storefront `/shop/*`, SDK `cms.shop.*`, all 404/hidden when the `shop` feature is off. All tables `-- @feature shop` (migrations 039–049).
- **Feature module system** — `FEATURE_REGISTRY` (`packages/api/src/features/registry.ts`) declares prerequisites + lazy-install migrations. `PUT /settings` (`features: { <key>: true }`) runs the dependency planner (`validateEnable`) and applies pending migrations under `pg_advisory_xact_lock` before flipping each feature's `*_enabled` row. SQL migrations are tagged with `-- @feature <key>` headers; the runner skips disabled features on boot. `bootRunningMode()` runs `runMigrations()` at startup so post-enable migrations land on the next restart without manual `npm run db:migrate`.
  - **Lifecycle hardening** — `FeatureConfig` gains `tables` (owned tables, creation order — reverse-dropped on uninstall), `settingsKeys` (owned `site_settings` keys / `prefix*` globs), `onEnable`/`onUninstall` (idempotent txn hooks). `installFeatureStep(key, client)` runs the migrations + `onEnable` and returns the `appliedMigrations` list, surfaced to the client in the `PUT /settings` response (`features: [{ key, enabled, appliedMigrations }]`). `uninstallFeature(key, ctx)` + `POST /settings/features/:key/uninstall` (`{ confirm: true }`, admin, JWT only) transactionally run `onUninstall` → `DROP TABLE … CASCADE` (owned tables, reverse) → delete `schema_migrations` + owned settings rows → audit, returning `{ droppedTables }`; dependent-safety rejects if an enabled feature still requires it. `requireFeature(key)` (route guard) + `registerModule(name, routes, { feature })` make a disabled feature's routes **404**. Client UX: `FeatureToggleRow` busy states + a type-to-confirm Remove modal (`cms.settings.uninstallFeature(key)`).
- **Plugins** — opt-in feature module (`plugins`). Admin-installable extensions in a backend `plugins/` dir (`PLUGINS_DIR`, default `./plugins`), modeled on Features but data-driven/open. Each plugin = `plugin.json` (manifest + `configSchema`) + `server.js` (idempotent Node hooks: install/uninstall/onEnable/onDisable/onLoad/update) + `client.js` (**framework-agnostic** ESM: `mountWidget`/`mountConfig(el, host)` — no solid-js import; served same-origin so CSP `scriptSrc 'self'` holds). Lifecycle runs txn + `pg_advisory_xact_lock('plugin:<name>')`; owned tables prefixed `plugin_<name>_*`; plugin migrations ledgered in `plugin_migrations`. Admin `/admin/plugins` (table: install/enable/disable/update/uninstall, upload-zip, marketplace) + `/admin/plugins/:name` (custom config page via `mountConfig`, else host-rendered `configSchema` form). **Distribution:** a plugin ships as a folder (`plugin.json` at zip root + `server.js`/`client.js`; `npm run plugin:pack <dir>` builds an uploadable `.zip`). **Marketplace = the first-party catalog bundled inside `@sitesurge/server`** — the build copies `plugins/*` (minus vendor `client/` bundles) into `dist/plugins-catalog/` (`loader.bundledCatalogDir()`); `marketplaceSearch` lists it and `marketplaceInstall(id)` copies the chosen plugin into the consumer's `PLUGINS_DIR` and runs the normal install lifecycle. So `@sitesurge/server` consumers get one-click install without the plugin source in their repo (a plugin's own `install()` still fetches its vendor bundle). Public widget mounts ONCE at the app root (`App.tsx`, above both the public `Layout` and the `AdminLayout`) so it loads on every route — public and admin — persists across SPA navigation, and restores after a hard refresh on either side; a single host + `activeInstance`/script-dedup guards make a duplicate mount impossible (per-plugin `adminOnly` gate). All actions admin-only except `GET /plugins/enabled` + `client.js`/assets (public, so the site self-loads widgets). SDK `cms.plugins.*`, 10 MCP tools. First plugin: **PageLoop** (`packages/api/plugins/pageloop/`) — `install()` downloads the vanilla widget bundle; deficiencies in `docs/pageloop-plugin-deficiencies.md`. Guide: `docs/PLUGINS.md`.
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

## Block-type registry
- Block types enumerate **once** as `ALL_BLOCK_TYPES` in `@sitesurge/types` (`packages/shared/src/utils/blockCatalog.ts`), compile-time exhaustiveness-checked against the `BlockType` union. Each consumer provides a per-type render registry keyed `Record<BlockType, …>`: **SSR/SEO** in `packages/api/src/services/ssr/blocks/` (`SSR_BLOCK_RENDERERS` + `renderBlockForSeo` dispatcher; emitters per type, `notIndexable` = naming comment, `notRendered` = empty) and **email** in `packages/api/src/services/mail/blocks/` (`RENDERERS`). Coverage tests (`ssr/blocks/blocks.test.ts`, `mail/blocks/coverage.test.ts`) guard that every catalog type has a strategy, so adding a `BlockType` fails to compile/test until each registry declares an arm. Known SSR limitation: `ssr/routes.ts` feeds a flat block list, so a `group`'s nested children are not walked in SSR (groups emit nothing) — deferred follow-up.

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
│   ├── api/         # @sitesurge/server  — Express REST API (port 3001), SSR, migrations
│   ├── cms/         # @sitesurge/admin  — SolidJS SPA (port 3000, proxies API to 3001)
│   ├── shared/      # @sitesurge/types — types, src/api/routes/ DTOs, format/validation utils
│   └── cms-client/  # @sitesurge/client — headless HTTP client (implemented)
├── config/          # all build/tool config (per-package subdirs + repo-wide)
└── docs/            # API.md, api-manifest.json, client-sdk-plan.md, plans/specs
```

### Monorepo Setup
- npm workspaces `packages/*`: `@sitesurge/server`, `@sitesurge/admin`, `@sitesurge/types`, `@sitesurge/client`
- `npm run dev` runs api + web app via concurrently
- `npm run build` is **dependency-ordered**: shared → api → cms → cms-client (shared compiles first)
- `npm test` runs `--workspaces --if-present` (only api ships tests today)
- Node >= 20.0.0 required
- `@sitesurge/types` (types + API DTOs + format/validation utils) is imported by all other packages; it imports from none of them

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
- Middleware: `authenticate(required?)`, `requireRole(...roles)`, `requireAdmin` (admin/sysadmin), `requireStaff` (admin/sysadmin/editor)
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
| /shop | shop.ts | public + admin | Products, catalog, reviews, checkout, orders, settings (gated behind `shop` feature) |
| /plugins | plugins.ts | admin + public reads | Plugin install/config/enable/update/uninstall/upload; `GET /plugins/enabled` + `client.js`/assets public (gated behind `plugins` feature) |

Root-mounted raw modules (outside `/api/v1`, registered in `app.ts`): `feed` (`/feed.xml`, RSS), `sitemap` (`/sitemap.xml`), `unsubscribe` (`/u/:token`, `/lists/:slug/confirm/:token`, HTML). Each also has `/api/v1` aliases where noted. The full 29-module/234-route surface is in `docs/API.md` + `docs/api-manifest.json`.

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
- **Route manifest framework** — `defineRoute({ method, path, auth, summary, input(zod), handler })` + `registerModule()` in `packages/api/src/api/`. Auth tiers: `public | optional | user | staff | admin | apiKey`; `staff` = admin/sysadmin/editor JWT (content modules) — `admin` and `apiKey`-tier routes accept an admin JWT **or** a scoped `ssk_` API key (API keys satisfy `staff` too) (`Authorization: Bearer ssk_…`; GET/HEAD→`read+`, mutations→`write+`, hierarchy `read < write < admin`); `optional`-tier routes also accept keys (valid key = machine client, gets admin-shaped response; invalid key fails with 401). Keys cannot manage keys (`/api-keys` rejects key auth with 403). Key writes audit as `api-key:<name>`. Admin-shaped responses bypass the public Redis cache. Handlers return data or `reply(data, {meta, status})`; errors throw → `middleware/error.ts`. `manifest()` emits the machine-readable route list. Bearer-authenticated requests skip CSRF. **Sweep complete: all 28 route modules are on the manifest** — the legacy `handleRouteError`/`send*`/`handleBulkAction` helpers and `utils/response.ts` are deleted.
- **Services own business logic** — `services/<module>.ts` is the canonical home; `routes/` are thin manifests (no inline SQL, no `res.json`, no try/catch); SQL lives in `repositories/` and `services/`; `sdk/` re-exports from `services/` (`cms.*` still works).
- **API docs generated from the manifest** — `npm run docs:api` builds the running-mode app, reads `manifest()`, and writes `docs/API.md` + `docs/api-manifest.json` (do not hand-edit those two).
- **Unified list endpoints** — converted modules drop `/public` suffixes: one `GET /<module>` with `optional` auth, role-shaped (anon → published only; admins passing `status`/`sort` get the all-statuses view). Gated content returns `error.code 'CONTENT_LOCKED'` with a preview in `error.details` (`ContentLockedDetails`). First instance: posts (`/posts/public` is gone).
- **Shared request/response DTOs** — every module's wire types live in `@sitesurge/types` at `packages/shared/src/api/routes/<module>.ts` (all 29 modules covered; conventions documented in the barrel header `packages/shared/src/api/index.ts` — module-prefixed names, list responses = element arrays with pagination on `meta`, entity types referenced never duplicated). The backend **binds** its zod schemas to these: `input` schemas use `satisfies z.ZodType<XBody>` where clean, else an `AssertCompatible<z.infer<typeof schema>, XQuery>` compile-time assertion (for query schemas whose coercion makes input ≠ output). **DTO drift is a compile error.** Clients and the backend share ONE definition per shape.

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
- **`@sitesurge/client` is the one networking path.** `services/api.ts` is DELETED — there is no envelope wrapper, no `fetch*` helpers, no `ApiService` class. Every backend call goes through the typed client singleton.
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
| /shop | ShopIndexPage | Product grid + filters (feature-gated; replaces the Shopify iframe) |
| /shop/:slug | ShopProductPage | Product detail: media gallery, variant selector, reviews |
| /shop/collections/:slug, /shop/categories/:slug | ShopCollectionPage / ShopCategoryPage | Filtered grids |
| /shop/cart, /shop/checkout | ShopCartPage / ShopCheckoutPage | Client cart → Stripe Elements checkout |
| /shop/orders/:number | ShopOrderConfirmationPage | Order confirmation + digital download links |
| /:slug | DynamicPage | CMS pages with BlockRenderer |

### Admin Pages (under /admin)
Dashboard, Pages, PageEditor, Posts, PostEditor, Campaigns, CampaignEditor, Forms, FormEditor, Users, Messages, MessageView, Media, Connections, ConnectionEditor, Settings. Feature-gated Shop pages (`/admin/shop/*`, rendered only when `shop` is enabled): ShopDashboard, ShopProducts, ShopProductEditor, ShopCategories, ShopCollections, ShopOrders, ShopOrderDetail, ShopReviews, ShopSettings. Feature-gated Plugins pages (`/admin/plugins`, `/admin/plugins/:name`, rendered only when `plugins` is enabled): Plugins (table), PluginConfig (per-plugin custom config page).

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

## Shared Package (@sitesurge/types)

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
npm run dev:frontend         # @sitesurge/admin only (port 3000)
npm run dev:backend          # @sitesurge/server only (port 3001)
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
- **Import scope:** the workspace scope is `@rw/cms-*` (was `@rw/shared`). Import shared types/DTOs/utils from `@sitesurge/types`. `@sitesurge/types` imports from no sibling package.
- **dprint pre-existing drift:** ~250 files predate the formatter config, so `npm run format:check` currently FAILS (known/expected). Don't bulk-reformat as a side effect; format only files you touch.
- **DTO convention + drift:** request/response DTOs for all 29 modules live in `packages/shared/src/api/routes/` — conventions in the barrel header (`packages/shared/src/api/index.ts`). Backend zod binds to them (`satisfies z.ZodType<X>` / `AssertCompatible`), so a DTO mismatch is a compile error.
- **cms-client — IMPLEMENTED:** `packages/cms-client` (`@sitesurge/client`) is fully built: 27 module namespaces, all 234 API routes covered, SWR cache, token auto-load, typed error bus, SolidJS adapter. See `packages/cms-client/docs/Overview.md`.
  - **Doctrine (realized):** All client-side requests route through `@sitesurge/client` (`createClient`). It exposes `cms.<module>.<method>()` for all routes, with SWR caching, token auto-load, and a typed error bus. **`@sitesurge/admin` is fully migrated** — `services/api.ts` is deleted and the `cms` singleton (`packages/cms/src/services/cmsClient.ts`, cookie mode) is the sole networking path. (`POST /auth/register` and `GET /utils/url-preview` now exist and are exposed as `cms.auth.register` / `cms.utils.urlPreview`.)
  - Usage: `const cms = createClient({ baseUrl: 'https://cms.example.com', auth: { apiKey: 'ssk_…' } }); const posts = await cms.posts.list();`
  - `npm run check:drift -w packages/cms-client` — guards client↔API coverage against `docs/api-manifest.json`.
  - `npm run test:integration -w packages/cms-client` — manual live-API smoke test (requires `SMOKE_API_KEY` env + running server).
- **cms-mcp — IMPLEMENTED:** `packages/cms-mcp` (`@sitesurge/mcp`) is an MCP server (stdio) wrapping `@sitesurge/client` in apiKey mode, exposing the whole authoring surface (pages/posts/blocks/every block type/block styles/appearance/swatches/fonts/header/footer/settings/features/media/nav/reference) as **66 tools** so an AI agent can build a site. Config via env (`CMS_BASE_URL`, `CMS_API_KEY`, `CMS_MCP_READONLY`). Adds the block-type catalog (`describe_block_types`), group-nesting + single-post-block ergonomics, and media-from-path/URL. Full reference: `docs/MCP.md`. Design + deficiency audit: `docs/superpowers/specs/2026-07-09-cms-mcp-server-design.md`, `docs/mcp-sdk-deficiencies.md`.

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
