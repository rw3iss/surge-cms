# Social Hub + X/Twitter Free-Path Feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give operators a reliable, cost-free way to display their X/Twitter (and other providers') recent posts, by capturing post IDs at creation time (compose-in-CMS) or manually (paste a URL), caching them locally, and rendering them server-side — with an optional paid-API path for fully-automatic discovery. Surface all of it under a new **Social** admin section that also absorbs the provider **Connections** configuration and adds a one-interface cross-poster.

**Architecture:** Capture-first, render-locally. We never depend on scraping or the paywalled read-timeline endpoint for the default path. Post IDs enter `social_posts` three ways: (A) **POSSE** — composed in the CMS and published to X via the *free write* API, which returns the new tweet ID; (B) **manual** — an editor pastes a tweet URL; (C) **paid sync** — the existing `fetchTwitterPosts` bearer path, now opt-in per connection. Rendering hydrates each stored X post server-side via the `cdn.syndication.twimg.com/tweet-result` JSON endpoint (same source `react-tweet` uses) into our existing `SocialEmbed` card, cached in Redis. The admin gets a tabbed **Social** hub: **Posts** (manage the local cache), **Compose** (cross-post to one/many providers), **Configuration** (the relocated Connections UI + per-provider utilities).

**Tech Stack:** Express + PostgreSQL (raw `pg`) + Redis backend; SolidJS admin; `@sitesurge/types` shared DTOs; `@sitesurge/client` SDK; vitest (api tests). OAuth 1.0a user-context (for X write) via a minimal HMAC-SHA1 signer (no new dep) or `oauth-1.0a` if approved.

---

## Scope note — milestones are independently shippable

This spec spans several subsystems. Implement in milestone order; **each milestone leaves the app working and testable.** If you only ship Milestone 1+2 you already have a working, free X feed with manual capture.

- **M1 — Data model + capture + render (the free feed).** Highest value, no OAuth. Ship first.
- **M2 — Social admin hub + nav + Posts tab.**
- **M3 — Relocate Connections → Configuration tab + per-provider utilities.**
- **M4 — Compose & cross-post (POSSE).** Heaviest: X write requires user-context OAuth. Text-only first; media is a follow-up.
- **M5 — Paid API path toggle + docs.**

**Decomposition advice:** M4 (OAuth write + cross-post) is large enough to be its own plan. If the team wants to move fast on the feed, land M1–M3 and M5 first, then brainstorm M4 separately. This document keeps M4 at design + task granularity; expand it into its own plan before executing if media-upload is in scope.

---

## File Structure

### Backend (`packages/api/`)
- **Create** `src/db/migrations/070_social_posts_capture.sql` — add `source`, `post_url`, `created_by`, `is_hidden`, `sort_order` to `social_posts`; relax `NOT NULL` expectations for manual rows.
- **Create** `src/services/social/twitterHydrate.ts` — `deriveTweetToken(id)`, `fetchTweetById(id)`, `mapTweetResultToFetchedPost(json)`, `parseTweetUrl(url)`. Pure + network fns, unit-tested.
- **Create** `src/services/social/twitterHydrate.test.ts` — unit tests for token derivation, URL parsing, JSON mapping.
- **Create** `src/services/social/embed.ts` — `resolveEmbed(post)` → `{ mode: 'card'|'oembed', html?, card? }`, Redis-cached. oEmbed via `publish.twitter.com/oembed` as the alt renderer.
- **Create** `src/services/social/publish.ts` (M4) — `publishPost(input, ctx)`; provider-specific posting incl. X free-tier `POST /2/tweets`.
- **Create** `src/services/social/twitterOAuth.ts` (M4) — OAuth 1.0a user-context signer for X write.
- **Modify** `src/services/social.ts` — add `addManualPost`, `setPostVisibility`, `reorderPost`; make Twitter sync respect a `mode` setting; extract shared upsert helper.
- **Modify** `src/routes/social.ts` — new routes: `POST /posts/manual`, `PATCH /posts/:id`, `GET /posts/:id/embed`, `POST /publish` (M4).
- **Modify** `src/services/socialCrons.ts` — only register the Twitter read-sync cron when `settings.twitterMode === 'api'`.
- **No move needed** for `src/routes/connections.ts` — it stays at `/connections`; only the *admin UI* relocates.

### Shared (`packages/shared/`)
- **Modify** `src/api/routes/social.ts` — DTOs: `SocialManualPostBody`, `SocialManualPostResponse`, `SocialPostPatchBody`, `SocialEmbedResponse`, `SocialPublishBody`, `SocialPublishResponse`.
- **Modify** `src/types/content.ts` (or wherever `SocialPost` lives) — add `source`, `postUrl`, `isHidden`, `sortOrder` to `SocialPost`.

### Client SDK (`packages/cms-client/`)
- **Modify** `src/modules/social.ts` — `addManualPost`, `patchPost`, `getEmbed`, `publish`.

### Admin (`packages/cms/`)
- **Create** `src/pages/admin/social/SocialHub.tsx` — tabbed shell (Posts | Compose | Configuration).
- **Create** `src/pages/admin/social/SocialPostsPanel.tsx` — the local-cache manager (list, add-by-URL, hide/show, reorder, delete, per-platform filter).
- **Create** `src/pages/admin/social/SocialComposePanel.tsx` (M4) — compose + provider multi-select + publish.
- **Create** `src/components/admin/social/ConnectionsPanel.tsx` — extracted from `Settings.tsx` (Configuration tab reuses it).
- **Create** `src/pages/admin/social/styles/_social-hub.scss` — hub styles; register in `AdminLayout.scss`.
- **Modify** `src/pages/admin/AdminLayout.tsx` — add `{ path: '/admin/social', label: 'Social', icon: 'social', adminOnly: true }` to `NAV_ITEMS`; add a `social` icon to `ICONS`.
- **Modify** `src/App.tsx` — routes `/admin/social`, `/admin/social/compose`, `/admin/social/configuration`.
- **Modify** `src/pages/admin/Settings.tsx` — remove the Connections tab; leave a one-line pointer to `/admin/social`.

### Docs
- **Create** `docs/SOCIAL.md` — the three capture paths, cost model, X token caveat, per-provider setup.
- **Modify** `CLAUDE.md` — update the **Social connections** capability bullet + admin nav list.

---

## Data contracts (define once, referenced by tasks)

`social_posts` after migration 070:

```sql
-- source of the row: how the post entered the cache
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'sync';
  -- 'sync'   = pulled from a provider read-API (paid path / IG / FB / YT)
  -- 'manual' = an editor pasted the post URL
  -- 'posse'  = published from the CMS compose flow
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS post_url TEXT;          -- canonical permalink (X tweet URL)
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE social_posts ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_social_posts_hidden ON social_posts(is_hidden);
```

`SocialPost` type gains: `source: 'sync'|'manual'|'posse'`, `postUrl: string | null`, `isHidden: boolean`, `sortOrder: number`.

X connection `settings` JSONB gains: `{ twitterMode: 'free' | 'api' }` (default `'free'`). Write creds (M4) live in `credentials`: `{ apiKey, apiSecret, accessToken, accessSecret }` (OAuth 1.0a user context) — masked by the existing `sanitizeCredentials`.

`tweet-result` token derivation (the exact `react-tweet` algorithm):

```ts
export function deriveTweetToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI)
    .toString(6 ** 2)          // base 36
    .replace(/(0+|\.)/g, '');
}
// URL: https://cdn.syndication.twimg.com/tweet-result?id=<id>&token=<token>&lang=en
```

`parseTweetUrl` accepts `https://x.com/<user>/status/<id>` and `twitter.com` variants (with/without query), returns `{ id, url }` or `null`:

```ts
const RE = /(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/i;
```

---

## Milestone 1 — Data model + capture + render (the free feed)

### Task 1.1: Migration 070 — `social_posts` capture columns

**Files:**
- Create: `packages/api/src/db/migrations/070_social_posts_capture.sql`

- [ ] **Step 1:** Write the migration with the exact SQL from the Data contracts section above (all `ADD COLUMN IF NOT EXISTS` + the index). No `@feature` header — `social` is core.
- [ ] **Step 2:** Run `npm run db:migrate -w packages/api`. Expected: migration 070 applied, no error, re-run is idempotent.
- [ ] **Step 3:** Commit.

### Task 1.2: `SocialPost` type gains capture fields

**Files:**
- Modify: `packages/shared/src/types/content.ts` (the `SocialPost` interface)

- [ ] **Step 1:** Add `source: 'sync' | 'manual' | 'posse'`, `postUrl: string | null`, `isHidden: boolean`, `sortOrder: number` to `SocialPost`.
- [ ] **Step 2:** `npm run build -w packages/shared`. Expected: compiles.
- [ ] **Step 3:** Update `getSocialPosts` row-mapping in `packages/api/src/services/social.ts` to map the new columns (`source: row.source`, `postUrl: row.post_url`, `isHidden: row.is_hidden`, `sortOrder: row.sort_order`). Expected: `tsc` clean.
- [ ] **Step 4:** Commit.

### Task 1.3: Twitter hydration unit (token, URL parse, JSON map) — TDD

**Files:**
- Create: `packages/api/src/services/social/twitterHydrate.ts`
- Test: `packages/api/src/services/social/twitterHydrate.test.ts`

- [ ] **Step 1 — failing test:** Write tests:

```ts
import { describe, it, expect } from 'vitest';
import { deriveTweetToken, parseTweetUrl, mapTweetResultToFetchedPost } from './twitterHydrate';

describe('deriveTweetToken', () => {
  it('is deterministic and strips zeros/dots', () => {
    const t = deriveTweetToken('1234567890123456789');
    expect(t).toMatch(/^[0-9a-z]+$/);
    expect(deriveTweetToken('1234567890123456789')).toBe(t);
  });
});

describe('parseTweetUrl', () => {
  it('extracts id from x.com and twitter.com', () => {
    expect(parseTweetUrl('https://x.com/foo/status/1799000000000000001')?.id).toBe('1799000000000000001');
    expect(parseTweetUrl('twitter.com/bar/status/42?s=20')?.id).toBe('42');
  });
  it('returns null for non-status URLs', () => {
    expect(parseTweetUrl('https://x.com/foo')).toBeNull();
  });
});

describe('mapTweetResultToFetchedPost', () => {
  it('maps text, author, media, metrics', () => {
    const json = {
      id_str: '99', text: 'hello',
      user: { name: 'Foo', screen_name: 'foo', profile_image_url_https: 'https://pbs.twimg.com/a.jpg' },
      created_at: 'Wed Jun 05 12:00:00 +0000 2024',
      favorite_count: 3, conversation_count: 1,
      mediaDetails: [{ media_url_https: 'https://pbs.twimg.com/media/x.jpg', type: 'photo' }],
    };
    const p = mapTweetResultToFetchedPost(json);
    expect(p.id).toBe('99');
    expect(p.content).toBe('hello');
    expect(p.authorName).toBe('Foo');
    expect(p.thumbnailUrl).toContain('pbs.twimg.com');
    expect(p.likes).toBe(3);
  });
});
```

- [ ] **Step 2:** Run `npm test -w packages/api -- twitterHydrate`. Expected: FAIL (module not found).
- [ ] **Step 3 — implement:** Write `twitterHydrate.ts`:
  - `deriveTweetToken(id)` per the Data contracts algorithm.
  - `parseTweetUrl(url)` using `RE`, returns `{ id, url: normalizedTweetUrl }`.
  - `mapTweetResultToFetchedPost(json)` → the existing `FetchedPost` shape (`id`, `content` = `json.text`, `authorName` = `json.user?.name`, `authorAvatar` = `profile_image_url_https`, `thumbnailUrl` = first `mediaDetails[].media_url_https`, `mediaUrl` = the tweet permalink, `likes` = `favorite_count`, `comments` = `conversation_count`, `publishedAt` = `new Date(json.created_at)`, `rawData` = json).
  - `async fetchTweetById(id)`: `fetch(cdn.syndication.twimg.com/tweet-result?id=&token=&lang=en)`; on non-OK or JSON error return `null` (never throw — degrade gracefully); map via `mapTweetResultToFetchedPost`.
  - Reuse the `FetchedPost` interface by exporting it from `social.ts` or moving it to a shared `social/types.ts` (do the move if cleaner; update imports).
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 1.4: `addManualPost` service + upsert reuse

**Files:**
- Modify: `packages/api/src/services/social.ts`
- Test: `packages/api/src/services/social/addManualPost.test.ts` (mock `query` + `fetchTweetById`)

- [ ] **Step 1 — extract:** Pull the `INSERT ... ON CONFLICT (platform, external_id) DO UPDATE ...` block in `syncSocialPosts` into a private `upsertSocialPost(platform, post, opts: { source, postUrl?, createdBy? })` that also writes `source`, `post_url`, `created_by`. Have `syncSocialPosts` call it with `source: 'sync'`. Expected: existing sync behavior unchanged (`tsc` clean).
- [ ] **Step 2 — failing test:** `addManualPost({ url, createdBy }, ctx)`:
  - parse the URL (currently X-only; unknown host → `ValidationError`),
  - `fetchTweetById(id)` → if null, still insert a minimal row (`content: null`, `postUrl: url`) so the editor's paste isn't lost; else hydrate,
  - mirror media via existing `mirrorRemoteMedia` (pbs.twimg.com is stable, so this is a no-op passthrough — fine),
  - `upsertSocialPost('twitter', post, { source: 'manual', postUrl, createdBy })`,
  - return the stored `SocialPost`.
  Test asserts: valid X URL → inserts with `source='manual'`; junk URL → throws `ValidationError`.
- [ ] **Step 3:** Run test → FAIL, then implement, then PASS.
- [ ] **Step 4:** Commit.

### Task 1.5: `setPostVisibility` + `reorderPost` + filtered read

**Files:**
- Modify: `packages/api/src/services/social.ts`

- [ ] **Step 1:** Add `setPostVisibility(id, isHidden)` (`UPDATE social_posts SET is_hidden=$2 WHERE id=$1`) and `reorderPost(id, sortOrder)`.
- [ ] **Step 2:** Update `getSocialPosts` + the public feed read to exclude `is_hidden = true` for non-admin callers, and order by `sort_order, published_at DESC`. Keep an `includeHidden` flag for admin listings.
- [ ] **Step 3:** `npm test -w packages/api`. Expected: green.
- [ ] **Step 4:** Commit.

### Task 1.6: `resolveEmbed` renderer (card + oEmbed) with Redis cache

**Files:**
- Create: `packages/api/src/services/social/embed.ts`
- Modify: `packages/api/src/services/cache.ts` — add `CACHE_KEYS.socialEmbed(id)` + `invalidateSocialEmbed(id)` (per the cache-key contract; never call `cache.del` outside `cache.ts`).

- [ ] **Step 1:** `resolveEmbed(post)`:
  - if the post already has hydrated `content`, return `{ mode: 'card', card: post }` (the public `SocialEmbed` already renders cards — zero new client work).
  - else (minimal manual row) call `fetchTweetById(externalId)`; on success cache + return card; on failure fall back to `{ mode: 'oembed', html }` from `publish.twitter.com/oembed?url=<post_url>&omit_script=1` (sanitize with existing `sanitize.ts`), cached under `socialEmbed(id)`.
- [ ] **Step 2:** Guard test `services/cache-contract.test.ts` must still pass (no raw `cache.del`). Run `npm test -w packages/api`.
- [ ] **Step 3:** Commit.

### Task 1.7: Routes — manual add, patch, embed

**Files:**
- Modify: `packages/api/src/routes/social.ts`
- Modify: `packages/shared/src/api/routes/social.ts` (DTOs)

- [ ] **Step 1 — DTOs:** Add `SocialManualPostBody { url: string }` + `SocialManualPostResponse` (a `SocialPost`), `SocialPostPatchBody { isHidden?: boolean; sortOrder?: number }`, `SocialEmbedResponse { mode: 'card'|'oembed'; html?: string; card?: SocialPost }`. Follow the barrel conventions (module-prefixed names).
- [ ] **Step 2 — routes:** using `defineRoute`:
  - `POST /posts/manual` (auth `admin`, `input.body` = zod bound to `SocialManualPostBody`) → `social.addManualPost`.
  - `PATCH /posts/:id` (auth `admin`) → `social.setPostVisibility` / `reorderPost`.
  - `GET /posts/:id/embed` (auth `public`) → `social.resolveEmbed`.
  Bind each zod schema to its DTO via `satisfies z.ZodType<...>` (DTO drift = compile error).
- [ ] **Step 3:** `npm run build -w packages/shared && npm test -w packages/api`. Expected: green.
- [ ] **Step 4:** `npm run docs:api` (regenerate `docs/API.md` + manifest). Commit.

### Task 1.8: Client SDK methods

**Files:**
- Modify: `packages/cms-client/src/modules/social.ts`

- [ ] **Step 1:** Add `addManualPost(body)`, `patchPost(id, body)`, `getEmbed(id)` mirroring the connections/social patterns already in the file (`this.mutate` / `this.get`, `invalidates: ['social']`).
- [ ] **Step 2:** `npm run build -w packages/cms-client && npm run check:drift -w packages/cms-client`. Expected: coverage drift check passes.
- [ ] **Step 3:** Commit.

**M1 exit:** an admin can `POST /social/posts/manual` a tweet URL; it's hydrated + cached; the public Social block renders it as a card. Zero cost, no OAuth.

---

## Milestone 2 — Social admin hub + nav + Posts tab

### Task 2.1: Nav item + icon + routes

**Files:**
- Modify: `packages/cms/src/pages/admin/AdminLayout.tsx` (`NAV_ITEMS`, `ICONS`)
- Modify: `packages/cms/src/App.tsx`

- [ ] **Step 1:** Add `{ path: '/admin/social', label: 'Social', icon: 'social', adminOnly: true }` to `NAV_ITEMS` (place it after Messages / before Mailing Lists). Add a `social` SVG to `ICONS`.
- [ ] **Step 2:** Lazy-import `SocialHub` and add `<Route path="/social" component={SocialHub} />` (+ `/social/compose`, `/social/configuration` if using route-per-tab; otherwise a single hub with in-page tabs — prefer in-page tabs, `?tab=` query, matching `Settings.tsx`).
- [ ] **Step 3:** `npm run build -w packages/cms` (or `tsc`). Expected: compiles; nav shows Social.
- [ ] **Step 4:** Commit.

### Task 2.2: `SocialHub` tabbed shell

**Files:**
- Create: `packages/cms/src/pages/admin/social/SocialHub.tsx`
- Create: `packages/cms/src/pages/admin/social/styles/_social-hub.scss` (+ `@use` in `AdminLayout.scss`)

- [ ] **Step 1:** Build a tab shell modeled on `Settings.tsx` (`TABS`, `activeTab` signal, `?tab=` sync): tabs **Posts**, **Compose**, **Configuration**. Render `SocialPostsPanel`, `SocialComposePanel` (stub until M4), `ConnectionsPanel` (M3). Reuse the clean admin form/label styling already standardized in `_forms.scss` / `_editor-properties.scss`.
- [ ] **Step 2:** Compile + eyeball. Commit.

### Task 2.3: `SocialPostsPanel` — local cache manager

**Files:**
- Create: `packages/cms/src/pages/admin/social/SocialPostsPanel.tsx`

- [ ] **Step 1:** Features:
  - platform filter (reuse `cms.social.listByPlatform` / `cms.social.list`),
  - **Add by URL** field → `cms.social.addManualPost({ url })`, optimistic refresh,
  - per-row **hide/show** toggle → `cms.social.patchPost(id, { isHidden })`,
  - **delete** → existing `cms.social.deletePost(id)`,
  - drag-or-arrow **reorder** → `patchPost(id, { sortOrder })`,
  - a small **preview** using the stored card fields (or `getEmbed`).
- [ ] **Step 2:** Loading/empty/error states (match existing admin list pages). Compile. Commit.

**M2 exit:** the Social hub is navigable; Posts tab manages the cache end-to-end.

---

## Milestone 3 — Relocate Connections + per-provider utilities

### Task 3.1: Extract `ConnectionsPanel` from Settings

**Files:**
- Create: `packages/cms/src/components/admin/social/ConnectionsPanel.tsx`
- Modify: `packages/cms/src/pages/admin/Settings.tsx`

- [ ] **Step 1:** Move the `ConnectionsPanel` function (Settings.tsx:66+) and its sub-UI into the new component file verbatim (imports adjusted). Keep it using `cms.connections.*`.
- [ ] **Step 2:** In `Settings.tsx`: remove `{ id: 'connections', ... }` from `TABS`, delete the `<Show when={activeTab()==='connections'}>` block, and remove the OAuth-return `setActiveTab('connections')` effect (moves to the hub — see 3.3). Leave a short note/link in Settings pointing to **Social → Configuration**.
- [ ] **Step 3:** Render `<ConnectionsPanel />` in `SocialHub`'s Configuration tab.
- [ ] **Step 4:** Compile. Commit.

### Task 3.2: Per-provider utility rows

**Files:**
- Modify: `packages/cms/src/components/admin/social/ConnectionsPanel.tsx`

- [ ] **Step 1:** Under each provider add a compact **utilities** area:
  - **X/Twitter:** a `twitterMode` toggle (`free` ⟷ `api`), a "Basic tier required for API mode" hint, a **Test hydration** button (calls `getEmbed` on a sample id), and an **Add recent posts by URL** shortcut linking to the Posts tab.
  - **Instagram/Facebook:** re-auth button (existing `oauthAuthorize`), token status.
  - Generic: **Sync now** (`cms.social.sync({ platform })`), last-synced timestamp.
- [ ] **Step 2:** Persist `twitterMode` through `cms.connections.update(provider, { settings: { twitterMode } })` (confirm the connections update route accepts a `settings` patch; if not, add it in `connections.ts` service + DTO).
- [ ] **Step 3:** Compile. Commit.

### Task 3.3: OAuth-return redirect → hub

**Files:**
- Modify: `packages/cms/src/pages/admin/social/SocialHub.tsx`

- [ ] **Step 1:** Port the `oauth_success`/`oauth_error` query handling from Settings so returning from a provider OAuth lands on **Social → Configuration**. Update the OAuth callback's post-redirect target if it hardcodes `/admin/settings?tab=connections` (search `connections.ts` service / oauth service for the redirect URL and point it at `/admin/social?tab=configuration`).
- [ ] **Step 2:** Compile. Commit.

**M3 exit:** Connections lives under Social → Configuration with per-provider utilities; Settings no longer owns it.

---

## Milestone 4 — Compose & cross-post (POSSE)  *(heaviest; consider a dedicated plan)*

### Task 4.1: X user-context OAuth 1.0a signer

**Files:**
- Create: `packages/api/src/services/social/twitterOAuth.ts`
- Test: `packages/api/src/services/social/twitterOAuth.test.ts`

- [ ] **Step 1 — failing test:** Assert the signer reproduces a known RFC 5849 example signature (use the spec's canonical test vector) given fixed nonce/timestamp.
- [ ] **Step 2 — implement:** Minimal OAuth 1.0a: percent-encode, build the signature base string, HMAC-SHA1 with `consumerSecret&tokenSecret` using Node `crypto` (no new dependency). Expose `authHeader(method, url, params, creds)`.
- [ ] **Step 3:** Test PASS. Commit.
- **Decision to confirm with user:** allow adding the `oauth-1.0a` npm dep instead of hand-rolling? Default: hand-roll (no new dep, per CLAUDE.md "do not add deps unless asked").

### Task 4.2: `publishPost` service (text-only first)

**Files:**
- Create: `packages/api/src/services/social/publish.ts`

- [ ] **Step 1:** `publishPost({ providers: SocialPlatform[], text }, ctx)`:
  - For `twitter`: `POST https://api.twitter.com/2/tweets` with the OAuth 1.0a header, body `{ text }`. On success capture `data.id`, then `upsertSocialPost('twitter', hydrated, { source: 'posse', postUrl, createdBy })` (hydrate via `fetchTweetById` or from the response).
  - For other providers: stub with a clear `NotImplemented` per provider (extend later); FB/IG posting via Graph API is a follow-up.
  - Return a per-provider result array `{ provider, ok, id?, error? }` (partial success is normal).
- [ ] **Step 2:** Unit test with `fetch` mocked. Commit.

### Task 4.3: `POST /social/publish` route + DTO + SDK

**Files:**
- Modify: `packages/api/src/routes/social.ts`, `packages/shared/src/api/routes/social.ts`, `packages/cms-client/src/modules/social.ts`

- [ ] **Step 1:** DTO `SocialPublishBody { providers: string[]; text: string }`, `SocialPublishResponse { results: { provider: string; ok: boolean; id?: string; error?: string }[] }`. Route `POST /publish` (auth `admin`) → `publishPost`. SDK `cms.social.publish(body)`.
- [ ] **Step 2:** `npm run docs:api`, `check:drift`. Commit.

### Task 4.4: `SocialComposePanel` UI

**Files:**
- Create: `packages/cms/src/pages/admin/social/SocialComposePanel.tsx`

- [ ] **Step 1:** Textarea (char counter for X's 280), provider checkboxes (only providers whose connection supports posting are enabled; others greyed with a tooltip), a media picker (reuse `MediaSelectModal` — wire to upload later), **Publish** button → `cms.social.publish`. Show the per-provider result row after publish. New POSSE posts appear in the Posts tab.
- [ ] **Step 2:** Compile. Commit.

- [ ] **Follow-up (not in this milestone):** media upload to X (v1.1 `media/upload` chunked, OAuth 1.0a) + FB/IG Graph publishing. Spin these into their own plan.

**M4 exit:** an admin composes once and cross-posts (text) to X via the free write API; the tweet is captured and rendered.

---

## Milestone 5 — Paid API path toggle + docs

### Task 5.1: Gate the read-sync behind `twitterMode`

**Files:**
- Modify: `packages/api/src/services/social.ts`, `packages/api/src/services/socialCrons.ts`

- [ ] **Step 1:** In `syncSocialPosts`, when `platform==='twitter'` read the connection `settings.twitterMode`; if `'free'`, skip the paid `fetchTwitterPosts` read (log "twitter in free mode — use compose/manual"). Only `'api'` mode calls the bearer endpoint. Manual/POSSE capture is unaffected.
- [ ] **Step 2:** In `socialCrons.ts`, register a Twitter read-sync cron *only* when a connected `twitter` row has `settings.twitterMode === 'api'`; otherwise don't schedule it.
- [ ] **Step 3:** Use `since_id` for the paid path (store last-synced id in `settings.lastTweetId`) so it stays under the Basic-tier 10k/mo cap; pull ≤10 per sync, hourly. Update `fetchTwitterPosts` to accept `sinceId`.
- [ ] **Step 4:** `npm test -w packages/api`. Commit.

### Task 5.2: Docs

**Files:**
- Create: `docs/SOCIAL.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1:** `docs/SOCIAL.md`: the three capture paths (POSSE / manual / paid sync), the cost model (free default vs Basic $100/mo), the X `tweet-result`/oEmbed rendering + reliability caveat, per-provider setup, and the Social hub tour.
- [ ] **Step 2:** `CLAUDE.md`: update the **Social connections** capability bullet (now: compose/cross-post + manual capture + free default, paid opt-in) and add **Social** to the admin nav list.
- [ ] **Step 3:** Commit.

---

## Cross-cutting requirements

- **Cache-key contract:** all new Redis keys go through `CACHE_KEYS` in `services/cache.ts` with named `invalidate*` helpers; never call `cache.del`/`delPattern` from a service (guard test enforces this).
- **DTO binding:** every new route's zod `input` binds to a `@sitesurge/types` DTO (`satisfies z.ZodType<X>` or `AssertCompatible`) — drift is a compile error.
- **Manifest + docs:** run `npm run docs:api` after adding routes; never hand-edit `docs/API.md` / `docs/api-manifest.json`.
- **SDK drift:** run `npm run check:drift -w packages/cms-client` after adding client methods.
- **ToS posture:** the default path uses only the official write API (POSSE), operator-pasted URLs (manual), and the public `tweet-result`/oEmbed render endpoints for *known* IDs. We do **not** scrape profile timelines. Document the `tweet-result` reliability caveat in `docs/SOCIAL.md` and keep oEmbed as the automatic fallback renderer.
- **Graceful degradation:** every network fn (`fetchTweetById`, `resolveEmbed`, publish) returns a typed failure rather than throwing into the request path; a dead hydrate must never blank an existing card.

## Testing strategy

- **Unit (vitest, api):** token derivation, URL parsing, `tweet-result` JSON mapping, OAuth 1.0a signature vector, `addManualPost` (mocked `query` + `fetch`), `publishPost` (mocked `fetch`), `twitterMode` gating.
- **Contract:** `cache-contract.test.ts` and the SSR/mail coverage tests must stay green.
- **Manual smoke:** paste a real tweet URL in the Posts tab → confirm it renders on the public Social block; toggle a connection to `api` mode with a Basic key → confirm scheduled sync; compose text → confirm it posts to X and is captured.

## Open decisions to confirm before executing

1. **OAuth dep (Task 4.1):** hand-roll the OAuth 1.0a signer (default, no new dep) or add `oauth-1.0a`?
- We can handroll it to maintain our own compatibility.
2. **Tabs vs routes (M2):** in-page `?tab=` tabs (default, matches Settings) or discrete `/admin/social/*` routes?
- I prefer routes.
3. **`social` feature gate:** keep Social always-on for admins (default) or add a `social` feature key to `FEATURE_REGISTRY` so it can be disabled?
- Add the new 'social' feature, and ensure it shows in the main admin dashboard as well (its status at the bottom).
4. **Render mode default:** custom `SocialEmbed` card (default, styleable, no X JS) vs official oEmbed HTML (heavier, X-styled). Card default with oEmbed fallback is the plan.
- I prefer custom rendering, but fallback to embed if not available.