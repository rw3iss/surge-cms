# SiteSurge

**A simple, feature-rich, block-based CMS for building any kind of website.**

SiteSurge (a.k.a. SiteSurge CMS) is a self-hosted, customizable content platform — pages, posts, campaigns, forms, users, media, and a live block-based editor with deep style customization. SolidJS frontend, Express + PostgreSQL backend, fully typed shared SDK.

> Status: actively developed. First-run setup wizard handles install end-to-end.

---

## Features at a glance

- **Block-based page builder** — categorized "+ Add Block" picker (Text / Media / Blocks / Layout) with feature-flag gating, hover submenus that pre-fill from recent campaigns / forms / posts, and recursive **Group** blocks (direction, columns 1-16, item min/max width+height, wrap, align/justify).
- **Block library** — Rich Text, Custom HTML, URL Link, Image (multi-image with thumbnail strip + layout), Video, Document, Hero, Carousel, Posts, Campaign, Form, Social, Group, Spacer.
- **Inline editing** — Rich Text edits in place on the block preview; HTML block has a code ↔ preview toggle (CodeMirror 6, syntax highlighted), drag-resize handle, and per-block height persisted in localStorage.
- **Real preview** — admin Preview wraps content in the public `<Layout>` so the configured site header, footer, navigation, swatches, fonts, and appearance render exactly as a visitor would see them.
- **Posts & pages** — drafts, scheduled publish, slugs, revisions, full-text search, RSS feed, SEO-friendly SSR body.
- **Donations & campaigns** — Stripe-backed fundraising with progress, top contributors, recurring subscriptions.
- **Forms / surveys / polls** — custom questions, submissions inbox, results display.
- **Users & roles** — email/password + Patreon SSO, member tiers, gated content, IP/user bans.
- **Mailing Lists** — opt-in feature module (requires Users). Per-list subscribers (registered or email-only), token-based one-click `/u/:token` unsubscribe + RFC 8058 `List-Unsubscribe` headers, optional double opt-in. Mail templates reuse the block editor with an email-render mode that inlines styles, bakes `swatch:{id}` refs to literal hex, and adapts every block type for email-client compatibility. Send wizard creates tracked jobs with per-recipient delivery status, live progress polling, retry/resume/cancel, and a boot-time resumer that recovers from crashed sends. SMTP provider abstraction works with any relay (Brevo, Postmark, SendGrid, Mailgun, AWS SES, etc.).
- **Feature module system** — declarative `FEATURE_REGISTRY` with prerequisites + lazy-install migrations. Toggling a feature on runs its tagged migrations atomically inside an advisory-locked transaction; disable is non-destructive (tables persist for re-enable).
- **Media library** — upload, crop, thumbnails (sharp), local FS or S3.
- **Social connections** — pull-based sync from YouTube, Instagram, X/Twitter, Facebook, TikTok, Patreon. The Social block holds either an auto-feed for a connected provider or hand-picked posts via per-slot search + advanced selection modal.
- **Custom header & footer editors** — drag-and-drop rows + columns, fully styled per site.
- **Global appearance system** — shared color swatches, custom fonts, reusable block-style templates, `swatch:{id}` references everywhere.
- **Backend SDK** — `cms.pages`, `cms.posts`, `cms.campaigns`, … one typed surface for routes, scripts, and plugins.
- **First-run setup wizard** — run the app, open `/setup`, done. Validates DB / Redis / SMTP / S3 inline.
- **PWA + CDN-ready** — static frontend bundle, app shell, offline-friendly.

---

## Getting Started

SiteSurge ships as installable packages under the **`@sitesurge`** scope. The
**server** (`@sitesurge/server`) serves the REST API, the public site, **and** the
admin UI in one process; the **client** (`@sitesurge/client`) + **types**
(`@sitesurge/types`) let any frontend consume it. Pick a path:

**Prerequisites:** Node 20+, PostgreSQL 14+, Redis 6+ (Redis optional).

Both turnkey paths (A, B) give you a **source-free, versioned site repo** — you
never clone this monorepo.

### A. Turnkey site (fastest — Docker)

```bash
npm create sitesurge@latest my-site      # scaffolds compose + .env + README
cd my-site && docker compose up -d       # Postgres + Redis + prebuilt server image
open http://localhost:3001/setup         # first-run wizard (or: docker compose exec server sitesurge setup --from-env)
```

The compose file pulls the prebuilt **`ghcr.io/rw3iss/sitesurge-server`** image.
Configure appearance/content in the admin at `/admin`. Done.

### B. Node / native (no Docker) — server from npm

Scaffold a **thin npm-server repo** — your own git repo with `@sitesurge/server`
as a dependency (no CMS source):

```bash
npm create sitesurge@latest my-site -- --node
cd my-site && npm install
npm run setup       # create schema + admin (interactive; or -- --from-env)
npm start           # API + public site + admin at http://localhost:3001
```

The generated `src/index.js` is a one-line `startServer()` you can extend with
your own routes via `createApp()`. The **`sitesurge` CLI** (`@sitesurge/cli`)
provides `setup/migrate/seed/doctor/status/start`. See
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** for a systemd + nginx production setup.

### C. Headless — your frontend, our content API

```bash
npm i @sitesurge/client @sitesurge/types
```
```ts
import { createClient } from '@sitesurge/client';
const cms = createClient({ baseUrl: process.env.CMS_URL, auth: { apiKey: process.env.CMS_KEY } });
const { data: posts } = await cms.posts.list({ limit: 12 });
```

Issue a scoped key in **admin → Settings → API Keys**. Prefer your own client?
Everything is typed in `@sitesurge/types` and documented in
[`docs/API.md`](docs/API.md). A runnable example lives in
[`examples/headless-node`](examples/headless-node).

### D. Embed the server in your own Node app

```bash
npm i @sitesurge/server
```
```ts
import { createApp, startServer } from '@sitesurge/server';
const app = createApp('running');
app.use('/webhooks/custom', myRouter);
app.listen(3001);        // or: await startServer();
```

### E. AI-assisted authoring (MCP)

```bash
CMS_BASE_URL=http://localhost:3001 CMS_API_KEY=ssk_… npx @sitesurge/mcp
```
See [`docs/MCP.md`](docs/MCP.md).

### Contributing to SiteSurge itself

```bash
git clone https://github.com/rw3iss/surge-cms && cd surge-cms
pnpm install && pnpm dev      # api :3001 + admin :3000, wizard at /setup
```

> Distribution + release details: **[docs/PUBLISHING.md](docs/PUBLISHING.md)**.
> Architecture of the package split: `docs/superpowers/specs/2026-07-11-packaging-and-init-design.md`.

---

## Administrator Guide

<details>
<summary><strong>Accessing the admin portal</strong></summary>

1. Go to `/admin` and log in with your administrator email and password.
2. Only users with the `admin` role can access this area.
</details>

<details>
<summary><strong>Dashboard</strong></summary>

Quick stats — total pages, posts, active campaigns, pending messages — plus shortcuts to recent activity. Feature panels are toggleable per install.
</details>

<details>
<summary><strong>Pages</strong></summary>

Pages are top-level content (`/about`, `/team`, `/{slug}`). Each page is built from blocks.

- **Create / edit / publish** — title, slug, status (draft / published), `showTitle`, homepage flag, `show_in_nav`.
- **Blocks** — drag to reorder (top-level + intra-group), button-driven move-up/down, click outside or hit Escape to deselect, trash icon in the block hover bar to delete with confirm.
- **Available block types**: Rich Text, Custom HTML, URL Link, Image (multi-image), Video, Document, Hero, Carousel, Posts, Campaign, Form, Social, **Group** (recursive), Spacer.
- **Group block** — flex container with direction (row / column), 1-16 columns, item min/max width and height (any CSS length), wrap, align, justify. Each slot is a `group_item` that holds at most one child block; empty slots show an inline AddBlockMenu picker.
- **Per-block styling** — pick a style template, override colors/spacing inline, scope styles to that block.
</details>

<details>
<summary><strong>Posts (blog)</strong></summary>

Articles or news updates with content blocks for the body.

- Title, slug (auto-generated, editable), category, excerpt, featured image, status.
- Statuses: `draft` (admin only), `published` (live), `archived` (hidden from listings, accessible via URL).
- Full-text search, RSS feed at `/feed.xml`, progressive-enhancement SSR body for SEO.
</details>

<details>
<summary><strong>Campaigns (donations)</strong></summary>

Fundraising campaigns rendered on `/donate` and embeddable as blocks.

- Goal amount, raised total, donor count, progress bar — all auto-calculated.
- Stripe Elements donation form; receipts via SMTP.
- Public/anonymous toggle for donor display.
- Subscription plans (recurring) supported.
</details>

<details>
<summary><strong>Forms / surveys</strong></summary>

Custom forms at `/forms/{slug}`.

| Type | Use |
|---|---|
| Text | Short answers |
| Textarea | Long answers |
| Select | Dropdown |
| Radio | Single choice |
| Checkbox | Multiple choices |
| Number | Numeric only |
| Date | Date picker |

Required toggles, drag-to-reorder, submission inbox, CSV export.
</details>

<details>
<summary><strong>Users & roles</strong></summary>

| Role | Access |
|---|---|
| `user` | Public site, donations, form submissions |
| `editor` | Manage content (pages, posts) |
| `admin` | Everything |

- Email/password or Patreon OAuth.
- Patreon members can see tier-gated content without leaving the site.
- Per-user and per-IP bans (with reason + expiry).
</details>

<details>
<summary><strong>Contact messages</strong></summary>

Submissions from the contact form. Statuses: `new`, `read`, `replied`, `archived`, `spam`. Bulk actions supported.
</details>

<details>
<summary><strong>Mailing Lists</strong></summary>

Opt-in feature module — enable via **Settings → Features**. Requires the Users feature (the dependency planner offers a cascade-enable when you toggle it on).

- **Lists** — name, slug, description, enabled flag, "registered users only", "double opt-in".
- **Subscribers** — admin add/edit/remove + bulk delete, search by name or email, force-confirm pending. Public subscribe via `POST /api/v1/lists/:slug/subscribe`.
- **Mail templates** — full block editor (Rich Text, Image, URL Link, Hero, Group, etc.), with an email render mode that inlines every style, swaps `swatch:{id}` for literal hex, and adapts blocks that can't render in email (video → poster + play link, form → CTA, carousel → first slide, etc.). Live preview iframe with debounced variable substitution.
- **Variables** — `{{user.name}}`, `{{user.email}}`, `{{user.phone}}`, `{{user.custom.field}}`, `{{list.name}}`, `{{site.name}}`, `{{unsubscribe_url}}`, etc. Substituted per recipient at send time; usable in any content block, subject, or preheader.
- **Send wizard** — pick a list + template, edit content for this send only, preview, confirm. Renders once and snapshots onto the job row, so editing the template later doesn't disturb in-flight or historical sends.
- **Job tracking** — per-recipient status (pending / sent / failed), live polling, retry-failed, cancel running, resume cancelled. Boot-time resumer recovers any job left in `running` from a previous crash.
- **Provider abstraction** — `MAIL_PROVIDER=smtp` (default; works with any SMTP relay) plus stubs for native REST adapters (Mailgun, SendGrid, Postmark). Welcome / donation-receipt emails flow through the same pipeline.
- **Unsubscribe** — `GET /u/<token>` token verified via HMAC-SHA256 over `MAIL_UNSUBSCRIBE_SECRET`. RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post` headers on every outbound message.
</details>

<details>
<summary><strong>Media library</strong></summary>

Upload images (JPG/PNG/GIF/WebP/SVG), video (MP4/WebM), and PDFs. Thumbnails via sharp. Local filesystem or S3 (factory). Reusable picker modal for inserting into content.
</details>

<details>
<summary><strong>Site Header & Footer editors</strong></summary>

Visual editors for the site chrome.

- **Header**: logo, nav, sticky / auto-hide on scroll, alignment, image links.
- **Footer**: drag-and-drop **rows** and **columns**, each with its own block content; fully responsive.
- All styles flow through the same swatch + font system as the rest of the site.
</details>

<details>
<summary><strong>Appearance & global styles</strong></summary>

- **Site color swatches** — name your brand colors once; reference them anywhere as `swatch:{id}`. Usage counts shown per swatch.
- **Custom fonts** — upload `.woff2` / `.ttf`; SiteSurge injects `@font-face` declarations on the public site. Use as `font-family: '<customId>'`.
- **Block-style templates** — save reusable per-block style presets (padding, colors, typography). Default style auto-applies to new blocks.
- **Site branding** — logo, tagline, header/footer config, color tokens, JSON-LD.
</details>

<details>
<summary><strong>Social media connections</strong></summary>

Pull-based sync; posts cached for 15 minutes.

| Provider | Auth | Cost | Token refresh |
|---|---|---|---|
| Instagram | Meta App OAuth | Free | Auto, every 7 days |
| YouTube | API Key | Free | None |
| Facebook | Page token | Free | None |
| X / Twitter | Bearer | Paid (Twitter API) | None |
| TikTok | OAuth | Free | Auto, daily |
| Patreon | Creator token | Free | None |

Embed individual posts in blog content via the Social Media block.
</details>

<details>
<summary><strong>Site Settings</strong></summary>

Site name, tagline, contact email, analytics ID, maintenance mode, branding, header/footer, integrations. Stored as a JSONB key/value store; cache-invalidated and audit-logged on every change.
</details>

<details>
<summary><strong>Developer tools (admin)</strong></summary>

`/admin/developer` shows registered background jobs (cron), last run, next run, and lets you trigger them manually. Token-refresh schedules live here.
</details>

---

## Technical overview

<details>
<summary><strong>Stack</strong></summary>

- **Frontend**: SolidJS + Vite, SCSS, `@solidjs/router`, `@solidjs/meta`, PWA (workbox).
- **Backend**: Node 20+, Express, TypeScript, raw `pg` (no ORM), Redis cache, JWT auth, multer + sharp, nodemailer, Stripe.
- **Shared**: `@sitesurge/types` workspace — types, API request/response DTOs, and validation/format utils consumed by every package.
- **Monorepo**: pnpm workspaces under `packages/*` (7 packages, all published to npm); `pnpm dev` starts the API + web app.
</details>

<details>
<summary><strong>Project layout</strong></summary>

Seven pnpm-workspace packages under `packages/*`, all published to npm under the **`@sitesurge`** scope (GPL-2.0-only). Config lives under `config/`, docs under `docs/`. **Package directory names lag their npm names** (pnpm resolves by name, not path).

| Folder | npm name | Purpose |
|---|---|---|
| `packages/api` | `@sitesurge/server` | Express REST API (`/api/v1/*`), SSR, migrations, backend SDK. Serves the admin SPA. Run standalone, in Docker, or embed via `createApp()`/`startServer()`. |
| `packages/cms` | `@sitesurge/admin` | SolidJS app — public site, admin portal, setup wizard. Published as **built static assets** + an `adminDistPath()` resolver that the server serves. |
| `packages/shared` | `@sitesurge/types` | TypeScript types, per-module request/response **DTOs**, and format/validation utils consumed by every other package. |
| `packages/cms-client` | `@sitesurge/client` | Headless TypeScript HTTP client — `createClient()` → `cms.<module>.<method>()`, SWR cache, typed error bus, SolidJS adapter. **Fully implemented.** |
| `packages/cms-mcp` | `@sitesurge/mcp` | Model Context Protocol server (`sitesurge-mcp` bin) wrapping the client — lets an AI agent author a whole site. |
| `packages/cli` | `@sitesurge/cli` | `sitesurge` ops CLI — `setup / migrate / seed / doctor / status / start`. |
| `packages/create-sitesurge` | `create-sitesurge` | `npm create sitesurge` scaffolder (Docker, `--node` thin-server repo, `--headless`). |

Versioning: `server` + `admin` + `cli` are a Changesets **fixed group** (lockstep); `types`, `client`, `mcp`, `create-sitesurge` version independently. The server also ships as `ghcr.io/rw3iss/sitesurge-server`.

```
packages/
  api/    Express REST API — /api/v1/* (@sitesurge/server)
    src/
      api/           defineRoute() + registry (mount + manifest), auth tiers
      routes/        thin route manifests (auth, validate, response shape)
      sdk/           cms.pages, cms.posts, … re-exports services
      services/      domain logic, cache invalidation, audit
      repositories/  SQL + row mapping
      middleware/    auth, content-access, error, setupGate
      db/            schema.sql, migrations/, seed.ts  (SQL copied into dist on build)
    scripts/copy-assets.mjs   ships db/*.sql into dist for `node dist`
  cms/            @sitesurge/admin — SolidJS SPA + asset-entry/ (adminDistPath)
  shared/         @sitesurge/types — types + src/api/routes/ DTOs + utils
  cms-client/     @sitesurge/client — headless HTTP client (implemented)
  cms-mcp/        @sitesurge/mcp — MCP server
  cli/            @sitesurge/cli — sitesurge ops CLI
  create-sitesurge/  create-sitesurge — npm create scaffolder
config/   all build/tool config (see below)
docs/     API.md, api-manifest.json, PUBLISHING.md, plans/specs
```

Routes are thin manifest handlers; `services/` own domain logic, cache invalidation, and audit logging; `sdk/` re-exports `services/` as the `cms.*` surface for scripts and future plugins — see `packages/api/src/sdk/README.md`.
</details>

<details>
<summary><strong>Configuration lives in <code>./config</code></strong></summary>

Every build/tool config file is centralized under `config/`, with per-package subdirectories plus repo-wide files:

```
config/
  api/{tsconfig.json, vitest.config.ts}
  cms/{tsconfig.json, vite.config.ts}
  shared/tsconfig.json
  cms-client/{tsconfig.json, tsup.config.ts, vitest.config.ts}
  cms-mcp/{tsconfig.json, tsup.config.ts, vitest.config.ts}
  cli/tsconfig.json
  create-sitesurge/tsconfig.json
  dprint.json                  # formatter
  .oxlintrc.json               # linter
  Dockerfile, docker-compose.yml
```

**Stub gotcha:** each package keeps a one-line `tsconfig.json` at its root that just `extends` the real config in `config/<pkg>/` — this satisfies editors/`tsc -p` discovery. Vite and Vitest are invoked with explicit `--config config/cms/vite.config.ts` / `--config config/api/vitest.config.ts` flags (those configs set `root`/`envDir` back to the package dir). Lint/format scripts pass `-c config/.oxlintrc.json` / `--config config/dprint.json`.

**Exceptions that must stay at their original location:**

| File | Why |
|---|---|
| `.editorconfig` | editors discover it by walking up from the edited file |
| `.dockerignore` | must sit at the Docker build-context root |
| `pnpm-workspace.yaml` + lockfiles | tool-required at repo root |
| `.github/` | GitHub requires this exact path |
| `packages/api/.env`, `.env.example` | dotenv default load path; keeps secrets next to the API |
| `packages/cms/index.html` | app entry, not config |
| package-root `tsconfig.json` stubs | the extends-shim above |
</details>

<details>
<summary><strong>Key environment variables</strong></summary>

Most installs configure these via the setup wizard. Manual reference:

```env
DATABASE_URL=postgresql://user:pass@localhost:5432/sitesurge
REDIS_URL=redis://localhost:6379
JWT_SECRET=...
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...

PATREON_CLIENT_ID=...
PATREON_CLIENT_SECRET=...
PATREON_REDIRECT_URI=https://yoursite.com/api/auth/patreon/callback

# Email — works with any SMTP relay (Brevo, Postmark, SendGrid, Mailgun, etc.)
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false               # STARTTLS — Nodemailer upgrades automatically
SMTP_USER=...
SMTP_PASS=...
EMAIL_FROM=newsletter@yoursite.com

# Mailing Lists feature module (required when the feature is enabled)
MAIL_PROVIDER=smtp              # smtp | mailgun | sendgrid | postmark  (only smtp is implemented today)
MAIL_SEND_CONCURRENCY=10        # parallel sends per chunk
MAIL_SEND_DELAY_MS=50           # pause between chunks (provider-rate-limit friendly)
MAIL_UNSUBSCRIBE_SECRET=...     # HMAC key for /u/<token>. Falls back to JWT_SECRET if unset, but set
                                # explicitly so rotating JWT_SECRET doesn't invalidate every existing
                                # unsubscribe link. Generate: `openssl rand -hex 32`

# Optional — social APIs (also configurable in admin)
YOUTUBE_API_KEY=...
TWITTER_BEARER_TOKEN=...
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
# Instagram is configured via OAuth in the admin portal
```

See `packages/api/.env.example` for the full list.
</details>

<details>
<summary><strong>SMTP setup (Brevo recommended for the free tier)</strong></summary>

The Mailing Lists feature + transactional mail (welcome, donation receipts) both flow through the configured SMTP provider. Any relay that speaks SMTP works — we ship with the Nodemailer-backed `SmtpMailProvider` as the default and only fully-implemented adapter. Switch providers via env vars; no code change.

**Recommended (free tier):** [Brevo](https://www.brevo.com) — 300 emails/day forever, no credit card. Authenticate your domain via the SPF + DKIM DNS records they provide, then:

```env
MAIL_PROVIDER=smtp
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<brevo-smtp-login>     # e.g. 'ab00f6001@smtp-brevo.com'
SMTP_PASS=<brevo-smtp-key>       # 'xsmtpsib-...'
EMAIL_FROM=newsletter@<your-authenticated-domain>
MAIL_UNSUBSCRIBE_SECRET=$(openssl rand -hex 32)
```

**Other options:**
- [Postmark](https://postmarkapp.com) — best deliverability; $15/mo for 10K. `SMTP_HOST=smtp.postmarkapp.com`. `SMTP_USER` + `SMTP_PASS` are both your server API token.
- [SendGrid](https://sendgrid.com) — 100/day forever. `SMTP_HOST=smtp.sendgrid.net`. `SMTP_USER=apikey`. `SMTP_PASS=<your-api-key>`.
- [Mailgun](https://mailgun.com), [AWS SES](https://aws.amazon.com/ses/), [Resend](https://resend.com) — all SMTP-compatible.

**Local development:** run [Mailpit](https://github.com/axllent/mailpit) so test sends don't burn the production quota:

```bash
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
```

```env
# .env.development
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=test@localhost
```

Web UI at <http://localhost:8025> — every send the app would make lands there for inspection.
</details>

<details>
<summary><strong>Build & deploy</strong></summary>

```bash
pnpm build          # all workspaces (pnpm -r resolves dependency order)
pnpm start          # production server (→ packages/api, node dist)

# or via Docker (Dockerfile + compose live in ./config)
pnpm docker:build
pnpm docker:up
pnpm docker:down
```

`pnpm -r` builds in dependency order so `@sitesurge/types` compiles before the packages that import it; the server build also copies `db/*.sql` into `dist`. The admin produces a static bundle; the server (Node 20+, PostgreSQL, Redis-optional) serves it. **Consumers don't build from source** — see [Getting Started](#getting-started) for the Docker image / npm-server / headless paths.
</details>

<details>
<summary><strong>Common scripts</strong></summary>

```bash
npm run dev               # api + web app concurrently
npm run dev:frontend      # @sitesurge/admin only (port 3000)
npm run dev:backend       # @sitesurge/server only (port 3001)
npm run build             # all workspaces, dependency-ordered
npm run db:migrate        # run pending migrations (→ packages/api)
npm run db:seed           # seed defaults (--demo for sample content)
npm run docs:api          # regenerate docs/API.md + docs/api-manifest.json from the live manifest
npm run lint              # oxlint -c config/.oxlintrc.json over packages/*/src
npm run lint:fix          # lint with --fix
npm run format            # dprint fmt --config config/dprint.json
npm run format:check      # dprint check (CI gate)
npm run test             # all workspaces, --if-present
npm run docker:up         # docker compose -f config/docker-compose.yml up -d
npm run docker:down       # … down
npm run docker:build      # … build
```
</details>

---

## Headless Mode

SiteSurge is API-first. The same REST surface that powers the bundled SPA is
available to external clients — other servers, scripts, mobile apps, or a
typed SDK. Every endpoint lives under `/api/v1` and responds in a single
envelope:

```json
{ "success": true, "data": <payload>, "meta": { } }
{ "success": false, "error": { "code": "NOT_FOUND", "message": "…" } }
```

`error.code` is one of a fixed `ErrorCode` set (exported from `@sitesurge/types`);
clients switch on it. The full machine-readable route list lives in
[`docs/api-manifest.json`](docs/api-manifest.json) and the human reference in
[`docs/API.md`](docs/API.md) — both regenerated from the live route manifest
with `npm run docs:api`.

### Typed client (`@sitesurge/client`)

All client-side API requests flow through `@sitesurge/client` — **including our
own `@sitesurge/admin` app**, which is fully migrated to it (the `cms` singleton
in `packages/cms/src/services/cmsClient.ts` is the sole networking path). The
client wraps the documented REST surface ([`docs/API.md`](docs/API.md) +
[`docs/api-manifest.json`](docs/api-manifest.json)) with the shared DTOs, so a
single typed change propagates to every caller.

`createClient({ baseUrl, auth })` exposes `cms.<module>.<method>()` for the entire
route surface, with SWR caching, token auto-load, a typed error bus, and an
optional SolidJS adapter. See
[`packages/cms-client/docs/Overview.md`](packages/cms-client/docs/Overview.md).

**Shared DTOs:** every module's request and response types live in
`@sitesurge/types` under [`packages/shared/src/api/routes/`](packages/shared/src/api/routes/).
The backend binds its zod schemas to these same definitions, so the client and
the server share **one** definition per shape — drift is a compile error, not a
runtime surprise.

### Authentication

There are two auth modes.

**1. User JWT** — for end users and interactive clients.

`POST /api/v1/auth/login` returns an `AuthResponse` with `accessToken`
(15 min) and `refreshToken` (7 d) in the body, and also sets httpOnly cookies
for browsers. Send the access token as `Authorization: Bearer <accessToken>`.
When it expires, call `POST /api/v1/auth/refresh` for a new pair.

CSRF: Bearer- and API-key-authenticated requests bypass CSRF entirely. Only
cookie-mode state-changing requests need it — a cookie-session client issues
one `GET` to receive the `csrf-token` cookie, then echoes it back in the
`x-csrf-token` header on subsequent writes. Headless clients should use Bearer
or API-key auth and skip CSRF altogether.

**2. API keys** — for machine clients and integrations.

Create a key in the admin UI under **Settings → API Keys** and send it as
`Authorization: Bearer ssk_…`. Keys carry a scope: `read < write < admin`. A
`GET` needs `read` or higher; any mutation (`POST`/`PUT`/`PATCH`/`DELETE`)
needs `write` or higher. Keys cannot manage other keys — key administration
requires a full admin session.

Set `CORS_ORIGINS` (comma-separated) so browser clients on other origins are
allowed through CORS.

### Examples

```bash
# 1. Log in (user JWT)
curl -s -X POST https://yoursite.com/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@yoursite.com","password":"…"}'
# → { "success": true, "data": { "user": {…}, "accessToken": "…", "refreshToken": "…" } }

# 2. List posts including drafts (Bearer JWT, admin view)
curl -s 'https://yoursite.com/api/v1/posts?status=all' \
  -H 'Authorization: Bearer <accessToken>'

# 3. Create a post with an API key (scope: write or admin)
curl -s -X POST https://yoursite.com/api/v1/posts \
  -H 'Authorization: Bearer ssk_…' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Hello","slug":"hello","status":"draft"}'

# 4. Public list — no auth (published posts only)
curl -s 'https://yoursite.com/api/v1/posts'
```

### MCP server (`@sitesurge/mcp`) — build the site with an AI agent

`@sitesurge/mcp` (`packages/cms-mcp`) is a [Model Context Protocol](https://modelcontextprotocol.io)
server that exposes the **entire authoring surface** — pages, posts, every
content-block type (and the content inside them), block styles + shared style
templates, appearance (colors/swatches/fonts/layout), the site header, the site
footer, navigation, media, and every setting/feature — as **66 MCP tools** over
the typed client. Point an MCP-capable agent (e.g. Claude) at it with a scoped
`ssk_` API key and it can design and build a complete site.

It adds what the raw API cannot: authoritative, machine-readable **block-type
schemas** (`describe_block_types`), workflow ergonomics for the hard parts (group
nesting, single-post-block edits, media-from-path/URL, applying style templates),
and structured errors.

```jsonc
// MCP client config (e.g. Claude Desktop / Claude Code "mcpServers")
{
  "cms": {
    "command": "npx",
    "args": ["-y", "@sitesurge/mcp"],
    "env": {
      "CMS_BASE_URL": "https://yoursite.com",
      "CMS_API_KEY": "ssk_…"          // Settings → API Keys; write/admin scope to author
    }
  }
}
```

Full tool reference, setup, and the authoring guide: [`docs/MCP.md`](docs/MCP.md).
Set `CMS_MCP_READONLY=true` for a safe read-only server.

---

## Support

For technical issues, open an issue or contact your maintainer. For content questions, refer to the Administrator Guide above.
