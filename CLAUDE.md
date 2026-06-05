# SiteSurge CMS

## Project Overview

SiteSurge (a.k.a. SiteSurge CMS) is a self-hosted, feature-based, block-based general-purpose CMS. Pages, posts, campaigns, forms, users, media, social connections, plus a custom header/footer editor and a global appearance system (swatches, fonts, block-style templates).

Monorepo with three workspaces: `frontend` (SolidJS), `backend` (Express/Node), `shared` (TypeScript types & utils).

**Stack:** SolidJS + Vite | Express + PostgreSQL + Redis | Stripe | Patreon OAuth | S3/Local storage

The repo directory and workspace identifiers (`rw-cms`, `@rw/shared`) are historical and will be renamed in a future cut. Treat them as opaque package names — the product is SiteSurge.

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
- **Feature module system** — `FEATURE_REGISTRY` (`backend/src/features/registry.ts`) declares prerequisites + lazy-install migrations. `PUT /settings` runs the dependency planner (`validateEnable`) and applies pending migrations under `pg_advisory_xact_lock` before flipping each feature's `*_enabled` row. SQL migrations are tagged with `-- @feature <key>` headers; the runner skips disabled features on boot. `bootRunningMode()` runs `runMigrations()` at startup so post-enable migrations land on the next restart without manual `npm run db:migrate`.
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
- `frontend/src/pages/admin/AdminLayout.scss` is a slim index — actual rules live in `frontend/src/pages/admin/styles/_*.scss` partials grouped by feature (admin shell, block editor, inline editors, dashboard, settings, etc.) and in `frontend/src/styles/shared/` for things both the admin and the main site use.
- **Read `frontend/src/components/admin/ADMIN_STYLES.md` before adding admin styles.** It documents which partial owns what, when to hoist to `styles/shared/` vs keep admin-local, and the convention for `@use 'sass:color';` + `@use '../../../styles/variables' as *;` at the top of each partial.
- Repeated inline `style={{ ... }}` patterns belong in a partial. Common shared helpers (`.confirm-modal*`, `.preview-empty-message`, `.form-help-muted`) live in `styles/shared/` or `global.scss`.

## Theme tokens (CSS custom properties)
- **Site-wide** (`Layout` applies these from `AppearanceSettings`): `--site-primary`, `--site-link`, `--site-heading`, `--site-bg`, `--site-text`, `--site-text-muted`, `--site-border`, `--site-font`, `--site-heading-font`, `--site-heading-weight`, `--site-radius`, `--site-gutter`, `--site-max-width`, `--site-block-padding`, `--site-line-height`. Public-side inline styles should reference these (e.g. `color: var(--site-text-muted, #6b7280)`) so an operator-set theme propagates.
- **Admin shell** (declared in `pages/admin/styles/_admin-typography.scss`): `--admin-text`, `--admin-text-muted`, `--admin-border`, `--admin-bg-subtle`, plus `--admin-font-display`, `--admin-font-body`, `--admin-font-mono`. Admin-side inline styles use these. The token values come from `styles/variables.scss`.
- Hardcoded grays (`#888`, `#999`, `#bbb`, `#ccc`, `#d0d0d0`) in SCSS partials are already swept onto `$text-light` / `$text-color` / `$border-color` from the token palette. Don't add new literal hex values — extend `variables.scss` instead.

## Architecture

```
rw-cms/
├── frontend/     # SolidJS SPA (port 3000, proxies API to 3001)
├── backend/      # Express REST API (port 3001)
└── shared/       # @rw/shared - types and utility functions
```

### Monorepo Setup
- npm workspaces (`frontend`, `backend`, `shared`)
- `npm run dev` runs both frontend and backend via concurrently
- Node >= 20.0.0 required
- Shared package is `@rw/shared` (types + format/validation utils)

## Backend

### Architecture (SOLID Principles)
```
backend/src/
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
- `backend/src/index.ts` - main entry, connects DB/Redis, starts server
- `backend/src/app.ts` - Express app factory with middleware chain

### Database
- PostgreSQL with raw `pg` queries (no ORM)
- Schema: `backend/src/db/schema.sql` (idempotent, uses IF NOT EXISTS)
- Migrations: `backend/src/db/migrations/` (numbered SQL files)
- Seed: `backend/src/db/seed.ts` (admin user, sample data)
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
- `backend/src/config/index.ts` - Zod-validated env vars
- All external service credentials optional (graceful degradation)
- See `.env.example` or README for full variable list

### Key Patterns
- Snake_case in DB, camelCase in API responses (mapped in repositories/services via `mapRow`)
- Redis caching on public endpoints with pattern-based invalidation
- Multer for file uploads, sharp for image thumbnails, nanoid for filenames
- Custom error classes (AppError, NotFoundError, ValidationError, etc.)
- PostgreSQL triggers for: updated_at, campaign totals, form submission counts, search vectors
- **Route manifest framework** — `defineRoute({ method, path, auth, summary, input(zod), handler })` + `registerModule()` in `backend/src/api/`. Auth tiers: `public | optional | user | admin | apiKey`; `admin` and `apiKey`-tier routes accept an admin JWT **or** a scoped `ssk_` API key (`Authorization: Bearer ssk_…`; GET/HEAD→`read+`, mutations→`write+`, hierarchy `read < write < admin`); `optional`-tier routes also accept keys (valid key = machine client, gets admin-shaped response; invalid key fails with 401). Keys cannot manage keys (`/api-keys` rejects key auth with 403). Key writes audit as `api-key:<name>`. Admin-shaped responses bypass the public Redis cache. Handlers return data or `reply(data, {meta, status})`; errors throw → `middleware/error.ts`. `manifest()` emits the machine-readable route list. Bearer-authenticated requests skip CSRF. **Sweep complete: all 28 route modules are on the manifest** — the legacy `handleRouteError`/`send*`/`handleBulkAction` helpers and `utils/response.ts` are deleted.
- **Services own business logic** — `services/<module>.ts` is the canonical home; `routes/` are thin manifests (no inline SQL, no `res.json`, no try/catch); SQL lives in `repositories/` and `services/`; `sdk/` re-exports from `services/` (`cms.*` still works).
- **API docs generated from the manifest** — `npm run docs:api` builds the running-mode app, reads `manifest()`, and writes `docs/API.md` + `docs/api-manifest.json` (do not hand-edit those two).
- **Unified list endpoints** — converted modules drop `/public` suffixes: one `GET /<module>` with `optional` auth, role-shaped (anon → published only; admins passing `status`/`sort` get the all-statuses view). Gated content returns `error.code 'CONTENT_LOCKED'` with a preview in `error.details` (`ContentLockedDetails`). First instance: posts (`/posts/public` is gone).

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
- `services/api.ts` - ApiService class with get/post/put/patch/delete/upload
- Utility functions: fetchPage, fetchPost, fetchPosts, fetchNavigation, fetchSettings, fetchCampaigns, fetchForm, submitForm, submitContactMessage, fetchSocialPosts, search

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

## Shared Package (@rw/shared)

### Types (shared/src/types/)
- `api.ts` - ApiResponse, ApiError, ApiMeta, PaginationParams, SearchParams
- `campaign.ts` - Campaign, Donation, DonationIntent, CampaignStats, DonationSummary
- `content.ts` - Page, Block, BlockSettings, Post, SocialPost, Media, NavigationItem, SiteSettings
- `form.ts` - Form, FormQuestion, FormSubmission, FormAnswer, FormResults, QuestionResult
- `message.ts` - ContactMessage, ContactMessageInput, MessageFilters
- `user.ts` - User, UserBan, UserSession, PatreonMembership, LoginCredentials, AuthResponse

### Utils (shared/src/utils/)
- `format.ts` - formatCurrency, formatNumber, formatDate, formatDateTime, formatRelativeTime, formatFileSize, formatPercentage, pluralize
- `validation.ts` - isValidEmail, isValidSlug, isValidPassword, generateSlug, sanitizeHtml, truncate

## Development Commands

```bash
npm run dev              # Start frontend + backend concurrently
npm run dev:frontend     # Frontend only (port 3000)
npm run dev:backend      # Backend only (port 3001)
npm run build            # Build all workspaces
npm run db:migrate       # Run database migrations
npm run db:seed          # Seed initial data
npm run test -w backend  # Run backend unit tests (vitest)
npm run docs:api         # Regenerate docs/API.md + docs/api-manifest.json from the live manifest
```

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
