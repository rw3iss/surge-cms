# SEO Checklist

A complete reference for every controllable SEO surface on a SiteSurge
page — meta tags, structured data, semantic HTML, performance, and
operational concerns. Use it as a checklist to audit a route, a block,
or the whole site.

The document is organized so you can:

1. **Skim the [Quick Audit Checklist](#quick-audit-checklist)** to score
   any single page in ~2 minutes.
2. **Look up a specific tag** in the reference tables (head meta, Open
   Graph, Twitter, JSON-LD).
3. **Find where each piece lives in the codebase** in the
   [Implementation map](#implementation-map-where-each-piece-lives)
   section at the bottom.

Where a row's "Status" column is left blank, treat it as a TODO when
you go through this doc against the live site.

---

## Quick audit checklist

Run through this for any page. A "✓" should be answerable in seconds;
each ✗ links to the section that explains the fix.

### Crawlability

- [ ] Page returns HTTP **200** for indexable URLs and **404** for
      missing ones (not a 200 with a "not found" body).
- [ ] `robots.txt` lists the production sitemap; no critical paths in
      `Disallow:` by accident.
- [ ] `sitemap.xml` includes every public page and post; `<lastmod>` is
      accurate.
- [ ] Page is reachable from at least one crawled internal link
      (no orphan).
- [ ] Server-rendered HTML body contains the page's primary content
      *before* the SPA mounts (so a JS-disabled crawler still reads it).

### `<head>` essentials

- [ ] Unique `<title>` (50-60 chars, primary keyword near the front).
- [ ] Unique `<meta name="description">` (140-160 chars).
- [ ] `<link rel="canonical">` set to the preferred URL.
- [ ] `<meta name="viewport">` present and sane.
- [ ] `<meta charset="utf-8">` present.
- [ ] `<meta name="robots">` set when the page should NOT be indexed
      (otherwise omit; the default is index, follow).
- [ ] `<link rel="alternate" type="application/rss+xml">` on pages
      that have a feed.

### Social cards

- [ ] Open Graph: `og:title`, `og:description`, `og:image` (≥1200×630),
      `og:url`, `og:type`, `og:site_name`, `og:locale`.
- [ ] Twitter: `twitter:card="summary_large_image"`, `twitter:title`,
      `twitter:description`, `twitter:image`.

### Structured data (JSON-LD)

- [ ] Site-wide: `Organization` *or* `Person` schema in the homepage.
- [ ] Site-wide: `WebSite` with `SearchAction` (sitelinks search box).
- [ ] Per-page: `WebPage` *or* a more specific subtype
      (`Article`, `BlogPosting`, `Product`, `Event`, …).
- [ ] Per-page: `BreadcrumbList` reflecting the URL path.
- [ ] No JSON-LD validation errors in
      [Rich Results Test](https://search.google.com/test/rich-results).

### Semantic HTML

- [ ] Exactly one `<h1>` per page matching the visible page topic.
- [ ] Heading levels descend without skipping (`h1 → h2 → h3`, not
      `h1 → h3`).
- [ ] Page uses `<main>`, `<article>`, `<section>`, `<nav>`, `<aside>`,
      `<header>`, `<footer>` where appropriate.
- [ ] Lists are `<ul>` / `<ol>` not `<div>` stacks.

### Images

- [ ] Every meaningful `<img>` has descriptive `alt`.
- [ ] Decorative images have `alt=""` (empty, not missing).
- [ ] Images have explicit `width` + `height` (or aspect-ratio) to
      prevent CLS.
- [ ] `loading="lazy"` on below-the-fold images.
- [ ] Modern formats (`<picture>` with WebP/AVIF) when bandwidth
      matters.

### URLs

- [ ] URLs are lowercase, hyphen-separated, ASCII, ≤75 chars.
- [ ] No tracking params on canonical (`?utm_*` are stripped/canonicalised).
- [ ] No trailing slash inconsistency (pick one and 301 the other).

### Performance / Core Web Vitals

- [ ] LCP < 2.5s (lab and field).
- [ ] CLS < 0.1.
- [ ] INP < 200ms.
- [ ] Critical CSS inlined / preloaded; non-critical deferred.
- [ ] Hero image preloaded with `<link rel="preload" as="image">` when
      it's the LCP element.
- [ ] No render-blocking JS in `<head>` (use `defer` / `async`).

### Accessibility (overlaps with SEO)

- [ ] Page passes Lighthouse Accessibility ≥ 95.
- [ ] All interactive elements reachable by keyboard, with visible
      focus.
- [ ] Color contrast ≥ 4.5:1 for body text, 3:1 for large text.
- [ ] `lang` attribute on `<html>` matches content language.
- [ ] Form inputs have associated `<label>` (or `aria-label`).

### Site-level

- [ ] HTTPS only; HTTP redirects to HTTPS via 301.
- [ ] `Strict-Transport-Security` header set with at least 6-month max-age.
- [ ] `X-Content-Type-Options: nosniff` and `Referrer-Policy` set.
- [ ] Canonical host enforced (e.g. `www.example.com` 301 to `example.com`).
- [ ] 404 page returns 404, has helpful nav, doesn't `noindex` itself.

---

## 1. `<head>` meta tag reference

The minimum viable head. Unless noted, every public page should set
all "Required" rows.

| Tag | Required | Purpose | Example | Best practices |
|---|---|---|---|---|
| `<meta charset>` | ✓ | Character encoding | `<meta charset="utf-8">` | First child of `<head>`. |
| `<meta name="viewport">` | ✓ | Mobile rendering | `<meta name="viewport" content="width=device-width, initial-scale=1">` | Don't set `maximum-scale` or `user-scalable=no` (a11y violation). |
| `<title>` | ✓ | Browser tab + SERP title | `<title>Page name — Site Name</title>` | 50-60 chars; primary keyword near the front; site name suffix optional. |
| `<meta name="description">` | ✓ | SERP snippet | `<meta name="description" content="...">` | 140-160 chars; one sentence; include the page's value prop and an action. Google may rewrite if poor quality. |
| `<link rel="canonical">` | ✓ | Preferred URL for duplicate / param variants | `<link rel="canonical" href="https://example.com/page">` | Absolute URL. Self-referential is fine (and recommended for clarity). |
| `<meta name="robots">` | when needed | Index/follow override | `<meta name="robots" content="noindex, follow">` | Omit on indexable pages — default is `index, follow`. Use for staging, drafts, search results, paginated archives. |
| `<meta name="googlebot">` | rare | Google-specific override | `<meta name="googlebot" content="noindex">` | Only when behavior should differ from `robots`. |
| `<meta http-equiv="content-language">` | ✗ | Legacy; superseded by `<html lang>` | — | Skip; use `<html lang="en">` instead. |
| `<meta name="keywords">` | ✗ | Ignored by Google since ~2009 | — | Don't bother. |
| `<meta name="author">` | optional | Author (rarely surfaced) | `<meta name="author" content="Jane Doe">` | Use Article schema instead — richer. |
| `<meta name="theme-color">` | optional | Browser chrome tint (mobile) | `<meta name="theme-color" content="#e63946">` | Match brand. PWA browsers honor it. |
| `<meta name="color-scheme">` | optional | Light/dark hint | `<meta name="color-scheme" content="light dark">` | Helps Chrome render scrollbars/inputs in the right palette before CSS loads. |
| `<link rel="icon">` | ✓ | Favicon | `<link rel="icon" href="/favicon.ico">` | Plus `apple-touch-icon` and PNG variants for completeness. |
| `<link rel="apple-touch-icon">` | optional | iOS home screen | `<link rel="apple-touch-icon" href="/icons/icon-192x192.png">` | 180×180 is the modern default. |
| `<link rel="manifest">` | optional | PWA manifest | `<link rel="manifest" href="/manifest.webmanifest">` | Enables Add-to-home-screen + theme color. |
| `<link rel="alternate" type="application/rss+xml">` | when applicable | RSS discovery | `<link rel="alternate" type="application/rss+xml" href="/feed.xml" title="Site name">` | One per feed. |
| `<link rel="alternate" hreflang>` | when international | Language variants | `<link rel="alternate" hreflang="es" href="https://example.com/es/page">` | Add `hreflang="x-default"` for the default-language URL. Bidirectional — every variant must list every other variant. |
| `<link rel="prev"> / <link rel="next">` | optional | Paginated series | `<link rel="next" href="/blog?page=2">` | Google ignores them but Bing and others use them. Cheap to keep. |
| `<link rel="preload">` | when targeted | Resource priority | `<link rel="preload" as="image" href="/hero.jpg">` | Use sparingly for the LCP image / hero font. |
| `<link rel="preconnect">` | when targeted | Open TCP early to a known origin | `<link rel="preconnect" href="https://cdn.example.com">` | One for each cross-origin you load critical assets from. |
| `<link rel="dns-prefetch">` | optional | Cheaper than preconnect for non-critical | `<link rel="dns-prefetch" href="//analytics.example.com">` | — |
| `<meta name="generator">` | optional | CMS attribution | `<meta name="generator" content="SiteSurge">` | Harmless; some operators prefer to omit for security obscurity. |
| Search Console verification | per provider | Ownership proof | `<meta name="google-site-verification" content="...">` | Also available via DNS TXT or HTML file — pick one. |

---

## 2. Open Graph (OG) reference

OG drives Facebook, LinkedIn, Slack, Discord, iMessage previews. Set
all "Required" rows on every page that may be shared.

| Tag | Required | Purpose | Example | Best practices |
|---|---|---|---|---|
| `og:title` | ✓ | Card title | `<meta property="og:title" content="Page name">` | Often same as `<title>` minus the site-name suffix. |
| `og:description` | ✓ | Card subtitle | `<meta property="og:description" content="...">` | 2-4 sentences max; expressive of the page's value. |
| `og:image` | ✓ | Card image | `<meta property="og:image" content="https://...">` | ≥1200×630 (1.91:1), <8MB, JPG/PNG. Absolute URL. |
| `og:image:width` / `:height` | recommended | Image dims | `1200` / `630` | Helps the scraper avoid a fetch round-trip. |
| `og:image:alt` | recommended | Alt text for the OG image | `<meta property="og:image:alt" content="...">` | Mirrors `<img alt>` semantics. |
| `og:url` | ✓ | Canonical URL of the page | absolute https URL | Match `<link rel="canonical">`. |
| `og:type` | ✓ | Object type | `website`, `article`, `book`, `product`, `profile`, … | `article` for blog posts; `website` for everything else by default. |
| `og:site_name` | ✓ | Site brand name | `<meta property="og:site_name" content="SiteSurge">` | Same on every page. |
| `og:locale` | ✓ | Page locale | `en_US` | Use the format `xx_YY`. |
| `og:locale:alternate` | when international | Alternate locales | `en_GB` | One per alternate. |
| `article:published_time` | when `og:type=article` | ISO publish date | `2026-04-30T14:00:00Z` | RFC 3339 / ISO 8601. |
| `article:modified_time` | when applicable | ISO modified date | — | Improves freshness signal. |
| `article:author` | optional | Author URL | absolute URL to author profile | — |
| `article:section` | optional | Top-level category | `Technology` | Helps Discover surface the post in topics. |
| `article:tag` | optional | One per topic tag | `Climate` | Repeat for each tag. |

**Image rules of thumb**

- Use a single 1200×630 image as the default. Twitter and LinkedIn
  both consume the OG image when they don't find their own.
- Don't put critical text within 100px of the edges; some platforms
  crop.
- If you have one image per page already (hero / featured), reuse it —
  don't generate a separate OG-only asset unless aspect ratio differs.

---

## 3. Twitter Card reference

Twitter (X) reads OG when these are absent, but explicit cards win.

| Tag | Required | Purpose | Example | Best practices |
|---|---|---|---|---|
| `twitter:card` | ✓ | Card style | `summary_large_image` | Use `summary_large_image` for everything that has a featured image; `summary` for plain articles. |
| `twitter:title` | recommended | Card title | mirror `og:title` | — |
| `twitter:description` | recommended | Card subtitle | mirror `og:description` | — |
| `twitter:image` | recommended | Card image | mirror `og:image` | Min 300×157 for `summary_large_image`. |
| `twitter:image:alt` | recommended | Image alt text | mirror `og:image:alt` | — |
| `twitter:site` | optional | Site's @handle | `@sitesurge` | — |
| `twitter:creator` | optional | Author's @handle | `@author` | Article-only. |

---

## 4. Structured data (JSON-LD) reference

Embed in a `<script type="application/ld+json">` in `<head>`. JSON-LD
is preferred over microdata/RDFa per Google's docs. Don't lie — Google
will demote pages whose schema doesn't match the visible content.

### Page-level types (pick one per page)

| Type | When to use | Required fields |
|---|---|---|
| `WebPage` | Generic page | `@context`, `@type`, `name`, `url` |
| `Article` | Long-form content (blog, news) | `headline`, `image`, `datePublished`, `author` |
| `BlogPosting` | Article subtype for blog posts | same as `Article` + `mainEntityOfPage` |
| `NewsArticle` | News reporting | `headline`, `image`, `datePublished`, `dateModified`, `author`, `publisher` |
| `Product` | E-commerce | `name`, `image`, `description`, `offers` |
| `Event` | Concerts, conferences, etc. | `name`, `startDate`, `location` |
| `Recipe` | Recipes | `name`, `image`, `recipeIngredient`, `recipeInstructions` |
| `FAQPage` | Q&A pages | `mainEntity` (Question + acceptedAnswer) |
| `HowTo` | Step-by-step guides | `name`, `step` |
| `VideoObject` | Embedded video | `name`, `thumbnailUrl`, `uploadDate`, `contentUrl` or `embedUrl` |
| `JobPosting` | Job listings | many — see [Google docs](https://developers.google.com/search/docs/appearance/structured-data/job-posting) |
| `LocalBusiness` | Brick-and-mortar | `name`, `address`, `telephone`, `geo` |
| `Organization` | Company / non-profit (homepage) | `name`, `url`, `logo`, `sameAs` (social URLs) |
| `Person` | Personal site (homepage) | `name`, `url`, `image`, `sameAs` |

### Always-include site-level types

| Type | Purpose | Notes |
|---|---|---|
| `WebSite` | Homepage; enables sitelinks search box | Include `potentialAction` of type `SearchAction`. |
| `Organization` / `Person` | Brand identity | Once on the homepage; the rest of the site can reference via `@id`. |
| `BreadcrumbList` | Per-page; surfaces breadcrumb in SERP | One per page. List from root → current. |

### Useful supplementary types

- **`SiteNavigationElement`** for top nav (rarely shown, harmless)
- **`Comment`** if comments are visible on the page
- **`AggregateRating`** for reviewable products / recipes / events
- **`SpeakableSpecification`** to mark the most-listenable bits for
  voice assistants

### Validation

- Test against [Rich Results Test](https://search.google.com/test/rich-results)
- For full-spec validation use [Schema Markup Validator](https://validator.schema.org/)
- One JSON-LD per type per page is fine; one combined `@graph` array
  is also fine and slightly cheaper.

---

## 5. Semantic HTML

Search engines and accessibility tools both lean on the document's
outline. Use the right elements; don't reach for `<div>`.

| Element | Use it for | Don't use it for |
|---|---|---|
| `<header>` | Top of page or section | A logo container by itself (use a `<div>`) |
| `<nav>` | Site nav, in-page TOC, breadcrumb | Footer link rolls (use plain `<ul>`) |
| `<main>` | The single primary content area | Sidebars, ads |
| `<article>` | Self-contained content (post, product card) | Page wrapper |
| `<section>` | Thematic grouping with a heading | Generic styling wrapper |
| `<aside>` | Tangential content (related posts, sidebar) | Footer or modal |
| `<footer>` | Bottom of page or section | Just any closing element |
| `<figure>` / `<figcaption>` | Image with caption | Image without caption |
| `<time datetime>` | Dates and durations | Bare strings without `datetime` |
| `<address>` | Contact info for owner of the page/article | A general address |

### Headings

- One `<h1>` per page that matches the page topic.
- Skip-free descent: `h1 → h2 → h3`, not `h1 → h4`.
- Don't use a heading for visual size — use CSS.
- Section heading > section content. Avoid "section ends with the
  next h2" cliffs by closing each section properly with `</section>`.

### Lists

- Use `<ul>` / `<ol>` for lists.
- Definition pairs go in `<dl>` / `<dt>` / `<dd>` (often skipped).

### Links

- Anchor text should describe the destination ("Read the SEO guide"
  not "click here").
- Avoid the word "link" or "page" inside anchor text.
- Internal links live as `<a href="/path">`, not JS-bound `<div
  onclick>` (those are invisible to crawlers and keyboard users).

---

## 6. Image SEO

| Concern | What to do |
|---|---|
| Alt text | Descriptive; if decorative, `alt=""` (the empty string explicitly). |
| Filename | Lowercase, hyphenated, descriptive (`hero-mountain-sunset.jpg`, not `IMG_4823.jpg`). |
| Size | Serve at the rendered size; max 200KB for hero images, less for thumbs. |
| Format | WebP / AVIF when supported, JPEG/PNG fallback via `<picture>`. |
| Dimensions | Always set `width` + `height` attributes (or `aspect-ratio` CSS) to prevent CLS. |
| Lazy loading | `loading="lazy"` on below-the-fold images. |
| Eager loading | `loading="eager" fetchpriority="high"` on the LCP image. |
| Responsive | `srcset` + `sizes` so browsers pick the right resolution. |
| Captions | `<figure>` + `<figcaption>` when context matters. |
| Decorative SVG | `aria-hidden="true"`, no alt needed. |
| Image sitemap | If image search is important, include images in `sitemap.xml` via `<image:image>` entries. |

### Modern responsive image template

```html
<picture>
  <source srcset="/img/hero-1200.avif 1200w, /img/hero-800.avif 800w" type="image/avif" sizes="(min-width: 768px) 1200px, 100vw">
  <source srcset="/img/hero-1200.webp 1200w, /img/hero-800.webp 800w" type="image/webp" sizes="(min-width: 768px) 1200px, 100vw">
  <img src="/img/hero-1200.jpg" alt="Mountain sunset over the Grand Canyon"
       width="1200" height="630" loading="eager" fetchpriority="high">
</picture>
```

---

## 7. URL structure

- Lowercase, hyphenated, ASCII.
- Hierarchical and human-readable: `/blog/2026/seo-checklist`, not
  `/p?id=42`.
- Canonical case: pick one and 301 the others.
- Canonical trailing-slash: pick `/about` or `/about/` and 301.
- Strip session IDs and tracking params from the canonical URL.
- Stable: avoid `?_=12345` cache-busters in URLs that get linked.
- `?utm_*` should NOT change the canonical. Use `<link rel="canonical">`
  to anchor the no-utm version.

### Slug rules

- ≤75 chars; remove stop words ("a", "the", "of") if it doesn't hurt
  readability.
- One concept per slug; don't stuff keywords ("buy-cheap-best-running-shoes-online").
- Avoid dates in slugs unless the content is genuinely date-pegged
  (news). Evergreen slugs let you update the post without orphan URLs.

---

## 8. Sitemap and robots

### `robots.txt`

Lives at `/robots.txt` and is the first file most crawlers fetch.
Minimum:

```
User-agent: *
Allow: /

Sitemap: https://example.com/sitemap.xml
```

Add `Disallow:` for admin / search / login / staging only. Don't
`Disallow` `/static/` or `/_next/` etc — Google needs to load CSS/JS
to render the page.

### `sitemap.xml`

Lives at `/sitemap.xml`. One entry per indexable URL.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/posts/seo-checklist</loc>
    <lastmod>2026-04-30</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>
```

- `lastmod` is the only field Google really uses — make it accurate.
- `changefreq` and `priority` are hints; most engines ignore them.
- Split into multiple files (`sitemap-posts.xml`, `sitemap-pages.xml`)
  + a `sitemap-index.xml` if the site has >50K URLs.

### `sitemap-news.xml` / `sitemap-image.xml`

Specialised sitemaps for news and image-heavy sites — only worth
adding when image / news traffic actually matters.

---

## 9. HTTP / server-side

| Concern | What to do |
|---|---|
| HTTPS | Required. Redirect HTTP → HTTPS via 301. |
| HSTS | `Strict-Transport-Security: max-age=15552000; includeSubDomains` after testing. |
| Canonical host | Pick `www.` or apex, prefer apex/non-www; 301 the other. |
| 404s | Return real HTTP 404 status, not 200 with a "not found" body (a "soft 404"). |
| 410s | Use 410 Gone for permanently removed URLs you don't want re-indexed. |
| 301 vs 302 | 301 for permanent moves; 302 for temporary. Crawlers treat 301 as the new canonical. |
| Redirect chains | Avoid `A → B → C`; collapse to `A → C`. Each hop loses crawl budget. |
| `Cache-Control` | Aggressive on hashed assets (`max-age=31536000, immutable`); short on HTML (`no-cache` or short max-age). |
| `Content-Type` | Correct MIME types so Googlebot processes assets. |
| `Vary: Accept-Encoding` | When serving compressed responses. |
| `X-Robots-Tag` | HTTP-header version of `<meta name="robots">`. Useful for non-HTML resources (PDFs). |

---

## 10. Performance / Core Web Vitals

Google ranks Core Web Vitals (CWV) as a soft signal. Big LCP
regressions tank rankings.

| Metric | Threshold (Good) | Common causes of failures |
|---|---|---|
| **LCP** (Largest Contentful Paint) | ≤ 2.5s | Hero image not optimized; render-blocking CSS/JS; slow TTFB. |
| **CLS** (Cumulative Layout Shift) | ≤ 0.1 | Images without dimensions; web font swap; ads/embeds inserted late. |
| **INP** (Interaction to Next Paint) | ≤ 200ms | Heavy JS handlers; long tasks; main-thread thrash. |
| **TTFB** (Time to First Byte) | ≤ 0.8s | Slow server / DB; cold lambda; lack of CDN. |
| **FCP** (First Contentful Paint) | ≤ 1.8s | Render-blocking CSS in `<head>`; slow font load. |

### Best practices

- Inline above-the-fold critical CSS; defer the rest.
- `defer` or `async` on every `<script>` in `<head>` (default
  parser-blocks).
- Preload only the LCP image and the brand font (one of each, max).
- `font-display: swap` on web fonts; ship a same-metric system fallback.
- Compress with Brotli (or at minimum gzip).
- Serve via CDN / edge cache.
- Avoid client-side rendering of above-the-fold content for SEO routes.

---

## 11. Accessibility (overlaps strongly with SEO)

A page that fails Lighthouse a11y tends to fail SEO heuristics too,
because Google's renderer cares about the same signals.

- `<html lang>` matches content.
- All `<img>` have `alt` (empty for decorative).
- All `<button>` and `<a>` have an accessible name (text content,
  `aria-label`, or `aria-labelledby`).
- Form inputs have labels.
- Focus order matches visual order; visible focus rings.
- Color contrast ≥ 4.5:1 for body text.
- No keyboard traps; ESC closes modals.
- ARIA: prefer native HTML (`<button>`, `<nav>`); use ARIA only when
  no element exists.

---

## 12. Internal linking

- Every important page should be reachable in ≤3 clicks from the
  homepage.
- Anchor text is descriptive (avoid "click here", "read more").
- Use breadcrumbs (with `BreadcrumbList` JSON-LD).
- Don't bury the same destination behind 50 internal links from one
  page — Google deduplicates link equity per source page.

### `rel` attributes for outbound links

| Value | Use when |
|---|---|
| `nofollow` | The link is to a page you don't want to vouch for (UGC, untrusted). |
| `sponsored` | The link is paid (ad, affiliate). |
| `ugc` | User-generated content link (forum post, comment). |
| `noopener noreferrer` | Always on `target="_blank"` for security. Doesn't affect SEO directly but is best practice. |

---

## 13. Content quality (the part Google actually scores hardest on)

- One topic per page; satisfy the intent.
- Original content, not scraped or rewritten boilerplate.
- E-E-A-T (Experience, Expertise, Authoritativeness, Trust) — show
  the author, their bio, credentials, dates.
- Update old content; add `dateModified` / `article:modified_time`.
- Link to authoritative sources where claims need backing.
- Avoid keyword stuffing; write naturally for the reader.
- Aim for unique, substantive content (no thin pages — 100 words and
  a stock image will not rank).

---

## 14. PWA / mobile

- Responsive design (mobile-first); test at 320px, 768px, 1280px.
- Touch targets ≥ 48×48 CSS px.
- No horizontal scroll on mobile widths.
- Manifest with `name`, `short_name`, `start_url`, `display`,
  `theme_color`, `icons` (192, 512 minimum, 512 maskable).
- Service worker that doesn't break SEO crawls (return network for
  bots, cache for users).
- `<meta name="apple-mobile-web-app-capable" content="yes">` for
  iOS-Add-to-Home support.

---

## 15. International (hreflang)

If the site serves multiple languages or regions:

```html
<link rel="alternate" hreflang="en" href="https://example.com/page">
<link rel="alternate" hreflang="es" href="https://example.com/es/page">
<link rel="alternate" hreflang="x-default" href="https://example.com/page">
```

Rules:

- Every variant must list every other variant (and itself).
- Use `xx-YY` for region-specific variants (`es-MX`, `en-GB`).
- `x-default` points at the language-picker / default URL.
- Same content can also be declared via XML sitemap `<xhtml:link>`
  entries — easier to keep in sync at scale.

---

## 16. Verification & monitoring

- Verify the site in **Google Search Console**, **Bing Webmaster
  Tools**, and (optionally) **Yandex Webmaster** / **Naver**.
- Submit the sitemap from each.
- Monitor coverage, CWV, mobile usability, manual actions in Search
  Console weekly.
- Track impressions/clicks for each top page; flag big drops.

---

## 17. Common SEO bugs to grep for

- `<title>` is the same on every page (or empty)
- `<meta name="description">` missing or duplicated
- `<link rel="canonical">` points at the wrong URL (e.g. always the
  homepage, or always the no-trailing-slash version of a trailing-slash
  page)
- Multiple `<h1>` per page
- `<img>` with no `alt`
- `<a href="#">` placeholder links
- `noindex` left on after staging
- `disallow: /` left in `robots.txt`
- 200 responses for missing pages
- Mixed content (HTTP assets on an HTTPS page)
- Soft 404s (a 200-status "Not found" page)

---

## Implementation map (where each piece lives)

For SiteSurge specifically — when you go through the checklist
against a real page, this is where to look.

| Concern | Component / File |
|---|---|
| Site-wide `<head>` baseline (title, og:site_name, og:locale) | `frontend/src/components/layout/Layout.tsx` |
| Per-page meta (title / description / og: / twitter:) | `frontend/src/components/common/seo/SeoHead.tsx` |
| JSON-LD per page | `frontend/src/components/common/seo/JsonLd.tsx` |
| Schema builders (Organization, BreadcrumbList, etc.) | `frontend/src/utils/schema.ts` |
| Server-side rendered body (so crawlers see content before the SPA mounts) | `backend/src/services/ssr/bodyBuilder.ts` |
| SSR head meta (server-injected, no JS required) | `backend/src/services/ssr/metaBuilder.ts` |
| SSR routing + cache | `backend/src/services/ssr/routes.ts` |
| RSS feed | `backend/src/routes/feed.ts` |
| Sitemap.xml | (TODO — not yet implemented in this codebase) |
| `robots.txt` | `frontend/public/robots.txt` |
| Canonical host / HTTPS / redirect rules | nginx conf / deploy scripts |
| Public site Header (semantic `<header>` + `<nav>`) | `frontend/src/components/layout/Header.tsx` |
| Public site Footer | `frontend/src/components/layout/Footer.tsx` |
| Image rendering (alt, width/height, lazy) | `frontend/src/components/blocks/BlockRenderer.tsx` (ImageBlock) |
| Public renderers per block type | `frontend/src/components/blocks/BlockRenderer.tsx` |

### Auditing a single page in this codebase

When auditing `/posts/<slug>` for example:

1. Open `frontend/src/pages/Post.tsx` and check the `<SeoHead>`
   props passed.
2. Open `backend/src/services/ssr/routes.ts` and look at the
   `resolveRouteMeta()` branch for posts — verify the SSR
   meta + body match what the SPA renders.
3. Hit `/posts/<slug>` with `curl -s | grep -E '<title|<meta|<link'`
   to see what bots actually receive.
4. Open `frontend/src/utils/schema.ts` for the JSON-LD builders the
   post page calls.
5. Open the rendered page in DevTools and step through this doc's
   [Quick audit checklist](#quick-audit-checklist).
