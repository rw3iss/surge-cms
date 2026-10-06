# Cache-Invalidation Contract — Implementation Plan

> **For agentic workers:** Execute this plan with the **superpowers:subagent-driven-development** skill (one task = one focused subagent, each ending in `pnpm --filter @sitesurge/server build` + `test` green + a commit). Every task is independent per-service; do them in order but each stands alone. No behavior change to the actual Redis keys is permitted — the whole point is that the byte-identical key strings simply *move* into `cache.ts`.

## Goal

Establish a **single cache-key + invalidation contract** in `packages/api/src/services/cache.ts`. Today `cache.ts` owns typed invalidators for the "core" entities (pages, posts, campaigns, forms, users, settings, mail, sitemap), but ~13 other services reach past the wrapper with raw `cache.del('literal')` / `cache.delPattern('literal:*')` calls, with the key strings living in the individual services (`block_styles:all` in `blockStyles.ts`, `social:*` in `socialFeed.ts`/`connections.ts`, `shop:*` across the shop services, etc.).

After this change:
- Every cache key (and key-prefix/pattern) is declared **once**, centrally, in a `CACHE_KEYS` map in `cache.ts`.
- Every entity has a **named invalidator** (`invalidateXCache(...)`) exported from `cache.ts`.
- Services call named invalidators only — **no raw `del` / `delPattern` outside `cache.ts`** (enforced by a lightweight guard test).
- `cache.get` / `cache.set` remain the read/write primitives, but the key strings they pass come from `CACHE_KEYS` builders so the read side and the invalidator side can never drift.

## Architecture

`cache.ts` becomes the one file that knows Redis key strings for the whole API. Two layers:

1. **`CACHE_KEYS`** — a frozen map of static keys, prefix constants, and pure key-builder functions (e.g. `CACHE_KEYS.socialHomepage`, `CACHE_KEYS.shopProductSlug(slug)`, `CACHE_KEYS.settingsByKey(key)`). Services that *read/write* a cache (`cache.get`/`cache.set`) import the builder instead of hand-writing the literal.
2. **Named invalidators** — `invalidateXCache(...)` functions that call the private `del`/`delPattern` primitives with `CACHE_KEYS` values. Services call these only.

The existing `del`/`delPattern` stay exported on the `cache` object **for now** (removing them is out of scope and would break the OAuth-state transient store), but a guard test forbids new call sites outside `cache.ts`. The one legitimate non-entity user of `del` (OAuth CSRF state in `connections.ts`) gets a dedicated `consumeOAuthState()` helper so it, too, stops calling raw `del`.

## Tech Stack

- **Redis** via the `ioredis` wrapper in `packages/api/src/services/cache.ts` (`get`/`set`/`del`/`delPattern` primitives).
- **TypeScript** (strict), `pnpm` workspaces, `@sitesurge/server` = `packages/api`.
- **vitest** (`pnpm --filter @sitesurge/server test`) — the existing suite must stay green; the guard adds one test.

---

## Key Inventory

Every raw `del` / `delPattern` call site outside `cache.ts` today, the exact key string (which **must not change**), and the new named invalidator that replaces it. `set`/`get` call sites are listed where the same literal must be centralized into a `CACHE_KEYS` builder so read and invalidation stay in lock-step.

| Entity | Key / pattern (byte-identical) | Current raw call sites (`del`/`delPattern`) | Read/write sites using same literal | New invalidator in `cache.ts` |
|---|---|---|---|---|
| **Social feed** | `social:homepage` | `socialFeed.ts:184` `del` | `socialFeed.ts:139/140/169` get/set | `invalidateSocialHomepageCache()` |
| **Social feed (all)** | `social:*` | `socialFeed.ts:198,209`; `connections.ts:176,227,415` `delPattern` | `socialFeed.ts:48,66,102,120` (`social:posts:*`, `social:<plat>:*`); `social.ts:419,435` (`social:feed:*`) | `invalidateSocialCache()` |
| **Block styles** | `block_styles:all` | `blockStyles.ts:67,88,103` `del` | `blockStyles.ts:34,37` get/set | `invalidateBlockStylesCache()` |
| **Fonts** | `fonts:list` | `fonts.ts:69` `del` (via local `invalidateCache`) | `fonts.ts:77,81` get/set | `invalidateFontsCache()` |
| **Swatches** | `settings:site_colors` | `swatches.ts:143` `del` | `swatches.ts:54,62,69,102` get/set | `invalidateSwatchesCache()` (covered by `settings:*`, kept explicit) |
| **Settings (per-key)** | `settings:<key>` | `settings.ts:80,105` `del` | `settings.ts` repo/routes cache by `settings:<key>` | fold into `invalidateSettingsCache()` (pattern `settings:*` already covers) |
| **Settings (keyed JSON)** | `settings:site_header` / `site_footer` / `site_branding` / `site_appearance` / `homepage_hero` | `settings.ts:525` `del(def.cacheKey)` | `settings.ts:503,511` get/set | fold into `invalidateSettingsCache()` (already runs `delPattern('settings:*')`) |
| **SSR HTML (one path)** | `ssr:html:<pathname>` | `ssr/index.ts:169` `del` | `ssr/index.ts:161` set | `invalidateSsrCache(pathname)` |
| **SSR HTML (all)** | `ssr:html:*` | `ssr/index.ts:174` `delPattern` | — | `invalidateAllSsrCache()` (already inlined in page/post/etc invalidators) |
| **Shop catalog** | `shop:categories`, `shop:collections:*`, `shop:tags`, `shop:product:slug:*`, `shop:products:*` | `catalog.ts:17,18,19,21,22` (via `invalidateCatalogCache`) | `catalog.ts:30,33,82,86,154`; `catalog.ts` tags | `invalidateShopCatalogCache()` |
| **Shop products** | `shop:products:*`, `shop:product:slug:*` | `products.ts:28,29` (via `invalidateProductCache`) | `products.ts:82,84,88,94,95,101` get/set | `invalidateShopProductCache()` |
| **Shop reviews** | `shop:reviews:<productId>:*` (+ product caches `shop:product:slug:*`, `shop:products:*`) | `reviews.ts:26,31,32` | `reviews.ts:46,48,56` get/set | `invalidateShopReviewCache(productId)` |
| **Shop variants** | `shop:product:slug:*` | `variants.ts:29` `delPattern` | — | `invalidateShopProductSlugCache()` (shared w/ products) |
| **Shop settings** | `shop:settings:raw`, `shop:settings:public` | `settings.ts(shop):182,183` `del` | `settings.ts(shop):68,81,92,107` get/set | `invalidateShopSettingsCache()` |
| **OAuth state** (transient, not an entity cache) | `oauth_state:<state>` | `connections.ts:321` `del` | `connections.ts:269,316` set/get | `consumeOAuthState(state)` (read-and-delete helper) |
| **Feed / sitemap / stripe status** (read-only, no raw del today) | `feed:rss`, `sitemap:xml`, `shop:stripe:status` | — (`invalidateSitemapCache` already central; feed/stripe self-expire on TTL) | `feed.ts:156,159`; `sitemap.ts:115,118,133`; `stripeStatus.ts:94,98` | key builders only (no new invalidator needed) |

Notes that matter for correctness:
- `settings:site_colors` (swatches) and every `settings:site_*` keyed setting are already inside the `settings:*` namespace, so `invalidateSettingsCache()`'s `delPattern('settings:*')` **already busts them**. The per-key `cache.del(...)` calls in `settings.ts`/`swatches.ts` are redundant. We keep an explicit `invalidateSwatchesCache()` for call-site readability but it must remain a **subset** of what `settings:*` already clears — no key change.
- `social:feed:*` (`social.ts`), `social:posts:*`, `social:homepage`, and `social:<platform>:*` all live under the `social:*` namespace that the sync/disconnect/delete paths already blow away with `delPattern('social:*')`. Centralizing must preserve exactly `social:*`.
- OAuth state is **not** entity caching — it's a short-TTL CSRF token store. It still must stop calling raw `del` to satisfy the guard; a `consumeOAuthState()` helper (get-then-del) is the right home.

## File Structure

**`packages/api/src/services/cache.ts`** (the contract):
- Add `export const CACHE_KEYS = { ... } as const;` — static keys, `*_PREFIX` constants, and builder fns.
- Add named invalidators: `invalidateSocialCache`, `invalidateSocialHomepageCache`, `invalidateBlockStylesCache`, `invalidateFontsCache`, `invalidateSwatchesCache`, `invalidateSsrCache(pathname)`, `invalidateAllSsrCache`, `invalidateShopCatalogCache`, `invalidateShopProductCache`, `invalidateShopProductSlugCache`, `invalidateShopReviewCache(productId)`, `invalidateShopSettingsCache`, `consumeOAuthState(state)`.
- Register them all on the exported `cache` object.

**Services to update (call named invalidators; import `CACHE_KEYS` for get/set literals):**
- `packages/api/src/services/socialFeed.ts`
- `packages/api/src/services/connections.ts`
- `packages/api/src/services/social.ts` (get/set key only)
- `packages/api/src/services/blockStyles.ts`
- `packages/api/src/services/fonts.ts`
- `packages/api/src/services/swatches.ts`
- `packages/api/src/services/settings.ts`
- `packages/api/src/services/ssr/index.ts`
- `packages/api/src/services/shop/catalog.ts`
- `packages/api/src/services/shop/products.ts`
- `packages/api/src/services/shop/reviews.ts`
- `packages/api/src/services/shop/variants.ts`
- `packages/api/src/services/shop/settings.ts`
- `packages/api/src/services/feed.ts`, `sitemap.ts`, `shop/stripeStatus.ts` (get/set key centralization only — optional, low value; do only if trivially clean)

**New guard test:** `packages/api/src/services/__tests__/cache-contract.test.ts` (or nearest existing test dir) — greps the source tree for raw `del`/`delPattern` outside `cache.ts` and fails.

---

## Task 1 — Central `CACHE_KEYS` map + invalidators in `cache.ts`

**Files:** `packages/api/src/services/cache.ts`

This task only *adds* to `cache.ts` (no service edits yet) so nothing breaks; later tasks migrate call sites onto it.

- [ ] Add the key map near the top of `cache.ts` (after imports, before the primitives), declaring **every** literal byte-for-byte as it exists today:

```ts
/**
 * THE cache-key contract. Every Redis key string used anywhere in the API
 * is declared here — literals live NOWHERE else. Read/write sites import a
 * builder; invalidation goes through the named `invalidateXCache` fns below.
 * Changing a string here changes a production key: only do it deliberately.
 */
export const CACHE_KEYS = {
    // ── Social ──
    socialAll: 'social:*',
    socialHomepage: 'social:homepage',
    socialPosts: (platform: string, page: number, limit: number) =>
        `social:posts:${platform}:${page}:${limit}`,
    socialPlatform: (platform: string, page: number, limit: number, sort: string, sortDir: string) =>
        `social:${platform}:${page}:${limit}:${sort}:${sortDir}`,
    socialLiveFeed: (platform: string, limit: number) => `social:feed:${platform}:${limit}`,

    // ── Block styles ──
    blockStylesAll: 'block_styles:all',

    // ── Fonts ──
    fontsList: 'fonts:list',

    // ── Settings (namespace) ──
    settingsAll: 'settings:*',
    settingsByKey: (key: string) => `settings:${key}`,
    settingsPublic: 'settings:public',
    settingsSiteColors: 'settings:site_colors',

    // ── SSR ──
    ssrAll: 'ssr:html:*',
    ssrPath: (pathname: string) => `ssr:html:${pathname}`,

    // ── Shop ──
    shopCategories: 'shop:categories',
    shopCollectionsPrefix: 'shop:collections:',
    shopCollections: (suffix: string) => `shop:collections:${suffix}`,
    shopTags: 'shop:tags',
    shopProductsPrefix: 'shop:products:',
    shopProductSlugPrefix: 'shop:product:slug:',
    shopProductSlug: (slug: string) => `shop:product:slug:${slug}`,
    shopReviewsPrefix: 'shop:reviews:',
    shopReviews: (productId: string, sort: string, page: number, limit: number) =>
        `shop:reviews:${productId}:${sort}:${page}:${limit}`,
    shopSettingsRaw: 'shop:settings:raw',
    shopSettingsPublic: 'shop:settings:public',
    shopStripeStatus: 'shop:stripe:status',

    // ── Feed / sitemap ──
    feedRss: 'feed:rss',
    sitemapXml: 'sitemap:xml',

    // ── Transient (not entity cache) ──
    oauthState: (state: string) => `oauth_state:${state}`,
} as const;
```

- [ ] Add the named invalidators below the existing ones (before `flushAll`). Bodies use `CACHE_KEYS` + the existing private `del`/`delPattern`:

```ts
/** Bust every social cache (stored post lists, homepage selection, live feeds). */
export async function invalidateSocialCache(): Promise<void> {
    await delPattern(CACHE_KEYS.socialAll,);
}

/** Bust only the homepage-selection cache. */
export async function invalidateSocialHomepageCache(): Promise<void> {
    await del(CACHE_KEYS.socialHomepage,);
}

export async function invalidateBlockStylesCache(): Promise<void> {
    await del(CACHE_KEYS.blockStylesAll,);
}

export async function invalidateFontsCache(): Promise<void> {
    await del(CACHE_KEYS.fontsList,);
}

/** Swatches persist under the settings namespace (settings:site_colors). This
 *  is a subset of what invalidateSettingsCache already clears; kept explicit
 *  for call-site readability. */
export async function invalidateSwatchesCache(): Promise<void> {
    await del(CACHE_KEYS.settingsSiteColors,);
}

/** Drop one rendered SSR HTML entry. */
export async function invalidateSsrCache(pathname: string,): Promise<void> {
    await del(CACHE_KEYS.ssrPath(pathname,),);
}

/** Drop every rendered SSR HTML entry. */
export async function invalidateAllSsrCache(): Promise<void> {
    await delPattern(CACHE_KEYS.ssrAll,);
}

export async function invalidateShopCatalogCache(): Promise<void> {
    await del(CACHE_KEYS.shopCategories,);
    await delPattern(`${CACHE_KEYS.shopCollectionsPrefix}*`,);
    await del(CACHE_KEYS.shopTags,);
    // Product detail carries taxonomy → bust product caches too.
    await delPattern(`${CACHE_KEYS.shopProductSlugPrefix}*`,);
    await delPattern(`${CACHE_KEYS.shopProductsPrefix}*`,);
}

export async function invalidateShopProductCache(): Promise<void> {
    await delPattern(`${CACHE_KEYS.shopProductsPrefix}*`,);
    await delPattern(`${CACHE_KEYS.shopProductSlugPrefix}*`,);
}

/** Slug-only product bust (variant inventory changes). */
export async function invalidateShopProductSlugCache(): Promise<void> {
    await delPattern(`${CACHE_KEYS.shopProductSlugPrefix}*`,);
}

/** Review list for one product + the denormalized rating on product caches. */
export async function invalidateShopReviewCache(productId: string,): Promise<void> {
    await delPattern(`${CACHE_KEYS.shopReviewsPrefix}${productId}:*`,);
    await delPattern(`${CACHE_KEYS.shopProductSlugPrefix}*`,);
    await delPattern(`${CACHE_KEYS.shopProductsPrefix}*`,);
}

export async function invalidateShopSettingsCache(): Promise<void> {
    await del(CACHE_KEYS.shopSettingsRaw,);
    await del(CACHE_KEYS.shopSettingsPublic,);
}

/** Read-and-delete the transient OAuth CSRF state (get already JSON-parses). */
export async function consumeOAuthState<T,>(state: string,): Promise<T | null> {
    const key = CACHE_KEYS.oauthState(state,);
    const payload = await get<T>(key,);
    await del(key,);
    return payload;
}
```

- [ ] Register the new fns on the exported `cache` object (append to the existing literal):

```ts
export const cache = {
    get,
    set,
    del,
    delPattern,
    // ...existing invalidators...
    invalidateSettingsCache,
    invalidateSitemapCache,
    // new:
    invalidateSocialCache,
    invalidateSocialHomepageCache,
    invalidateBlockStylesCache,
    invalidateFontsCache,
    invalidateSwatchesCache,
    invalidateSsrCache,
    invalidateAllSsrCache,
    invalidateShopCatalogCache,
    invalidateShopProductCache,
    invalidateShopProductSlugCache,
    invalidateShopReviewCache,
    invalidateShopSettingsCache,
    consumeOAuthState,
    CACHE_KEYS,
    flushAll,
    healthCheck,
    close: closeRedis,
};
```

- [ ] Refactor the **existing** invalidators to reference `CACHE_KEYS` where a literal now lives in the map (e.g. `invalidateSitemapCache` → `del(CACHE_KEYS.sitemapXml)`, the `ssr:html:*` inlines → `delPattern(CACHE_KEYS.ssrAll)`, `settings:*` → `delPattern(CACHE_KEYS.settingsAll)`). Byte-identical strings only.
- [ ] **Verify:** `pnpm --filter @sitesurge/server build` (typecheck passes; map is `as const`) and `pnpm --filter @sitesurge/server test` (all green — no call sites changed yet).
- [ ] **Commit:** `feat(cache): central CACHE_KEYS map + named invalidators for social/shop/ssr/fonts/blockStyles`

## Task 2 — Social feed + connections + social service

**Files:** `packages/api/src/services/socialFeed.ts` (lines 48, 66, 102, 120, 139–140, 169, 184, 198, 209), `packages/api/src/services/connections.ts` (lines 176, 227, 269, 316, 321, 415), `packages/api/src/services/social.ts` (lines 419, 435)

- [ ] `socialFeed.ts:184` — replace `await cache.del('social:homepage',);` with `await cache.invalidateSocialHomepageCache();`
- [ ] `socialFeed.ts:198` and `:209` — replace `await cache.delPattern('social:*',);` with `await cache.invalidateSocialCache();`
- [ ] `socialFeed.ts` get/set keys — build via `CACHE_KEYS`:
  - line 48: `const cacheKey = cache.CACHE_KEYS.socialPosts(platform || 'all', page, limit,);`
  - line 102: `const cacheKey = search ? null : cache.CACHE_KEYS.socialPlatform(platform, page, limit, sort, sortDir,);`
  - line 139: `const cacheKey = cache.CACHE_KEYS.socialHomepage;`
- [ ] `connections.ts:176,227,415` — replace `await cache.delPattern('social:*',);` with `await cache.invalidateSocialCache();`
- [ ] `connections.ts` OAuth state:
  - line 269 set stays (`cache.set(cache.CACHE_KEYS.oauthState(state,), statePayload, 600,)`)
  - lines 316 + 321 (get then del) — collapse into `const statePayload = await cache.consumeOAuthState<...>(state,);` and delete the now-redundant `cache.del(...)` at 321. Keep the existing "already JSON-parses" comment.
- [ ] `social.ts:419` — `const cacheKey = cache.CACHE_KEYS.socialLiveFeed(platform, limit,);` (set at 435 unchanged).
- [ ] **Verify:** build + test green.
- [ ] **Commit:** `refactor(cache): social feed/connections use named invalidators + CACHE_KEYS`

## Task 3 — Block styles + fonts

**Files:** `packages/api/src/services/blockStyles.ts` (19, 34, 37, 67, 88, 103), `packages/api/src/services/fonts.ts` (33, 68–69, 77, 81)

- [ ] `blockStyles.ts`: replace the three `await cache.del(CACHE_KEY,);` (67, 88, 103) with `await cache.invalidateBlockStylesCache();`. Change get/set (34, 37) to `cache.CACHE_KEYS.blockStylesAll`. Delete the now-unused `const CACHE_KEY = 'block_styles:all';` (line 19) — or keep it aliased to `cache.CACHE_KEYS.blockStylesAll` for the get/set; prefer deleting and using the builder inline.
- [ ] `fonts.ts`: change `invalidateCache()` (line 68–69) body to `await cache.invalidateFontsCache();`. Change get/set (77, 81) to `cache.CACHE_KEYS.fontsList`. Remove the local `const CACHE_KEY = 'fonts:list';` (line 33) if fully unused.
- [ ] **Verify:** build + test green.
- [ ] **Commit:** `refactor(cache): blockStyles + fonts use named invalidators`

## Task 4 — Swatches + settings

**Files:** `packages/api/src/services/swatches.ts` (29, 54, 62, 69, 102, 143), `packages/api/src/services/settings.ts` (80, 105, 189, 503, 511, 525)

- [ ] `swatches.ts:143` — replace `await cache.del(CACHE_KEY,);` with `await cache.invalidateSwatchesCache();` (the following `invalidateSettingsCache()` call stays). get/set (54, 62, 69, 102) → `cache.CACHE_KEYS.settingsSiteColors`; drop the local `CACHE_KEY` const (29).
- [ ] `settings.ts:80` and `:105` — the `cache.del(`settings:${key}`)` calls are **redundant** (the preceding `invalidateSettingsCache()` runs `delPattern('settings:*')` which already covers `settings:<key>`). Remove both raw `del` calls. Confirm the comment at 78–79 is deleted with them.
- [ ] `settings.ts:525` (`setKeyed`) — `cache.del(def.cacheKey)` is likewise redundant vs the following `invalidateSettingsCache()`; remove it. (`def.cacheKey` values are all `settings:site_*`, inside `settings:*`.)
- [ ] `settings.ts` get/set that build `settings:...` literals (189 `settings:public`, 503/511 `def.cacheKey`) — leave `def.cacheKey` as-is (already a field) OR optionally point the `KeyedSetting` defs' `cacheKey` at `CACHE_KEYS.settingsByKey(key)` for single-source. Low value; only do if clean. `settings:public` → `cache.CACHE_KEYS.settingsPublic`.
- [ ] **Verify:** build + test green. **Manually confirm** via grep that no `settings:<key>` cache read depends on a *narrower* invalidation than `settings:*` — none does (all settings reads share the namespace).
- [ ] **Commit:** `refactor(cache): swatches + settings drop redundant raw dels, funnel to invalidateSettingsCache`

## Task 5 — SSR cache wrappers delegate to `cache.ts`

**Files:** `packages/api/src/services/ssr/index.ts` (161, 168–170, 173–175)

- [ ] `invalidateSsrCache(pathname)` (168–170) — body becomes `await cache.invalidateSsrCache(pathname,);` (keep the local exported name so all importers are unchanged).
- [ ] `invalidateAllSsrCache()` (173–175) — body becomes `await cache.invalidateAllSsrCache();`.
- [ ] `set` at 161 — key via `cache.CACHE_KEYS.ssrPath(pathname,)` (verify `cacheKey` upstream equals `ssr:html:${pathname}`; if built earlier in the fn, centralize that build).
- [ ] **Verify:** build + test green. Confirm no import cycle (`ssr/index.ts` already imports `cache`).
- [ ] **Commit:** `refactor(cache): ssr invalidators delegate to central cache contract`

## Task 6 — Shop services

**Files:** `packages/api/src/services/shop/catalog.ts` (12–23, 30, 33, 82, 86, 154), `shop/products.ts` (24–30, 82, 84, 88, 94, 101), `shop/reviews.ts` (19–33, 46, 56), `shop/variants.ts` (29), `shop/settings.ts` (31–32, 68, 81, 92, 107, 182–183)

- [ ] `catalog.ts`: replace `invalidateCatalogCache()` body (17–22) with `await cache.invalidateShopCatalogCache();` OR delete the local fn and call `cache.invalidateShopCatalogCache()` at its three call sites (47, 61, 71). Point get/set (30, 33 categories; 82, 86 collections; 154 tags) at `cache.CACHE_KEYS.shopCategories` / `.shopCollections('published')` / `.shopTags`. Drop the local `CATEGORIES_KEY` / `COLLECTIONS_PREFIX` / `TAGS_KEY` consts.
- [ ] `products.ts`: replace `invalidateProductCache()` body (28–29) with `await cache.invalidateShopProductCache();`. get/set (82, 84, 88 list; 94, 101 slug) via `cache.CACHE_KEYS.shopProductsPrefix` + `.shopProductSlug(slug)`. Drop local prefix consts.
- [ ] `reviews.ts`: `invalidateReviewCache(productId)` (26) → `await cache.invalidateShopReviewCache(productId,);` which now also busts the product rating caches, so the separate `invalidateProductRatingCaches()` (30–33) call sites collapse into `invalidateShopReviewCache`. **Check each call site**: where both were called, one `invalidateShopReviewCache(productId)` now suffices (same keys). Where only rating caches were busted (no productId in scope), use `cache.invalidateShopProductCache()`. `reviewListCacheKey` (21–23) → `cache.CACHE_KEYS.shopReviews(productId, sort ?? 'newest', page, limit)`.
- [ ] `variants.ts:29` — replace `await cache.delPattern('shop:product:slug:*',);` with `await cache.invalidateShopProductSlugCache();`
- [ ] `settings.ts(shop):182–183` — replace the two `cache.del` with `await cache.invalidateShopSettingsCache();` (the following `invalidateSettingsCache()` stays). get/set (68, 81 raw; 92, 107 public) → `cache.CACHE_KEYS.shopSettingsRaw` / `.shopSettingsPublic`. Drop local consts.
- [ ] `stripeStatus.ts` (94, 98) — optional: key via `cache.CACHE_KEYS.shopStripeStatus` (no invalidator; self-expires).
- [ ] **Verify:** build + test green. Cross-check the reviews collapse didn't drop a bust: grep `shop:product` and `shop:reviews` behavior against the pre-change set.
- [ ] **Commit:** `refactor(cache): shop catalog/products/reviews/variants/settings use named invalidators`

## Task 7 — feed + sitemap key centralization (optional, low risk)

**Files:** `packages/api/src/services/feed.ts` (24, 156, 159), `packages/api/src/services/sitemap.ts` (17, 115, 118, 133)

- [ ] Point get/set at `cache.CACHE_KEYS.feedRss` / `.sitemapXml`. `sitemap.ts` already has `cache.invalidateSitemapCache` centrally; feed self-expires on its 1800s TTL (no writer invalidates it, unchanged). Drop the local `CACHE_KEY` consts if fully unused (keep `CACHE_TTL`).
- [ ] **Verify:** build + test green.
- [ ] **Commit:** `refactor(cache): feed + sitemap read keys from CACHE_KEYS`

## Task 8 — Guard against future raw `del`/`delPattern`

**Files:** new `packages/api/src/services/__tests__/cache-contract.test.ts`; comment banner already added to `cache.ts` in Task 1.

- [ ] Add a vitest guard that greps the API source for raw invalidation calls outside `cache.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import path from 'node:path';

describe('cache-invalidation contract', () => {
    it('no raw cache.del / cache.delPattern outside cache.ts', () => {
        const srcRoot = path.resolve(__dirname, '../../'); // packages/api/src
        // ripgrep is available in CI/dev images; fall back to git grep.
        let out = '';
        try {
            out = execSync(
                `grep -rn --include='*.ts' -E 'cache\\.(del|delPattern)\\(' ${srcRoot} || true`,
                { encoding: 'utf8' },
            );
        } catch { /* grep exit 1 = no matches */ }
        const offenders = out
            .split('\n')
            .filter(Boolean)
            .filter((l) => !l.includes('/services/cache.ts'))
            // this test file itself references the strings in a regex:
            .filter((l) => !l.includes('cache-contract.test.ts'));
        expect(offenders, `raw cache.del/delPattern found:\n${offenders.join('\n')}`).toEqual([]);
    });
});
```

- [ ] Add a short "DO NOT call `del`/`delPattern` directly — add a `CACHE_KEYS` entry + a named `invalidateXCache()` here instead" banner at the top of `cache.ts` (if not already added in Task 1).
- [ ] Optional lint note: add a comment in `config/.oxlintrc.json` region or `CLAUDE.md` "Gotchas" pointing to the contract (docs discipline).
- [ ] **Verify:** `pnpm --filter @sitesurge/server test` — the guard passes (proving Tasks 2–6 left zero offenders) and the full suite stays green.
- [ ] **Commit:** `test(cache): guard against raw del/delPattern outside cache.ts`

---

## Risks & Rollback

- **Redis key strings must stay byte-identical.** The single largest risk: a typo in a `CACHE_KEYS` builder (extra colon, wrong order of `page:limit`, `all` vs empty platform) yields a *new* key, so writes land on the new key while stale data lingers on the old one until TTL. Mitigation: Task 1 copies literals verbatim; each later task diffs the built string against the original literal before deleting the old const. The guard test does **not** catch this — a targeted assertion or manual `console.log(cache.CACHE_KEYS.socialPosts('all',1,20))` check per builder during Task 2–6 is the backstop.
- **A missed call site leaves stale cache.** If any `del`/`delPattern` is left un-migrated, the guard test (Task 8) fails the build — this is the safety net, so land Task 8 last and let it fail loudly if Tasks 2–6 missed anything.
- **Reviews invalidation collapse** (Task 6) merges two helpers into `invalidateShopReviewCache`; if a call site only intended to bust product rating caches (no review list), verify the merged fn still clears the right superset — it clears review + product caches, which is a superset, so at worst it over-invalidates (safe, just a cache miss).
- **Settings redundant-del removal** (Task 4): removing `cache.del('settings:<key>')` is safe **only because** `invalidateSettingsCache()` runs `delPattern('settings:*')` on the same code path. If any of those call sites is ever refactored to NOT call `invalidateSettingsCache()`, the per-key bust must return. Leave a code comment noting the dependency.
- **Rollback:** each task is one commit; `git revert <sha>` restores the prior raw-key call site. Task 1 is additive-only, so reverting later tasks without reverting Task 1 leaves harmless unused exports.

## Self-Review Checklist

- [ ] `grep -rn -E 'cache\.(del|delPattern)\(' packages/api/src` returns **only** matches inside `services/cache.ts` (and the guard test file). Zero service offenders.
- [ ] `grep -rn -E "'(social|shop|block_styles|fonts|settings|ssr|feed|sitemap|oauth_state):" packages/api/src` shows literals **only** in `cache.ts` (the `CACHE_KEYS` map) — no stray key strings left in services.
- [ ] Every migrated builder's output string was compared against the original literal and is byte-identical (spot-checked per entity).
- [ ] `pnpm --filter @sitesurge/server build` passes (typecheck; `CACHE_KEYS` is `as const`).
- [ ] `pnpm --filter @sitesurge/server test` — full suite green **plus** the new contract guard passes.
- [ ] No new import cycles (`ssr/index.ts` ↔ `cache.ts` already one-directional; `cache.ts` imports no service).
- [ ] `cache.ts` exports every new invalidator on the `cache` object and re-exports `CACHE_KEYS`.
- [ ] Redundant-del removals (settings/swatches) each still sit behind a `invalidateSettingsCache()` call on the same path (verified per call site).
