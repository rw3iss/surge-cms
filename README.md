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
- **Media library** — upload, crop, thumbnails (sharp), local FS or S3.
- **Social connections** — pull-based sync from YouTube, Instagram, X/Twitter, Facebook, TikTok, Patreon. The Social block holds either an auto-feed for a connected provider or hand-picked posts via per-slot search + advanced selection modal.
- **Custom header & footer editors** — drag-and-drop rows + columns, fully styled per site.
- **Global appearance system** — shared color swatches, custom fonts, reusable block-style templates, `swatch:{id}` references everywhere.
- **Backend SDK** — `cms.pages`, `cms.posts`, `cms.campaigns`, … one typed surface for routes, scripts, and plugins.
- **First-run setup wizard** — run the app, open `/setup`, done. Validates DB / Redis / SMTP / S3 inline.
- **PWA + CDN-ready** — static frontend bundle, app shell, offline-friendly.

---

## Quickstart

```bash
git clone <repo>
cd <project>
npm install
npm run dev
```

Then open <http://localhost:3000/setup> and follow the wizard. It will detect what's already configured, validate inputs live, run migrations, seed defaults, create the first admin, and write `.env`.

Manual install (CI / scripted):

```bash
cp backend/.env.example backend/.env   # fill in values
npm run db:migrate -w backend
npm run db:seed -w backend             # add --demo for sample content
npm run dev
```

**Prerequisites:** Node 20+, PostgreSQL 14+, Redis 6+.

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
- **Shared**: `@rw/shared` workspace — types and validation/format utils.
- **Monorepo**: npm workspaces (`frontend`, `backend`, `shared`); `npm run dev` starts both.
</details>

<details>
<summary><strong>Project layout</strong></summary>

```
frontend/    SolidJS SPA — public site, admin portal, setup wizard
backend/     Express REST API — /api/v1/*
  src/
    routes/        HTTP shims (auth, validate, response shape)
    sdk/           cms.pages, cms.posts, … unified business-logic SDK
    repositories/  SQL + row mapping
    services/      auth, cache, email, payment, social, ssr
    middleware/    auth, content-access, error, setupGate
    db/            schema.sql, migrations/, seed.ts
shared/      @rw/shared — TypeScript types + format/validation utils
```

The SDK (`backend/src/sdk/`) is the single import surface for capability methods. Routes are HTTP shims; the SDK owns domain logic, cache invalidation, and audit logging. Scripts and future plugins use the same surface — see `backend/src/sdk/README.md`.
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

SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=noreply@yoursite.com

# Optional — social APIs (also configurable in admin)
YOUTUBE_API_KEY=...
TWITTER_BEARER_TOKEN=...
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
# Instagram is configured via OAuth in the admin portal
```

See `backend/.env.example` for the full list.
</details>

<details>
<summary><strong>Build & deploy</strong></summary>

```bash
npm run build              # builds frontend + backend + shared
npm start -w backend       # production server
```

The frontend produces a static bundle suitable for any CDN (CloudFront, Netlify, Vercel). The backend needs Node 20+, PostgreSQL, and Redis.
</details>

<details>
<summary><strong>Common scripts</strong></summary>

```bash
npm run dev               # frontend + backend concurrently
npm run dev:frontend      # frontend only (port 3000)
npm run dev:backend       # backend only (port 3001)
npm run build             # build all workspaces
npm run db:migrate        # run pending migrations
npm run db:seed           # seed defaults (--demo for sample content)
```
</details>

---

## Support

For technical issues, open an issue or contact your maintainer. For content questions, refer to the Administrator Guide above.
