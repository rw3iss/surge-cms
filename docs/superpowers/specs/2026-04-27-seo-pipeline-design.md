# SEO Pipeline Design

## Goal

Maximize crawlability and indexing of dynamic CMS content (pages, posts, campaigns) without imposing a static-build pipeline that would slow operator iteration.

## Status snapshot

What we already ship (✅ done before this work):

- **Per-route SSR meta injection** (`backend/src/services/ssr/`): `<title>`, description, OG, Twitter Card, JSON-LD (Article / Breadcrumb / CollectionPage / Donation / Organization), AEO summary tags. Bots see correct head metadata even with JS disabled.
- **Dynamic sitemap.xml** (`backend/src/routes/sitemap.ts`): pages + posts + campaigns + forms, with `<lastmod>`/`<changefreq>`/`<priority>`, Redis-cached 1h.
- **`robots.txt`** (`frontend/public/robots.txt`): references the sitemap URL.
- **Canonical URLs**: every route in `services/ssr/routes.ts` sets `canonical`.
- **og:image fallback**: `image: post.featuredImage || logo` in the route resolver.
- **JSON-LD schemas**: Article, Breadcrumb, CollectionPage, Donation, Organization, WebPage. Solid scaffolding in `services/ssr/schema.ts`.

What's still missing — the focus of this work:

- **Server-rendered HTML body**. The `<head>` is correct, but `<div id="root">` is empty until JS runs. Crawlers without JS see no article content.
- **RSS/Atom feed** for posts.
- **Cache invalidation hooks** so SSR HTML refreshes the moment an admin saves.

## Plan

### Tier 1 — quick wins (this session)

| Item | Status | Notes |
|---|---|---|
| Sitemap.xml | ✅ done | Already comprehensive. |
| robots.txt | ✅ done | References sitemap. |
| Canonical URLs | ✅ done | All routes in `services/ssr/routes.ts`. |
| og:image fallback | ✅ done | Falls back to `publisherLogo()` (site logo or icon). |
| **RSS feed** | 🔨 to do | New `/feed.xml` Express route, RSS 2.0 of recent published posts, Redis cached. |
| **SSR cache invalidation hooks** | 🔨 to do | Hook into `cache.invalidatePostCache` / `invalidatePageCache` so saving an admin edit drops the SSR HTML for that URL too. |

### Tier 2a — progressive-enhancement SSR body (this session)

The pragmatic middle ground: server-render meaningful HTML body content into `<div id="root">` alongside the existing meta tag injection. The Solid SPA's `render()` then replaces `#root`'s contents on hydrate (no shared-tree hydration, but bots get the full content and users see a brief flash then SPA takes over).

**What's rendered server-side per route:**

- **Post detail** (`/posts/{slug}`): `<article>` with `<h1>` title, byline, `<p>` excerpt, sanitized post content HTML.
- **Post listing** (`/posts`): heading + `<ul>` of post cards (link, title, excerpt).
- **Page detail** (catch-all `/{slug}`): `<article>` with optional `<h1>` (gated on `showTitle`), then text-relevant content blocks (rich_text, text, html) serialized to HTML. Dynamic blocks (form, social_feed, post_list) skipped — bots can't index runtime feeds anyway.
- **Campaign detail** (`/campaigns/{slug}`): title + description.
- **Homepage**: site name h1 + description.

**Implementation:**

1. New `services/ssr/bodyBuilder.ts` — `buildBodyHtml(meta, content)` returns an HTML string.
2. Extend the route resolver to optionally include a `body` field carrying the content needed for `bodyBuilder`.
3. New `<!-- SSR_BODY -->` marker added inside `<div id="root">` in `index.html`. The SSR pipeline replaces the marker (or the whole `#root` inner content) with the rendered body.
4. Solid's existing `render()` call in `frontend/src/index.tsx` already replaces `#root` contents — no client-side change needed.
5. The injected body is wrapped in a parent class/attribute that:
   - Lets bots and screen readers see semantic HTML.
   - The SPA's `render()` simply overwrites it on mount; users see at most one frame of static content.

**Caveats:**

- This is **not** SolidJS hydration. There's no DOM reuse / event-handler attachment from the static markup. Users will see a brief content flash as the SPA mounts. Acceptable for SEO; not pixel-perfect.
- Server-side block rendering is **simplified** — basic HTML, no SCSS layout. The bot reads content; the human gets the SPA's polished view a frame later.
- HTML is sanitized (using the existing `sanitize` util) before injection.

### Tier 2b — true Solid hydration (future, multi-day refactor)

Not implemented here. Outline for the future migration:

1. Adopt or replicate **`solid-start`** structure or use `solid-js/web`'s `renderToString` directly.
2. Audit every component for browser-only globals (`window`, `document`, `localStorage`, `fetch` shim). The `AuthProvider`, `siteSettings` store, `swatch` resolver, `Layout`'s focus listeners, the FlyoutPanel's pointer events all need server guards.
3. Build a separate **server bundle** with `vite-plugin-solid` in SSR mode.
4. Coordinate **resource data** between server and client — Solid has `createResource`'s SSR mode but our resources were written for client-only. Each one needs a server-friendly variant or a data-injection hook.
5. **Hydrate** on the client using `hydrate()` instead of `render()`.
6. Plumb auth: SSR for anonymous users only initially; auth'd renders go through the SPA.

Estimate: 1–2 weeks of focused work plus extensive testing. Defer until Tier 2a's SEO benefit is proven insufficient.

### Tier 3 — eager pre-rendering on write (future)

Builds on Tier 2a. When an admin saves a post or page:

1. The `cache.invalidatePostCache(slug)` already invalidates Redis.
2. **NEW**: a background tick re-renders the URL via the SSR pipeline and stores it back in Redis. Read path becomes ~100% cache-hit.
3. Optional: for static-CDN deploys, write the HTML to disk under `cache/static-html/{slug}.html` — the SSR pipeline already checks for this file before rendering (`getStaticHtml`).

Trivial to layer on once Tier 2a is in place — just a write-through cache.

## Standard out-of-box alternatives (rejected for now)

| Tool | Why we're not using it |
|---|---|
| solid-start | Excellent fit but is a frontend framework migration. Wait until Tier 2a proves insufficient. |
| Astro | Best content-site stack but requires rewriting the frontend. |
| Next.js / Remix | Wrong runtime (React). Full rewrite. |
| Prerender.io / rendertron | Service-based, costs money, treats bots differently from users — not great long-term. |
| Hugo / Zola / Eleventy | SSGs that don't fit dynamic admin-driven content. |

## On Rust / max-perf

For SEO specifically, render speed isn't the bottleneck — Redis cache hits dwarf the renderer. Bun + Hono on Cloudflare Workers is a real option later for global edge SSR, but doesn't move the SEO needle alone.

## What's NOT in scope for this work

- True hydration (Tier 2b).
- Eager pre-render workers (Tier 3).
- Image-server transformation (separate concern).
- AMP, Schema.org Product/Recipe (out of scope for a journalism CMS).
- WebSub / RSS Cloud push notifications (RSS itself is enough for now).
