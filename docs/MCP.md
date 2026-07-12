# SiteSurge CMS — MCP Server (`@sitesurge/mcp`)

Operator + developer reference for the CMS Model Context Protocol server.

## 1. Overview

`@sitesurge/mcp` is a stdio MCP server that exposes the **entire SiteSurge authoring
surface** — pages, posts, every content-block type, block styles, appearance
(colors/swatches/fonts/layout), the site header + footer, navigation, media, and
settings/features — as **66 curated MCP tools** an AI agent can call to design and
build a whole site.

It is a thin, intelligent wrapper over the `@sitesurge/client` SDK. Every tool routes
through the typed client using **apiKey auth** (a scoped `ssk_…` key), over
**stdio** (the standard transport for a locally-spawned MCP server). The three
things it adds over the raw SDK:

1. **Authoritative block schemas** — `describe_block_types` returns a
   machine-readable field spec for every block type (fields, defaults, where data
   lives, wiring notes), so the agent knows the exact shape of every block.
2. **Workflow ergonomics** — group nesting, single-post-block edits (read-modify-
   write), media-from-path-or-URL, applying style templates — composed into single
   tool calls the raw endpoints don't express.
3. **A curated, domain-grouped catalog** — 66 well-described tools rather than 236
   raw routes.

It honors the same auth/permissions as the admin UI (scoped keys); it is a parallel
authoring path over the same HTTP API. Single-CMS, single-key, run locally.

## 2. Setup & configuration

### Environment variables

| Name | Required | Purpose |
|------|----------|---------|
| `CMS_BASE_URL` | **yes** | CMS base URL, e.g. `https://cms.example.com` or `http://localhost:3001`. |
| `CMS_API_KEY` | **yes** | A scoped `ssk_…` API key. Needs **write/admin** scope to author; **read** scope for read-only exploration. |
| `CMS_MCP_READONLY` | no | `"true"` → only read tools are registered (write tools are skipped entirely). |
| `CMS_MCP_TIMEOUT_MS` | no | SDK request timeout override, in milliseconds. |

Missing `CMS_BASE_URL` or `CMS_API_KEY` fails fast at startup with a clear error.

### Minting a scoped API key

In the admin UI: **Settings → API Keys → issue a key**. Keys are `ssk_…`, shown
once, hashed at rest, revocable. Scope hierarchy is `read < write < admin`:

- **read** — enough for `CMS_MCP_READONLY=true` exploration.
- **write** (or **admin**) — required to author (create/update/delete).
- A key **cannot manage other API keys** (by design) — there are no key-management
  tools in this server.

### Running

Build the package, then run the binary (stdio; JSON-RPC on stdout, logs on stderr):

```bash
npm run build -w packages/cms-mcp        # builds dist/
CMS_BASE_URL=http://localhost:3001 CMS_API_KEY=ssk_… cms-mcp
# or, equivalently:
CMS_BASE_URL=http://localhost:3001 CMS_API_KEY=ssk_… node packages/cms-mcp/dist/index.js
```

`cms-mcp` is the package `bin` (→ `dist/index.js`). For local dev without a build,
`npm run dev -w packages/cms-mcp` runs `tsx src/index.ts`.

### Registering with an MCP client

Add an `mcpServers` entry (Claude Desktop / Claude Code style):

```json
{
  "mcpServers": {
    "sitesurge-cms": {
      "command": "node",
      "args": ["/abs/path/to/rw-cms/packages/cms-mcp/dist/index.js"],
      "env": {
        "CMS_BASE_URL": "http://localhost:3001",
        "CMS_API_KEY": "ssk_your_scoped_key"
      }
    }
  }
}
```

The server identifies itself as `sitesurge-cms` (v`0.1.0`). Add
`"CMS_MCP_READONLY": "true"` to the `env` for a safe read-only session.

## 3. Getting started workflow

Recommended agent flow: **probe → learn → author.**

1. **`whoami`** — confirm connectivity + which features are enabled. Returns the
   base URL, an API-key preview, `readonly`, `connected`, `siteName`, and the
   `features` map. Run this first.
2. **`describe_block_types`** — learn the exact shape of the blocks you'll author
   (omit `type` for the full catalog; pass a `type` for one block's detail).
3. **Author** — pages/posts + blocks + styles + appearance.

### Worked example — a small page

```jsonc
// 1. whoami  → { connected: true, siteName: "...", features: { posts: {...}, ... } }
// 2. describe_block_types  → catalog of block fields

// 3. create the page
create_page { "slug": "about", "title": "About Us", "status": "published" }
// → { id: "<pageId>", ... , blocks: [] }

// 4. add a hero (settings fields are flat; merged over catalog defaults)
add_page_block {
  "pageId": "<pageId>", "type": "hero",
  "settings": { "items": [ /* HeroItem[] — see describe_block_types */ ],
                "options": { "height": "480px" } }
}

// 5. add a 2-column group — this AUTO-CREATES 2 group_item slots
add_page_block { "pageId": "<pageId>", "type": "group", "settings": { "columns": 2 } }
// → { group: { id: "<groupId>", ... }, slots: [ { id: "<slotA>" }, { id: "<slotB>" } ] }

// 6. fill each slot (parentBlockId = a slot id; one child per slot)
add_page_block { "pageId": "<pageId>", "type": "rich_text",
                 "content": "<p>Left column.</p>", "parentBlockId": "<slotA>" }
add_page_block { "pageId": "<pageId>", "type": "rich_text",
                 "content": "<p>Right column.</p>", "parentBlockId": "<slotB>" }

// 7. add a posts block
add_page_block { "pageId": "<pageId>", "type": "post_list",
                 "settings": { "count": 6, "brevity": "short" } }

// 8. make + apply a shared style template
create_block_style { "name": "Callout", "backgroundColor": "swatch:brand", "padding": "24px" }
// → { id: "<styleId>" }
apply_block_style { "target": "page", "pageOrPostId": "<pageId>",
                    "blockId": "<groupId>", "style": { "id": "<styleId>" } }

// 9. set a brand swatch (WHOLE-PALETTE replace — list_swatches first!)
list_swatches  // → keep everything you want
set_swatches { "swatches": [ { "id": "brand", "hex": "#e63946", "name": "Brand Red" } ] }
```

> **Flat block args:** `add_page_block` takes flat top-level fields
> (`pageId`, `type`, `content?`, `settings?`, `style?`, `parentBlockId?`,
> `isVisible?`, `order?`, `id?`) — **not** a nested `block` object. `settings` is
> merged over the type's catalog defaults; `content` is the HTML body used by
> `rich_text`/`text`/`html`.

## 4. Content authoring guide

### Pages vs Posts blocks

| | **Pages** | **Posts** |
|--|-----------|-----------|
| Structure | Structured + **nestable** | **Flat**, non-nestable |
| Block fields | `title` / `content` / `settings` / `style` (top-level) | one `data` bag holding content + settings + style |
| Groups | `group` → `group_item` → one child each | **No groups** (`group`/`group_item` rejected) |
| Editing | Granular CRUD endpoints | declarative array (`set_post_blocks`) **or** incremental read-modify-write (`add`/`update`/`delete_post_block`) |
| Block ids | **Stable** across writes | **NOT stable** (regenerated on each whole-array save) |

> **⚠ CRITICAL — post block ids are not stable.** The backend replaces a post's
> content blocks as a **whole array** (delete-all + insert-all) on every write, and
> regenerates their ids. After ANY post write, **re-`get_post`** before referencing
> a block id. Page block ids ARE stable — get them once from `get_page` and reuse.

### Group nesting (pages only)

`add_page_block` with `type: "group"` auto-creates `columns` (default 2, clamped
1–16) `group_item` slots and returns `{ group, slots: [{ id, block }] }`. Fill each
slot by calling `add_page_block` again with `parentBlockId = <slot id>`. **Each slot
holds exactly one child.** Deleting a group removes its slots (and their children);
deleting a slot removes its held child. Move a block between slots with
`update_page_block` (`parentBlockId`); reorder within one parent with
`reorder_page_blocks` (scoped by `parentBlockId`).

### Block styles / shared templates

A **block style template** is a reusable named `BlockStyle` row
(`create_block_style` — `name` required, all visual fields optional). A block's
`style` field is one of:

- **template ref** `{ "id": "<blockStyleId>" }` — reference a template (edits
  cascade to every referencing block);
- **inline** `{ backgroundColor, textColor, padding, … }` — one-off styling;
- **`null`** — explicitly clear;
- **omitted** — inherit.

Set it via `apply_block_style` (`target: "page" | "post"`) or via the block's own
`style` field on `add_page_block`/`update_page_block`. Color fields accept a raw hex
**or** a `swatch:{id}` reference; `swatch:{id}` values track the swatch palette
(`list_swatches` / `set_swatches` / `swatch_usages`), so editing a swatch cascades.

### Wiring reference blocks

Some blocks reference an existing entity by id/url — look them up first:

| Block | Needs | Lookup tool |
|-------|-------|-------------|
| `campaign` | `settings.campaignId` (or `"__all-campaigns__"`) | `list_campaigns` |
| `form` | `settings.formId` | `list_forms` |
| `social` | `provider` + optional post ids | `list_social_posts` |
| `post_list` | `settings.pinnedPostIds` | `list_posts` / `search_posts` |
| `url_link` | `url` + preview fields | `url_preview` (unfurls title/description/image) |

### Media

`upload_media` accepts **exactly one** of a local `path` OR a remote `url` (the MCP
reads/fetches → Blob → SDK), plus optional `alt`/`caption`. It returns the media
`id` + `url` — put those into `image` / `video` / `document` / `hero` block fields
(see `describe_block_types` for each field). `upload_font` works the same way for
`@font-face` fonts.

### Block-type catalog (18 types)

Full field detail is in `describe_block_types`. Summary:

| Type | Container | Key fields |
|------|-----------|-----------|
| `rich_text` | content | HTML body (primary text block) |
| `text` | content | plain text (legacy; prefer `rich_text`) |
| `html` | content | raw HTML embed (sanitized) |
| `image` | settings | `images[]` (ImageItem: url/mediaId/alt/caption/link/allowMaximize), `direction`, item min/max width+height |
| `video` | settings | `url`, `mediaId?`, `maxWidth`, `maxHeight`, `autoplay`, `loop` |
| `document` | settings | `url`, `fileName`, `fileSize`, `mimeType`, `mediaId?` |
| `url_link` | settings | `url`, `title`, `description`, `image`, `siteName` |
| `hero` / `carousel` | settings | `items[]` (HeroItem: media/header/subheader/action), `options` (autoScroll/height/…) |
| `post_list` | settings | `pinnedPostIds`, `queryEnabled`, `count`, `brevity`, show flags, `query`, before/afterDaysAgo |
| `campaign` | settings | `campaignId` (or `"__all-campaigns__"`), `sortBy`, `sortOrder`, `direction` |
| `form` | settings | `formId`, `title?` |
| `social` | settings | `provider`, `items[]` (pinned slots), `count`, `layout`, `showComments` |
| `group` | settings | **page-only** — `direction`, `columns`, `gap`, `wrap`, `align`, `justify`, item sizes |
| `group_item` | settings | **page-only** — one slot; `width`/`height`/`alignSelf` |
| `spacer` | settings | `height` (default `60px`) |
| `post` | settings | **deprecated** — use `post_list` with one pinned id |
| `gallery` | settings | **deprecated** — use multi-image `image` |

Container: `content` = fields go in the HTML body; `settings` = fields go in the
block's settings (pages) / `data` bag (posts). Deprecated types cannot be created.

## 5. Tool reference (66 tools)

`R` = read-only. `W` = write (skipped when `CMS_MCP_READONLY=true`). All returns are
pretty-printed JSON (the SDK's typed value); paginated lists return `{ data, meta }`
with `meta = { page, limit, total, totalPages }`.

### Meta (2)

| Tool | R/W | Key params | Does |
|------|-----|-----------|------|
| `describe_block_types` | R | `type?` | Authoritative block-type catalog (fields/defaults/container/wiring). Omit `type` for all. |
| `whoami` | R | — | Connectivity + capability probe: base URL, key preview, readonly, `connected`, `siteName`, enabled `features`. |

### Pages (12)

| Tool | R/W | Key params | Does |
|------|-----|-----------|------|
| `list_pages` | R | `status?`, `search?`, `sort?`, `page?`, `limit?` | List pages (any status), paginated. |
| `get_page` | R | `id` **xor** `slug`, `preview?` | One page **with** its full hydrated block tree (stable block ids). `preview="admin"` reveals unpublished (slug fetch). |
| `list_page_revisions` | R | `id` | Saved page revisions (newest first); each has a `version`. |
| `create_page` | W | `slug`, `title`, SEO/status/nav/access fields | Create a page (no blocks yet). |
| `update_page` | W | `id`, any create field | Partial page update; manages nav via `showInNav`/`navOrder`/`isHomepage`. |
| `delete_page` | **W** (destructive) | `id` | Delete a page and its blocks. |
| `bulk_pages` | **W** (destructive) | `ids`, `action` (`delete`/`status`), `value?` | Bulk delete or set status over page ids. |
| `add_page_block` | W | `pageId`, `type`, `content?`, `settings?`, `style?`, `parentBlockId?`, `isVisible?`, `order?`, `id?` | Add a block; `settings` merged over defaults. `type:"group"` auto-creates slots → `{ group, slots }`. `parentBlockId` places in a slot. |
| `update_page_block` | W | `pageId`, `blockId`, partial fields | Partial block update; MOVE via `parentBlockId`, RESTYLE via `style`. |
| `delete_page_block` | **W** (destructive) | `pageId`, `blockId` | Delete a block (groups cascade to slots/children). |
| `reorder_page_blocks` | W | `pageId`, `blockIds`, `parentBlockId?` | Reorder within one parent (scoped by `parentBlockId`, null = top-level). |
| `restore_page_revision` | W | `id`, `version` | Roll a page back to a revision. |

### Posts (14)

| Tool | R/W | Key params | Does |
|------|-----|-----------|------|
| `list_posts` | R | `status?`, `sort?`, `tag?`, `category?`, `search?`, `before?`, `after?`, `ids?`, `withBlocks?`, `page?`, `limit?` | List posts. Anon → published only; `status`/`sort` → admin all-statuses. |
| `search_posts` | R | `q`, `page?`, `limit?` | Full-text search over published posts. |
| `get_post` | R | `id` **xor** `slug`, `preview?` | One post **with** content blocks (`{ id, type, sortOrder, data }`). `preview="admin"` reveals unpublished. |
| `list_post_revisions` | R | `id` | Saved post revisions (newest first). |
| `create_post` | W | `slug`, `title`, `excerpt?`, SEO/status/tags/access, `blocks?` | Create a post; optional `blocks[]` become content blocks in order. |
| `update_post` | W | `id`, partial fields, `blocks?` | Partial post update; `blocks` (if passed) REPLACE the whole set. |
| `delete_post` | **W** (destructive) | `id` | Delete a post and its blocks. |
| `bulk_posts` | **W** (destructive) | `ids`, `action`, `value?` | Bulk delete / set status over post ids. |
| `set_post_blocks` | W | `id`, `blocks` | DECLARATIVE whole-array replace of content blocks. |
| `add_post_block` | W | `id`, `block`, `index?` | Add one block (read-modify-write; re-sequences). |
| `update_post_block` | W | `id`, `blockId`, partial fields | Update one block by id (read-modify-write; `settings` shallow-merges). |
| `delete_post_block` | **W** (destructive) | `id`, `blockId` | Drop one block by id (read-modify-write). |
| `reorder_post_blocks` | W | `id`, `blockIds` | Reorder content blocks (flat — no parent scope). |
| `restore_post_revision` | W | `id`, `version` | Roll a post back to a revision. |

> After any post-block write, re-`get_post` before reusing a block id (ids are
> regenerated).

### Blocks / Styles (6)

| Tool | R/W | Key params | Does |
|------|-----|-----------|------|
| `list_block_styles` | R | — | All shared block-style templates. |
| `get_block_style` | R | `id` | One template. |
| `create_block_style` | W | `name`, visual fields | Create a reusable template → returns `id`. |
| `update_block_style` | W | `id`, partial fields (null clears) | Update a template (cascades to referencing blocks). |
| `delete_block_style` | **W** (destructive) | `id` | Delete a template; referencing blocks fall back to inherited/inline. |
| `apply_block_style` | W | `target` (`page`/`post`), `pageOrPostId`, `blockId`, `style` | Set a block's `style`: `{ id }` ref, inline fields, or `null`. Posts via read-modify-write. |

### Appearance (7)

| Tool | R/W | Key params | Does |
|------|-----|-----------|------|
| `get_appearance` | R | — | Public appearance (colors/typography/layout → `--site-*`). |
| `list_swatches` | R | — | The color-swatch palette (`{ id, hex, name? }[]`). |
| `swatch_usages` | R | `id` | Count references to a swatch (`{ total, breakdown }`). Check before removing. |
| `list_fonts` | R | — | Custom uploaded fonts with `@font-face` source URLs. |
| `update_appearance` | W | any color/typography/layout field | **Partial** update (merges over current appearance). Colors accept hex or `swatch:{id}`. |
| `set_swatches` | W | `swatches[]` | **WHOLE-PALETTE replace** — list first, include everything to keep. |
| `upload_font` | W | `path` **xor** `url`, `familyName?`, `customId?` | Upload a font from path/URL → Blob → SDK. |
| `delete_font` | **W** (destructive) | `id` | Delete a custom font (file + row). |

### Header / Footer (4)

| Tool | R/W | Key params | Does |
|------|-----|-----------|------|
| `get_site_header` | R | — | Header config: `items[]` (image/link/text/button/menu/gap/spacer), colors, spacing, gutter. |
| `get_site_footer` | R | — | Footer config: `enabled`, `rows` → `columns` → `items`, styling. |
| `update_site_header` | W | `header` | **WHOLE-OBJECT replace** — get first, modify, put back. |
| `update_site_footer` | W | `footer` | **WHOLE-OBJECT replace** — get first, modify, put back. |

**Header dropdown menus.** A header item of `type: "menu"` renders as a hover/focus
dropdown when given a `children: SiteHeaderItem[]` array (each child is itself a
header item, typically `text_link`, with its own `text`/`url`/`order`). The menu's
own `url` stays clickable (top-level nav), and the children appear beneath it
(desktop dropdown / mobile indented sub-links). Example:
`{ type: "menu", text: "About", url: "/about", children: [ { type: "text_link", text: "Our Mission", url: "/about/our-mission", order: 0 }, … ] }`.
Footer items do not support `children` (footer links are flat).

### Settings / Features (9)

| Tool | R/W | Key params | Does |
|------|-----|-----------|------|
| `get_public_settings` | R | — | Curated public settings + `features` map. |
| `get_settings` | R | — | ALL settings rows (admin), keyed by setting key. |
| `get_setting` | R | `key` | One settings row (reads all, picks the key). |
| `list_features` | R | — | Flat `[{ key, enabled }]` for every feature module. |
| `update_settings` | W | `siteName?`, `siteDescription?`, `logo?`, `favicon?`, `socialLinks?`, `contactEmail?`, `analytics?`, `theme?` | Partial site-config update (does NOT toggle features). |
| `set_setting` | W | `key`, `value` | Raw settings-row write (escape hatch; stored verbatim). |
| `delete_setting` | **W** (destructive) | `key` | Delete a raw settings row. |
| `set_feature` | W | `feature`, `enabled`, `enableDependencies?`, `disableDependents?` | Enable/disable a feature; may run migrations; surfaces a cascade plan on rejection. |
| `uninstall_feature` | **W** (DESTRUCTIVE, IRREVERSIBLE) | `feature` | **DROPS the feature's tables + DELETES all its data.** Not the same as disabling. |

### Media (5)

| Tool | R/W | Key params | Does |
|------|-----|-----------|------|
| `list_media` | R | `type?`, `search?`, `sort?`, `page?`, `limit?` | List media assets (paginated). |
| `get_media` | R | `id` | One media asset (url/type/dimensions/thumbnails). |
| `upload_media` | W | `path` **xor** `url`, `alt?`, `caption?` | Upload from local path or remote URL → returns `id` + `url` for block wiring. |
| `update_media` | W | `id`, `title?`, `alt?`, `caption?` | Partial metadata update (file unchanged). |
| `delete_media` | **W** (destructive) | `id` | Delete a media asset (file + row). |

### Navigation (1)

| Tool | R/W | Key params | Does |
|------|-----|-----------|------|
| `get_navigation` | R | — | Computed main nav (`NavigationItem[]`). Nav is **derived** — change it via page `showInNav`/`navOrder`/`isHomepage` (`update_page`); external links via `update_site_header`. |

### Reference (5)

| Tool | R/W | Key params | Does |
|------|-----|-----------|------|
| `list_forms` | R | `search?`, `page?`, `limit?` | Form `id`/`slug`/`title`/`status` — wire a `form` block. |
| `list_campaigns` | R | `search?`, `page?`, `limit?` | Campaign `id`/`slug`/`title`/`status` — wire a `campaign` block. |
| `list_social_posts` | R | `platform?`, `page?`, `limit?` | Synced social posts (`id`/`platform`/`externalId`/…) — wire a `social` block. |
| `search_site` | R | `q`, `page?`, `limit?` | Global admin search across posts/pages/campaigns (grouped hits). |
| `url_preview` | R | `url` | Unfurl a URL → `{ title?, description?, image?, siteName? }` (SSRF-guarded) — pre-fill a `url_link` block. |

## 6. Behavior & gotchas

- **Partial vs whole-object writes:**
  - **Partial (merge):** `update_page`, `update_post`, `update_media`,
    `update_settings`, `update_block_style`, `update_page_block`,
    `update_post_block`, and **`update_appearance`** (the MCP reads current
    appearance and merges your fields before the backend's whole-object PUT).
  - **Whole-object replace — get first, modify, put back:** `update_site_header`,
    `update_site_footer`, and **`set_swatches`** (replaces the ENTIRE palette —
    `list_swatches` first and include every swatch you want to keep).
- **Post block ids are not stable** — re-`get_post` after any post write (see §4).
- **Feature enable can cascade.** `set_feature` may run lazy-install migrations on
  enable, or require dependents off on disable. A rejected toggle returns a
  structured cascade error (409) carrying the plan on `cascade`; retry with
  `enableDependencies: true` (add prerequisites) or `disableDependents: true`.
- **`uninstall_feature` is destructive and irreversible** — it drops the feature's
  tables and deletes all its data. Disabling (`set_feature enabled:false`) only
  hides it. Only use on explicit operator intent.
- **Errors are structured.** A thrown SDK error becomes a tool result with
  `isError: true` and a JSON payload: `{ error, message, code?, status?, details?,
  cascade? }`. `ValidationError` carries `details.errors[]`; `FeatureCascadeError`
  carries the plan on `cascade` — the agent can self-correct from these.
- **Deprecated / page-only blocks are rejected:** `post`/`gallery` can't be
  created; `group`/`group_item` are rejected on post targets.
- **`path` xor `url`** — `upload_media` and `upload_font` require **exactly one** of
  `path` or `url`. Same for `get_page`/`get_post` (`id` xor `slug`).
- **Read-only mode** (`CMS_MCP_READONLY=true`) registers only read tools; write
  tools are not exposed at all.

## 7. Verifying

**Unit tests** (block mapping, group-slot synthesis, catalog completeness, error
mapping, config parsing; SDK mocked at the client boundary):

```bash
npm test -w packages/cms-mcp
```

**Live smoke:** spawn the built server over stdio from an MCP client and call
`whoami` (confirms base URL + connectivity + enabled features), then a read tool
(e.g. `list_pages` or `describe_block_types`). With a write-scoped key against a
running API (`:3001`), a `create_page` → `add_page_block` → `delete_page`
round-trip exercises the block CRUD + group nesting end-to-end.
