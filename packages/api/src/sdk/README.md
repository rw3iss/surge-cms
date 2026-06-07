# CMS SDK

> **Note (2026-06):** migration to `backend/src/services/<module>.ts` is **complete** (headless API Phase 3 sweep). All 25 route modules now use the manifest framework; all capability modules live in `services/`. Files under `sdk/` permanently re-export from `services/` — the `cms.*` aggregate remains the supported in-process surface. See `docs/superpowers/specs/2026-06-04-headless-api-design.md`.

Single import surface for every capability in the CMS. Routes, scripts, tests, and plugins all import the same `cms` object — business logic, cache invalidation, and audit logging live in one place.

```ts
import { cms, auditFromRequest } from './sdk';
```

Conventions live in `docs/superpowers/specs/2026-04-28-cms-sdk-design.md`. The short version: **routes are HTTP shims, the SDK owns domain logic + side effects, repos are just SQL.**

---

## Quickstart

### From a route

Route handlers are now manifest-framework handlers (`defineRoute`). The SDK is used from the handler body; the framework shapes the response envelope automatically.

```ts
defineRoute({
    method: 'post', path: '/', auth: 'admin', summary: 'Create page',
    handler: async (ctx) => {
        const data = pageSchema.parse(ctx.req.body);
        const page = await cms.pages.create(data, auditFromRequest(ctx.req));
        return reply(page, { status: 201 });
    },
})
```

`auditFromRequest(req)` builds the `AuditContext` (user id, ip, user-agent) the SDK threads through writes for audit logging.

### From a script

```ts
import { closePool } from '../src/db/client';
import { cms } from '../src/sdk';

const ctx = { userId: 'system' }; // service-account writes

await cms.pages.create(
    { slug: 'about', title: 'About', status: 'published' },
    ctx,
);

await closePool();
```

See `backend/scripts/seed-fonts.ts` for a real example.

### From a future plugin

A plugin module is just code that imports `cms` and exposes its own functions / lifecycle hooks. The SDK is framework-free — no Express dependency, no globals leaking in.

```ts
import { cms, AuditContext } from '../sdk';

export async function publishWeeklyDigest(ctx: AuditContext) {
    const recent = await cms.posts.listPublic({}, { limit: 10 });
    // ...build a digest post...
    await cms.posts.create(digestData, ctx);
}
```

---

## Module index

Every capability follows the same shape: `list`, `getById`, `create(input, ctx)`, `update(id, patch, ctx)`, `remove(id, ctx)`. Capability-specific methods sit alongside.

<details>
<summary><strong>cms.pages</strong> — CMS pages (the catch-all <code>/{slug}</code> content type)</summary>

| Method | Purpose |
|---|---|
| `list(filters?, pagination?)` | Admin listing — every status, paginated. |
| `getById(id)` / `getBySlug(slug)` | Single-page lookups (published only). |
| `getBySlugAnyStatus(slug)` | Editor / preview lookup; ignores status. |
| `getHomepage(includeDrafts?)` | The page flagged `is_homepage`. |
| `getNavigation()` | Items marked `show_in_nav`. |
| `create(data, ctx)` / `update(id, patch, ctx)` / `remove(id, ctx)` | Standard writes. |
| `listBlocks(pageId, visibleOnly?)` | Page's structured blocks (with style hydration). |
| `createBlock` / `updateBlock` / `removeBlock` / `reorderBlocks` | Block CRUD. |

```ts
const page = await cms.pages.getBySlug('about');
await cms.pages.update(page.id, { showTitle: false }, ctx);
```
</details>

<details>
<summary><strong>cms.posts</strong> — blog / news posts</summary>

| Method | Purpose |
|---|---|
| `list(filters?, pagination?)` | Admin listing. Filters: status, search, sort. |
| `listPublic(filters?, pagination?)` | Public-gated listing (published, not private). Supports date / id / search filters. |
| `getById(id)` / `getBySlug(slug)` | Lookups (published only). |
| `getBySlugAnyStatus(slug)` | Admin preview, sees drafts. |
| `search(q, pagination?)` | Full-text search. |
| `create` / `update` / `remove` | Standard writes. |
| `listContentBlocks(postId)` / `saveContentBlocks(postId, blocks, ctx)` | Post body. |

```ts
const recent = await cms.posts.listPublic({}, { limit: 5 });
```
</details>

<details>
<summary><strong>cms.campaigns</strong> — fundraising campaigns + donations</summary>

| Method | Purpose |
|---|---|
| `list` / `listPublic` / `getById` / `getBySlug` | Reads. |
| `create` / `update` / `remove` | Writes. |
| `listDonationsForCampaign(campaignId, pagination?)` | Donations for a single campaign. |
| `listAllDonations(pagination?)` | Cross-campaign donation feed. |
| `donationSummary()` | Dashboard totals (count, sum, top contributors). |

```ts
const summary = await cms.campaigns.donationSummary();
```
</details>

<details>
<summary><strong>cms.forms</strong> — surveys / forms / poll builder</summary>

| Method | Purpose |
|---|---|
| `list` / `listPublished` / `getById` / `getBySlug` / `getBySlugPublished` | Reads. |
| `create` / `update` / `remove` | Form writes. |
| `listQuestions(formId)` / `createQuestion` / `updateQuestion` / `removeQuestion` | Question CRUD. |
| `listSubmissions(formId, pagination?)` | Submission feed. |

```ts
const form = await cms.forms.getBySlugPublished('reader-survey');
const submissions = await cms.forms.listSubmissions(form.id);
```
</details>

<details>
<summary><strong>cms.messages</strong> — contact form inbox</summary>

| Method | Purpose |
|---|---|
| `list(filters?, pagination?)` | Admin inbox. Returns `{ data, meta, unreadCount }`. |
| `getById(id)` | Single message. |
| `create({ name, email, subject?, message, userId?, ipAddress, userAgent? })` | Public submission (no `ctx` — the visitor IS the actor). |
| `updateStatus(id, status, ctx)` | Mark read / replied / archived / spam. |
| `remove(id, ctx)` | Delete. |
| `bulkUpdateStatus(ids, status, ctx)` / `bulkRemove(ids, ctx)` | Bulk admin ops. |
</details>

<details>
<summary><strong>cms.users</strong> — admin user management</summary>

`create` here is for service / sysadmin seeding. The public sign-up flow stays in `services/auth` because it carries security-sensitive checks (email verification, etc.) that don't belong in the plain-Node SDK.

| Method | Purpose |
|---|---|
| `list(filters?, pagination?)` / `getById` / `getWithMembership` | Reads. |
| `create({ email, password, displayName, role? }, ctx)` | Seed a user with an email/password credential. |
| `update(id, patch, ctx)` | Profile / role change. |
| `ban(userId, opts, ctx)` / `unban(userId, ctx)` | User-level bans (with reason + expiry). |
| `banIp(ipAddress, opts, ctx)` | IP-level bans. |
| `listBans(pagination?)` / `removeBan(banId, ctx)` | Ban admin. |
</details>

<details>
<summary><strong>cms.fonts</strong> — operator-uploaded font assets</summary>

| Method | Purpose |
|---|---|
| `list()` | All fonts with their public `url`. |
| `findFontById(id)` / `findFontByCustomId(customId)` | Lookups. |
| `create({ buffer, originalName, customId?, familyName? })` | Upload a font. Validates format, dedupes IDs, writes file + row. |
| `remove(id)` | Delete font + file. |

The frontend reads via the same shape (`services/fonts.ts`) and injects `@font-face` declarations on the public site so any uploaded font becomes usable as `font-family: '<customId>'`.

```ts
await cms.fonts.create({
    buffer: await fs.readFile('Caveat.woff2'),
    originalName: 'Caveat.woff2',
    customId: 'caveat',
    familyName: 'Caveat',
});
```
</details>

<details>
<summary><strong>cms.swatches</strong> — site color palette</summary>

Backed by `site_settings.site_colors` JSONB. Each entry: `{ id, hex, name? }`. Color values throughout the app can be `swatch:{id}` references — `usages()` finds them.

| Method | Purpose |
|---|---|
| `list()` | Current palette (auto-migrates legacy `string[]` storage). |
| `replace(swatches, ctx)` | Replace the palette. Validates hex + ID format, ensures unique IDs. |
| `usages(swatchId)` | Count `swatch:{id}` references across blocks / posts / styles / settings. |

```ts
const usage = await cms.swatches.usages('brand-red');
console.log(`Brand red used in ${usage.total} places`);
```
</details>

<details>
<summary><strong>cms.blockStyles</strong> — reusable block style templates</summary>

| Method | Purpose |
|---|---|
| `list()` / `getById` / `getByIds(ids)` / `getDefault()` | Reads. |
| `create(data, ctx)` / `update(id, patch, ctx)` / `remove(id, ctx)` | Writes. |
</details>

<details>
<summary><strong>cms.settings</strong> — JSONB key/value store</summary>

`site_settings` is the catch-all home for site-wide config (branding, appearance, header, footer, integrations). The SDK exposes it as a typed key/value store:

| Method | Purpose |
|---|---|
| `get<T>(key)` | Typed read. Returns `null` when absent. |
| `list()` | Every row. |
| `set(key, value, ctx)` | Upsert + cache invalidate + audit log. |
| `remove(key, ctx)` | Delete a key. |

```ts
const branding = await cms.settings.get<SiteBranding>('site_branding');
await cms.settings.set('site_branding', { ...branding, logo: newLogoUrl }, ctx);
```
</details>

---

## Common patterns

### Audit context

Every write takes `AuditContext = { userId, ipAddress?, userAgent? }`. From a route, build it with `auditFromRequest(req)`. From a script, use `{ userId: 'system' }` (or a real service-account UUID).

### Errors

The SDK throws typed errors from `middleware/error.ts`:

- `NotFoundError` → maps to 404 in routes
- `ValidationError` → 400
- `AuthError` → 401 / 403

Plugins / scripts catch them directly:

```ts
import { NotFoundError } from '../src/middleware/error';

try {
    await cms.pages.update(id, patch, ctx);
} catch (e) {
    if (e instanceof NotFoundError) { /* recover */ }
    else throw e;
}
```

### Cache + audit

Both happen automatically inside the SDK on every write. Plugins don't need to invalidate caches or log audit rows themselves — calling `cms.X.create(...)` is enough.

---

## What's NOT in the SDK yet

Tracked in the [design doc](../../../docs/superpowers/specs/2026-04-28-cms-sdk-design.md):

- `cms.media` — file upload pipeline (multer + sharp thumbnails) is large; bigger refactor needed.
- `cms.search` — currently a thin route wrapper around full-text repos.
- `cms.social` — connection management + post sync.
- Lifecycle event surface (`cms.pages.on('create', handler)`).
- Frontend SDK mirror.
- Plugin discovery + loader.

Capabilities migrate to the SDK as their routes need substantial work — no churn for the sake of churn.
