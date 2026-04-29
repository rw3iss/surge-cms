# RW CMS - TODO & Improvement Plan

Based on codebase review and original INIT_Prompt requirements.

## Legend
- **Priority**: 🔴 High | 🟡 Medium | 🟢 Low
- **Effort**: S (small, <1hr) | M (medium, 1-4hr) | L (large, 4-8hr) | XL (multi-day)
- **[INIT]** = Required by original project spec but missing or incomplete

---

## 1. SEO (Critical - explicitly required in INIT_Prompt)

### 1.1 🔴 [INIT] Add dynamic Open Graph & Twitter meta tags (M)
**Problem:** Pages, posts, and campaigns don't set `og:title`, `og:description`, `og:image`, `og:url`, `twitter:title`, `twitter:description`, `twitter:image`. Social sharing will show blank previews.
**Implementation:** In Post.tsx, Campaign.tsx, DynamicPage.tsx, and all public pages - add `<Meta>` tags from `@solidjs/meta` for all OG/Twitter properties using the fetched data (title, excerpt/description, featured image, canonical URL).

### 1.2 🔴 [INIT] Add sitemap.xml generation (M)
**Problem:** No sitemap exists. Search engines can't discover dynamic pages, posts, or campaigns.
**Implementation:** Add `GET /api/v1/sitemap.xml` endpoint. Query all published pages, posts, and active campaigns. Generate XML sitemap with `<lastmod>`, `<changefreq>`, `<priority>`. Add sitemap reference to robots.txt. Consider a sitemap index if content grows large.

### 1.3 🔴 [INIT] Add robots.txt (S)
**Problem:** Referenced in vite.config.ts but file doesn't exist. Search engines have no crawl directives.
**Implementation:** Create `frontend/public/robots.txt` or serve dynamically from backend. Allow all crawlers, disallow `/admin`, reference sitemap URL.

### 1.4 🔴 [INIT] Add JSON-LD structured data (M)
**Problem:** No Schema.org markup. Search engines can't understand content type (Article, Organization, etc.).
**Implementation:** Add JSON-LD `<script>` tags to: posts (Article schema with author, datePublished, image), homepage (Organization schema), campaigns (Event/FundingScheme). Use `@solidjs/meta` to inject into `<head>`.

### 1.5 🟡 [INIT] Add canonical URLs (S)
**Problem:** No canonical link tags. Duplicate content risk from query params or alternate URLs.
**Implementation:** Add `<Link rel="canonical" href="...">` to all public pages using the current route path.

### 1.6 🟡 [INIT] Consider SSR or pre-rendering for SEO (XL)
**Problem:** Pure client-side SPA means search engines must execute JavaScript. Google handles this well, but Bing/others may not. The INIT_Prompt emphasizes "all possible means for optimal SEO."
**Implementation:** Options (pick one):
- **Pre-rendering** (easiest): Use `vite-plugin-ssr` or a prerender service to generate static HTML for public pages at build time or on-demand.
- **SSR with SolidStart**: Migrate to SolidStart for server-side rendering. Larger effort but best SEO.
- **Dynamic rendering**: Use a service like Rendertron that serves pre-rendered HTML to bots.
** HOLD OFF ON SSR, for now. We will do it later. **

---

## 2. Embedded Social Media Content [INIT]

### 2.1 🔴 [INIT] Embed social media content in-site (L)
**Problem:** INIT_Prompt says "Content previews from our social media accounts where people can view our shorts without leaving the site." Currently Home.tsx shows thumbnails that link externally with `target="_blank"`.
**Implementation:**
- **YouTube**: Use YouTube IFrame embed API (`<iframe src="https://www.youtube.com/embed/{videoId}">`)
- **Instagram**: Use Instagram oEmbed API (requires Facebook app review) or Instagram embed.js
- **Facebook**: Use Facebook embedded posts SDK
- **TikTok**: Use TikTok oEmbed API for embedded player
- **Twitter/X**: Use Twitter embed widget or oEmbed
- Create a `<SocialEmbed platform={...} postId={...} />` component that renders the correct embed per platform
- Update Home.tsx social section and BlockRenderer social_feed block to use embeds instead of external links

### 2.2 🟡 Complete social_feed block in BlockRenderer (M)
**Problem:** BlockRenderer has no case for `social_feed` block type. It's a gap in the switch statement.
**Implementation:** Add `social_feed` case that renders a grid of `<SocialEmbed>` components. Pull from social_posts table filtered by platform specified in block settings.

---

## 3. Patreon Exclusive Content Gating [INIT]

### 3.1 🔴 [INIT] Implement Patreon-gated content access (L)
**Problem:** INIT_Prompt says "Allow Patreon members to view exclusive content without leaving the site." Currently users can log in via Patreon but there's no mechanism to gate page/post content by membership tier.
**Implementation:**
- Pages and posts already have `is_private` flag. Extend this to support tier-based access (e.g., add `required_tier` field or use a `required_role` enum: `public`, `member`, `patron_basic`, `patron_premium`).
- Backend: Check user's Patreon tier (from `patreon_memberships` or `users.patreon_tier`) against content requirements. Return 403 with a "Subscribe to access" message for unauthorized users.
- Frontend: Show a locked content preview with a CTA to subscribe via Patreon for gated content.
- Depends on: 3.5 (Patreon membership sync) to keep tier data current.

### 3.2 🟡 [INIT] Add Patreon content sync (M)
**Problem:** Patreon posts and exclusive content aren't pulled into the site. Members should see their Patreon-exclusive content here.
**Implementation:** Use Patreon API v2 to fetch posts from the creator's campaign. Store in `social_posts` with `platform='patreon'`. Display gated posts only to authenticated patrons with appropriate tier.

---

## 4. Shopify / Merch Store Integration [INIT]

### 4.1 🟡 [INIT] Add Shopify storefront integration (L)
**Problem:** INIT_Prompt mentions "clothing -> linked to shopify" but no Shopify integration exists anywhere.
**Implementation:**
- Option A (lightweight): Add a "Shop" page/nav link that embeds Shopify Buy Button SDK. Products display inline, checkout redirects to Shopify.
- Option B (deeper): Use Shopify Storefront API (GraphQL) to fetch products, display them natively, and handle cart/checkout via Shopify's checkout URL.
- Add `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_STOREFRONT_ACCESS_TOKEN` to backend config.
- Create frontend `/shop` page with product grid, cart functionality.
- Add "Shop" to navigation.
** For now, implement Option A (basic). We will break it out later. **

---

## 5. CRM Integration [INIT]
** SKIP THIS SECTION #5 - DO NOT DO **
### 5.1 🟡 [INIT] Research and integrate CRM (Groundhogg/GiveButter) (L)
**Problem:** INIT_Prompt mentions "Seamless form integration that we could connect with a CRM like Groundhogg and GiveButter so that we can stay on top of outreach."
**Implementation:**
- **Groundhogg**: WordPress-based CRM. If not using WordPress, integration would be via their REST API or webhooks. Add a webhook dispatcher that fires on form submissions, sending data to Groundhogg's contact/funnel endpoints.
- **GiveButter**: Donation-focused platform. Could replace or supplement Stripe for donations. Has embeddable forms and an API. Evaluate whether to use GiveButter for donation processing instead of raw Stripe.
- **Practical approach**: Add a generic webhook/integration system. When forms are submitted or donations made, fire configurable webhooks to external CRMs. Admin settings page gets a "CRM Integrations" section to configure endpoint URLs and API keys.
** SKIP SECRTION 5 - DO NOT DO **

---

## 6. Content & About Page [INIT]

### 6.1 🟡 [INIT] Populate About page from existing site content (S)
**Problem:** INIT_Prompt says "Pull content from the existing rw website: https://ryanweiss.net/" for the About page. The About page exists as a CMS page but likely has placeholder content.
**Implementation:** Scrape or manually copy the about content, team info, and mission statement from the existing ryanweiss.net site. Create the About page with appropriate blocks (hero, rich_text with team bios, mission statement).
** For now you can try to scrape the content, if you can, and add it as blobs to the page, or actual blocks in the backend 'About' page entry (add a page for it). If you can't find or obtain the content, just add stub content for now. **

---

## 7. Code Quality & Architecture

### 7.1 🔴 Extract SQL queries from routes into a data access layer (L)
**Problem:** All SQL queries are inline in route handlers, mixing data access with HTTP concerns. This makes queries hard to test, reuse, or refactor.
**Implementation:** Create `backend/src/repositories/` with files per entity (pages.repo.ts, posts.repo.ts, etc.). Each exports typed query functions. Routes call repo functions instead of `db.query()` directly.
** Separate the architecture using best S.O.L.I.D. programming principles (ie. single-responibility, object-oriented, layer-based, extensible and optimal). Service layers should exist for endpoints, along with matching repository layers. All services should utilize each other independently, or with a single reponsibility. Separate and extract re-usable or shared code to common files or utilities, and keep code well organized logically according to function or module. **

### 7.2 🔴 Centralize snake_case → camelCase mapping (M)
**Problem:** Every route handler manually maps DB column names (snake_case) to API response fields (camelCase). Lots of repetitive `toCampaign()`, `toDonation()` helper functions scattered across routes.
**Implementation:** Create a generic `mapRow<T>(row, mapping)` utility or use a library like `camelcase-keys`. Apply it at the repository layer so routes always receive camelCase objects.

### 7.3 🟡 Add request validation with Zod schemas (M)
**Problem:** Route handlers do ad-hoc validation. Some fields are checked, others aren't. No shared validation between frontend and backend.
**Implementation:** Define Zod schemas in `shared/` for each API request body. Use express middleware to validate `req.body` against schemas before route handlers execute.

### 7.4 🟡 Add TypeScript strict mode to backend (M)
**Problem:** Backend uses `any` types in many places (Express request handlers, DB query results).
**Implementation:** Enable stricter tsconfig options. Type DB query results using repository return types. Use `AuthenticatedRequest` consistently.

### 7.5 🟢 Add API response envelope consistency (S)
**Problem:** Some endpoints return raw data, others wrap in `{ success, data }`. Not consistent with the `ApiResponse<T>` type defined in shared.
**Implementation:** Create a `sendSuccess(res, data, meta?)` helper that wraps all responses in the standard `ApiResponse` format.

---

## 8. Security

### 8.1 🔴 Add CSRF protection (M)
**Problem:** Cookie-based auth without CSRF tokens. POST/PUT/DELETE requests from malicious sites could be accepted.
**Implementation:** Add `csurf` middleware or implement double-submit cookie pattern. Frontend sends CSRF token in header with state-changing requests.

### 8.2 🔴 Add input sanitization on HTML content (M)
**Problem:** `sanitizeHtml()` in shared utils only strips `<script>`, `<style>`, and event handlers. Rich text and HTML blocks could still contain XSS vectors.
**Implementation:** Replace custom sanitizer with a proper library (DOMPurify on server via jsdom, or sanitize-html). Apply to all user-submitted HTML content before storage.

### 8.3 🟡 Rate limit login attempts specifically (S)
**Problem:** General rate limiter applies to all routes. Login endpoint should have stricter limits to prevent brute force.
**Implementation:** Add a separate rate limiter on `/auth/login` (e.g., 5 attempts per 15 minutes per IP).

### 8.4 🟡 Add Stripe webhook handler (L)
**Problem:** Payment intents are created and donations are marked "pending", but there's no webhook handler to confirm/fail them based on Stripe events.
**Implementation:** Add POST `/api/v1/payments/webhook` endpoint. Handle `payment_intent.succeeded`, `payment_intent.payment_failed`, `customer.subscription.updated/deleted` events. Update donation status and subscription records accordingly.

### 8.5 🟡 Validate file upload MIME types server-side (S)
**Problem:** File uploads check extension/MIME from the client-provided header, but don't verify actual file content.
**Implementation:** Use `file-type` library to detect actual MIME type from file buffer. Reject mismatches.

---

## 9. Features - Backend

### 9.1 🔴 Complete subscription/payment webhook flow (L)
**Problem:** Subscription plans, subscriptions, and transactions tables exist. Stripe subscription creation exists. But webhook handling, plan management endpoints, and subscription lifecycle are incomplete.
**Implementation:**
- Add admin CRUD for subscription_plans
- Implement Stripe webhook handler (see 8.4)
- Handle subscription lifecycle events (renewal success/failure, cancellation)
- Add subscription status check middleware for gated content
- Add `/api/v1/payments/plans` GET endpoint (frontend Subscribe page already calls this)

### 9.2 🔴 [INIT] Add Patreon membership sync (M)
**Problem:** `patreon_memberships` table exists but is never populated after initial OAuth. Patreon tier changes aren't tracked. The INIT_Prompt requires Patreon as the primary user system.
**Implementation:** Add a Patreon webhook receiver or periodic sync job that updates `patreon_memberships` and `users.patreon_tier`. Use Patreon API v2 campaign members endpoint.

### 9.3 🟡 Add audit logging (M)
**Problem:** `audit_log` table exists in schema but is never written to by any route or service.
**Implementation:** Create `auditLog(userId, action, entityType, entityId, oldValues, newValues, req)` service function. Call from admin mutation endpoints.

### 9.4 🟡 Add post content block reordering endpoint (S)
**Problem:** Posts support content blocks but there's no reorder endpoint (pages have `/blocks/reorder` but posts don't).
**Implementation:** Add `PUT /api/v1/posts/:postId/blocks/reorder` mirroring the pages implementation.

### 9.5 🟡 Add email reply functionality for messages (M)
**Problem:** Contact messages can only be marked as "replied" - there's no actual reply mechanism.
**Implementation:** Add `POST /api/v1/messages/:id/reply` that sends an email via the email service and marks the message as replied.

### 9.6 🟡 Add social media auto-publish (L)
**Problem:** Social connections have `auto_publish` flag and settings but no publishing logic exists.
**Implementation:** Implement post-creation hooks that publish to connected platforms.

### 9.7 🟢 Add CSV export for form submissions (S)
**Problem:** README mentions CSV export for form submissions but no endpoint exists.
**Implementation:** Add `GET /api/v1/forms/:id/submissions/export` that returns CSV.

### 9.8 🟢 Add image optimization pipeline (M)
**Problem:** Sharp is used for thumbnails but uploaded images are stored at original size.
**Implementation:** Generate multiple sizes (thumbnail, medium, large) on upload. Store URLs in media record.

---

## 10. Features - Frontend

### 10.1 🔴 [INIT] Complete BlockRenderer for all block types (M)
**Problem:** BlockRenderer has basic implementations but some blocks are incomplete (form block is a placeholder, gallery block missing, social_feed block missing entirely from switch).
**Implementation:** Implement each block type fully:
- **Form block**: Embed the Form page component inline
- **Gallery block**: Grid/carousel of media items
- **Social feed block**: Embedded social posts via `<SocialEmbed>` (see 2.1)
- **Campaign block**: Inline campaign card with progress bar and donate button

### 10.2 🔴 [INIT] Add rich text editor for pages and posts (L)
**Problem:** Page blocks use raw HTML editing. Posts use a textarea. No WYSIWYG editor. INIT_Prompt specifies "rich text editor to edit the content for that block, as well as upload media."
**Implementation:** Integrate TipTap or Lexical editor. Replace textarea in PostEditor and rich_text block editing. Support headings, bold/italic, links, inline images from media library, lists, blockquotes.

### 10.3 🔴 [INIT] Add page block editor with full drag-and-drop (L)
**Problem:** PageEditor shows existing blocks but editing is minimal. INIT_Prompt requires blocks that "can be added, edited, hidden/disabled, or sorted" with media upload.
**Implementation:** Port the PostEditor block system to PageEditor. Adapt for page block types. Add block visibility toggle (hide/show). Ensure media upload works inline in all block types.

### 10.4 🟡 [INIT] Add form results visualization (M)
**Problem:** INIT_Prompt says "If the forms allows showing the results, then on the frontend client users will be able to see the results." Backend has results aggregation but frontend doesn't render it.
**Implementation:** Add results visualization on the Form page when `showResults` is true. Show bar charts for choice questions, stats for numbers, sample text responses.

### 10.5 🟡 Add proper error boundaries and loading states (M)
**Problem:** Some pages show raw error text or nothing on failure. Loading states are inconsistent.
**Implementation:** Create `<ErrorBoundary>` wrapper with retry button. Create `<LoadingSpinner>` and `<Skeleton>` components.

### 10.6 🟡 Add toast notifications (S)
**Problem:** Success/error feedback is done with inline text that's easy to miss.
**Implementation:** Create a toast notification context/provider for all mutations.

### 10.7 🟡 Add admin media picker to page block editors (S)
**Problem:** MediaPickerModal exists and works in PostEditor blocks. Page blocks don't have it wired up.
**Implementation:** Import and use MediaPickerModal in page block editors.

### 10.8 🟡 [INIT] Ensure fully responsive design (M)
**Problem:** INIT_Prompt says "absolutely responsive, so that it looks perfect on all environments: desktop, mobile, and tablets." Admin layout has a fixed sidebar. Tables don't adapt to mobile.
**Implementation:** Mobile-responsive sidebar (collapsible hamburger). Scrollable tables. Stacked form fields on small screens. Test and fix all public pages on mobile viewports.

### 10.9 🟢 Add keyboard shortcuts in admin (S)
**Implementation:** Ctrl+S to save, Escape to cancel, arrow keys for block navigation.

### 10.10 🟢 Add dark mode toggle (M)
**Implementation:** CSS custom properties, localStorage persistence, prefers-color-scheme default.

---

## 11. Testing

### 11.1 🔴 Add backend API tests (XL)
**Problem:** No tests exist. `test` script in package.json but no test files.
**Implementation:** Set up vitest. Create test database. Write integration tests for each route group. Mock external services.

### 11.2 🟡 Add frontend component tests (L)
**Implementation:** Unit tests for API service, auth store, utilities. Component tests for DonationForm, BlockRenderer, ContentBlock.

### 11.3 🟢 Add E2E tests (XL)
**Implementation:** Playwright tests for critical flows: login, create/edit page, submit form, donate.

---

## 12. DevOps & Infrastructure

### 12.1 🔴 Add database migration runner (M)
**Problem:** `migrate.ts` runs full `schema.sql` every time. No tracking of applied migrations.
**Implementation:** Create `schema_migrations` table. Runner checks which have been applied, runs new ones in order.

### 12.2 🟡 Add Docker setup (M)
**Implementation:** `docker-compose.yml` with postgres, redis, and app services. `Dockerfile` for the Node app.

### 12.3 🟡 Add CI/CD pipeline (M)
**Implementation:** GitHub Actions: lint → type-check → test → build → deploy.

### 12.4 🟢 Add structured logging (S)
**Problem:** Routes use `console.error` instead of Winston logger.
**Implementation:** Replace all console calls with logger. Add request ID tracking.

### 12.5 🟢 Add health check for external services (S)
**Implementation:** Check Stripe, email, storage in detailed health endpoint.

---

## 13. Performance

### 13.1 🟡 Optimize cache invalidation (S)
**Problem:** `cache.delPattern()` uses Redis `KEYS` command which scans all keys.
**Implementation:** Switch to Redis `SCAN` with cursor-based iteration.

### 13.2 🟡 Add database connection pooling tuning (S)
**Implementation:** Connection/idle/statement timeouts. Pool exhaustion monitoring.

### 13.3 🟢 Add lazy loading for media in listings (S)
**Implementation:** `loading="lazy"` on images. Intersection observer for infinite scroll.

### 13.4 🟢 Add CDN configuration for static assets (S)
**Implementation:** Cache-control headers. Document CDN setup (CloudFront/Cloudflare).

---

## 14. UX Improvements

### 14.1 🟡 Add drag-and-drop file upload (S)
**Implementation:** Dropzone UI on Media page. Upload progress indicator.

### 14.2 🟡 Add unsaved changes warning (S)
**Implementation:** Track dirty state. `beforeunload` + router `beforeLeave` guard.

### 14.3 🟡 Add inline editing for simple fields (M)
**Implementation:** Click-to-edit on table cells for title, status, order.

### 14.4 🟢 Add bulk actions in admin lists (M)
**Implementation:** Checkbox selection. Bulk toolbar (delete, change status, export).

### 14.5 🟢 Add admin search/filter persistence (S)
**Implementation:** Store filter state in URL query params.

---

## Recommended Priority Order

### Phase 1 - SEO & Foundation (do first - SEO explicitly critical in spec)
1. 1.1 - Dynamic OG/Twitter meta tags (SEO)
2. 1.2 - Sitemap.xml generation (SEO)
3. 1.3 - robots.txt (SEO)
4. 1.4 - JSON-LD structured data (SEO)
5. 12.1 - Database migration runner (safe schema changes)
6. 8.4 - Stripe webhook handler (donations stuck in "pending")
7. 9.1 - Complete subscription flow (monetization)

### Phase 2 - Core INIT_Prompt Requirements
8. 2.1 - Embedded social media content (key differentiator)
9. 3.1 - Patreon exclusive content gating
10. 9.2 - Patreon membership sync
11. 10.2 - Rich text editor (core admin experience)
12. 10.3 - Page block editor (core admin feature)
13. 10.1 - Complete BlockRenderer (public site rendering)
14. 4.1 - Shopify storefront integration

### Phase 3 - Quality & Security
15. 8.1 - CSRF protection
16. 8.2 - HTML sanitization
17. 7.1 - Extract SQL to repositories
18. 7.2 - Centralize field mapping
19. 10.8 - Fully responsive design
20. 11.1 - Backend API tests

### Phase 4 - Extended Features
21. 5.1 - CRM integration (Groundhogg/GiveButter)
22. 1.6 - SSR or pre-rendering
23. 10.4 - Form results visualization
24. 9.5 - Email reply for messages
25. 6.1 - Populate About page content
26. Everything else by priority

### Phase 5 - Polish
27. Toast notifications, error boundaries, loading states
28. Audit logging
29. Docker, CI/CD
30. Dark mode, keyboard shortcuts, bulk actions
