# SiteSurge CMS — MCP Server Design & Implementation Plan

Date: 2026-07-09
Status: Approved (design) → In implementation

## Goal

Ship `@sitesurge/mcp` — a Model Context Protocol server that exposes the **entire**
SiteSurge CMS authoring surface as MCP tools, so an AI agent (Claude) can design
and build a complete site: pages, posts, every content-block type (and the
content inside them), block styles + shared style templates, appearance
(colors/swatches/fonts/layout), the site header, the site footer, navigation,
media, and every settings/feature option.

It is a thin, intelligent wrapper over the already-complete `@sitesurge/client`
SDK (236 routes, apiKey mode). The MCP server adds three things the raw SDK
cannot: **(1)** authoritative, machine-readable **block-type schemas** so the
agent knows the exact shape of every block; **(2)** **workflow ergonomics** for
the hard parts (group nesting, single-post-block edits, media-from-path/URL,
applying style templates); and **(3)** a curated, well-described, domain-grouped
**tool catalog** rather than 236 raw endpoints.

## Non-goals

- Re-implementing business logic already in the API/SDK.
- A public/multi-tenant server. This is a single-CMS, single-API-key server run
  locally (stdio) and pointed at one CMS instance.
- Replacing the admin UI. The MCP is a parallel authoring path via the same
  HTTP API, honoring the same auth/permissions (scoped `ssk_` API keys).

---

## 1. Architecture

```
packages/cms-mcp/                    @sitesurge/mcp
├── src/
│   ├── index.ts                     # entry: read env → createClient → start stdio server
│   ├── server.ts                    # MCP server, tool registry, dispatch, error mapping
│   ├── client.ts                    # env → createClient({ baseUrl, auth:{ apiKey } })
│   ├── catalog/
│   │   └── blockTypes.ts            # BLOCK_TYPE_CATALOG — authoritative per-type field schemas + defaults
│   ├── tools/
│   │   ├── index.ts                 # assemble all tool groups
│   │   ├── pages.ts                 # page CRUD + page-block CRUD + nesting + revisions
│   │   ├── posts.ts                 # post CRUD + post-block ops (read-modify-write) + revisions
│   │   ├── blockStyles.ts           # style templates CRUD + apply-to-block
│   │   ├── appearance.ts            # appearance, swatches, fonts
│   │   ├── layout.ts                # site header + site footer
│   │   ├── settings.ts              # settings get/update/keys, features (enable/disable/uninstall)
│   │   ├── media.ts                 # media list/get/update/delete + upload-from-path/URL
│   │   ├── navigation.ts            # navigation read + page-driven nav ordering
│   │   ├── reference.ts             # forms/campaigns/social/search/url-preview (block wiring)
│   │   └── blocks.ts                # shared block helpers: unified descriptor ↔ page/post shape
│   └── util/
│       ├── errors.ts                # SDK typed errors → MCP tool errors (isError + text)
│       ├── mcpText.ts               # JSON/text result envelope helpers
│       └── ids.ts                   # UUID generation (client-supplied block ids)
├── docs/
│   └── (none — the operator-facing README lives at docs/MCP.md)
├── package.json                     # deps: @sitesurge/client, @sitesurge/types, @modelcontextprotocol/sdk
├── tsconfig.json                    # stub → config/cms-mcp/tsconfig.json
└── README.md                        # package-level pointer to docs/MCP.md
```

**Transport:** stdio (the standard for a locally-run MCP server an agent spawns).
The transport layer is isolated in `server.ts`; if the official SDK is
unavailable the same tool registry is served by a ~150-line dependency-free
JSON-RPC-2.0-over-stdio shim (fallback only).

**Auth / config (env vars):**
- `CMS_BASE_URL` (required) — e.g. `https://cms.example.com` or `http://localhost:3001`.
- `CMS_API_KEY` (required) — a scoped `ssk_…` key (needs `write`/`admin` scope for authoring).
- `CMS_MCP_READONLY` (optional, `"true"`) — registers only read tools (safe exploration).
- `CMS_MCP_TIMEOUT_MS` (optional) — SDK request timeout override.

The server calls `createClient({ baseUrl, auth: { apiKey }, timeoutMs })`. Every
tool routes through the typed SDK; API-key auth means no CSRF/refresh. Admin-tier
and apiKey-tier routes accept the key; the key cannot manage other keys (by design).

**Result & error contract:**
- Success: MCP tool result with a `text` content block containing pretty JSON
  (the SDK's typed return), plus a one-line human summary.
- Failure: the SDK throws typed errors (`ValidationError`, `NotFoundError`,
  `ForbiddenError`, `UnauthorizedError`, `ConflictError`, `ContentLockedError`,
  `FeatureCascadeError`, …). `util/errors.ts` maps each to an MCP tool error
  (`isError: true`) with `code`, `message`, and — for `ValidationError` —
  `details.errors[]`, and for `FeatureCascadeError` the cascade plan. The agent
  gets actionable, structured failures.

---

## 2. The block model (the heart)

Two block systems exist; the MCP presents a **unified block descriptor** and maps
it to the correct wire shape per target.

### 2a. Page blocks (structured, nestable)
Wire shape (`PageBlockBody`): `{ id?, parentBlockId?, type, title?, content?,
settings?, order?, isVisible?, style? }`. Stored in the `blocks` table.
- `content` = rich-text/HTML body (rich_text, text, html blocks).
- `settings` = all type-specific fields (see catalog below).
- `style` = per-block style: **inline** `BlockStyle` fields, a **template ref**
  `{ id: "<blockStyleId>" }`, `null` (explicitly cleared), or omit (inherit).
- Nesting via `parentBlockId`: **group → group_item(s) → one child each**.
- Granular CRUD: `POST/PUT/DELETE /pages/:pageId/blocks[/:blockId]` + `reorderBlocks(pageId, {blockIds, parentBlockId})`.

### 2b. Post blocks (flat data-bag, non-nestable)
Wire shape (`PostCreateContentBlock`): `{ id?, type, sort_order, data }`, where
`data` holds content + settings fields together (plus optional `style`). Stored
in `post_content_blocks`. **No `parent_block_id`** → no groups in posts. Saved by
sending the full `contentBlocks` array on `create`/`update` (whole-set replace) +
`reorderBlocks(id, {blockIds})`.

### 2c. Unified block descriptor (MCP input)
The MCP accepts one descriptor and maps it:
```
BlockInput {
  id?: string            // client UUID (lets you reference before save; groups/nesting)
  type: BlockType
  title?: string         // → page: block.title; post: data.title
  content?: string       // → page: block.content; post: data.content (HTML body)
  settings?: object       // → page: block.settings; post: merged into data
  style?: object | {id} | null  // → block.style (page) / data.style (post)
  parentBlockId?: string | null // page only (nesting); ignored/omitted for posts
  isVisible?: boolean     // page only
}
```
Mapping is in `tools/blocks.ts`:
- **page**: identity to `PageBlockBody`.
- **post**: `{ id, type, sort_order, data: { ...settings, title, content, style } }`.

### 2d. BLOCK_TYPE_CATALOG (the missing machine-readable schema)
`catalog/blockTypes.ts` encodes, for **every** block type: label, description,
which container (settings vs content), the exact field set (name, type, required,
enum, default), sensible default data, whether it is page-only (group/group_item),
and wiring notes (e.g. campaign block needs a `campaignId` from `list_campaigns`).
This powers the `describe_block_types` tool and input validation. Source of truth
derived from the admin block editors (`packages/cms/src/components/admin/blocks/types/*`)
and `packages/shared/src/types/{content,hero,blockStyle}.ts`.

Catalog coverage (18 types): `rich_text`, `text`, `html`, `image`, `video`,
`document`, `url_link`, `hero`/`carousel` (HeroCarouselSettings), `post_list`,
`campaign`, `form`, `social`, `group`, `group_item`, `spacer`, plus legacy
`post`/`gallery` (marked deprecated, not offered for creation).

Group workflow encoded by the MCP: creating a `group` auto-creates N `group_item`
slots (N = `columns`, default 2), mirroring the admin. `add_page_block` for a
group returns the created group + slot ids so the agent can fill slots by setting
child `parentBlockId = <group_item id>`.

---

## 3. Tool catalog (feature set)

~55 tools, grouped. Read tools are always registered; write tools are gated by
`CMS_MCP_READONLY`. Names are snake_case verbs. Every tool ships a full JSON
Schema + a rich description (with wiring hints). `[R]` = read, `[W]` = write.

### Content — Pages
- `list_pages` [R] — filter status/search/sort, paginated.
- `get_page` [R] — by id **or** slug; returns page + full hydrated block tree (with ids, parentBlockId, order).
- `create_page` [W] — slug/title/SEO/status/homepage/nav/access/showTitle/publishAt.
- `update_page` [W] — partial.
- `delete_page` [W]; `bulk_pages` [W] — delete/status over ids.
- `add_page_block` [W] — unified BlockInput; auto-creates group slots; returns created id(s).
- `update_page_block` [W] — partial (incl. move via `parentBlockId`, restyle via `style`).
- `delete_page_block` [W]; `reorder_page_blocks` [W] — `{blockIds, parentBlockId?}` scoped per parent.
- `list_page_revisions` [R]; `restore_page_revision` [W].

### Content — Posts
- `list_posts` [R] (filters: tag/category/search/status/sort/before/after/withBlocks); `search_posts` [R].
- `get_post` [R] — by id/slug; returns post + contentBlocks.
- `create_post` [W] (with optional full `blocks`); `update_post` [W]; `delete_post` [W]; `bulk_posts` [W].
- `set_post_blocks` [W] — declarative full block array (whole-set replace).
- `add_post_block` / `update_post_block` / `delete_post_block` [W] — ergonomic single-block edits via read-modify-write over the array.
- `reorder_post_blocks` [W].
- `list_post_revisions` [R]; `restore_post_revision` [W].

### Blocks (meta)
- `describe_block_types` [R] — the catalog: all types or one type; fields, defaults, container, wiring notes, page-only flags.

### Block styles / shared templates
- `list_block_styles` [R]; `get_block_style` [R].
- `create_block_style` [W]; `update_block_style` [W]; `delete_block_style` [W].
- `apply_block_style` [W] — set a page/post block's `style` to `{id}` (template), inline fields, or null.

### Appearance
- `get_appearance` [R]; `update_appearance` [W] — colors/typography/layout (maps to `--site-*`).
- `list_swatches` [R]; `set_swatches` [W] (replace palette); `swatch_usages` [R].
- `list_fonts` [R]; `upload_font` [W] (from path/URL); `delete_font` [W].

### Site header & footer
- `get_site_header` [R]; `update_site_header` [W] — items (image/link/text/button/menu/gap/spacer), colors, spacing, gutter.
- `get_site_footer` [R]; `update_site_footer` [W] — rows → columns → items; enabled toggle, per-row/column styling.

### Settings & features
- `get_public_settings` [R]; `get_settings` [R] (admin, all keys); `get_setting` [R] (one key).
- `update_settings` [W] — name/description/logo/favicon/socialLinks/contactEmail/analytics/theme.
- `set_setting` [W] / `delete_setting` [W] — raw key (escape hatch for any setting blob).
- `list_features` [R]; `set_feature` [W] (enable/disable + cascade flags; surfaces FeatureCascadeError plan); `uninstall_feature` [W] (confirm-gated, drops tables/data).

### Navigation
- `get_navigation` [R] — computed nav. (Nav membership/order is managed via page fields `showInNav`/`navOrder`/`isHomepage` through `update_page`; documented in the tool description.)

### Media
- `list_media` [R]; `get_media` [R]; `update_media` [W] (title/alt/caption); `delete_media` [W].
- `upload_media` [W] — from a local file path **or** a remote URL (MCP reads/fetches → Blob → SDK). Returns the media id + url for block wiring.

### Reference & utility (for wiring blocks)
- `list_forms` [R]; `list_campaigns` [R]; `list_social_posts` [R] — ids/slugs to fill form/campaign/social blocks.
- `search_site` [R] — global search.
- `url_preview` [R] — unfurl a URL (title/description/image) for `url_link` blocks.
- `whoami` [R] — echoes base URL, key scope, readonly flag, feature availability (a fast connectivity/health check).

---

## 4. Deficiency audit (see `docs/mcp-sdk-deficiencies.md`)

Full audit lives in the deficiencies doc. Summary of the "implement first" pieces
(all confirmed genuine gaps for the stated goal); each is built **before** the
tools that depend on it:

1. **Block-type schema catalog** — no machine-readable per-type field schema
   existed. Built as `catalog/blockTypes.ts` (MCP-internal, authoritative).
2. **Media from path/URL** — the SDK upload takes a `Blob`; an agent has a path
   or URL. Handled in the MCP `upload_media`/`upload_font` (read/fetch → Blob).
3. **Group-nesting workflow** — creating usable groups requires group_item slot
   creation; encoded in the MCP so `add_page_block(group)` is one call.
4. **Single-post-block editing** — posts have no granular block endpoints;
   implemented via read-modify-write in the MCP (`add/update/delete_post_block`).

Asymmetries judged **intentional / not fixed** (documented, not code-changed):
post blocks are flat & non-nestable (no groups in posts); post block edits are
declarative-array rather than granular endpoints. Rationale in the deficiencies
doc. If implementation surfaces a true API/SDK blocker, it is fixed in the SDK
first and recorded there.

---

## 5. Implementation phases

Gates every phase: `npm run build` (ordered; cms-mcp builds after cms-client),
`npx tsc -p packages/cms-mcp/tsconfig.json --noEmit` (0), package unit tests
green, and a live smoke (`whoami` + a read tool + one write tool against the
running API on :3001). Commits path-scoped, no Co-Authored-By.

- **Phase A — Deficiency fixes + scaffold.** Create the package (`package.json`,
  config stubs, tsup/tsc build, root build order), install `@modelcontextprotocol/sdk`
  (fallback shim if unavailable), `client.ts`, `server.ts` (registry + dispatch +
  error mapping), `util/*`, and the `BLOCK_TYPE_CATALOG` + `describe_block_types`
  + `whoami`. Smoke: server starts, lists tools, `whoami` returns.
- **Phase B — Pages + blocks.** Page CRUD, page-block CRUD, group nesting,
  reorder, revisions. The richest phase; heavy tests on the block mapping + group
  workflow.
- **Phase C — Posts + blocks.** Post CRUD, declarative + ergonomic block ops,
  revisions.
- **Phase D — Styles + appearance + header/footer.** Block-style templates +
  apply; appearance/swatches/fonts; header/footer editors.
- **Phase E — Settings + media + navigation + reference.** Settings/features,
  media (incl. from path/URL), navigation, reference/search/url-preview/whoami.
- **Phase F — Docs + full verify.** `docs/MCP.md` (operator+dev reference of every
  tool with examples), package `README.md`, main `README.md` mention, CLAUDE.md
  note. End-to-end smoke: build a small demo page (hero + group of two text
  blocks + a posts block), style it, set a swatch, tweak the header — entirely
  through MCP tools against the live API; then tear the demo down.

## 6. Testing strategy

- **Unit** (vitest, in-package): block descriptor ↔ page/post mapping;
  group-slot synthesis; catalog completeness (every `BlockType` present, no
  unknown fields); error mapping; env/config parsing. SDK calls mocked at the
  client boundary.
- **Live smoke** (manual, side-port): a scripted MCP session (spawn server,
  `tools/list`, call read + write tools) against `:3001` with a seeded `ssk_` key.
  Verifies real wire behavior for the block CRUD + group nesting + a settings
  round-trip. Documented in `docs/MCP.md` under "Verifying".

## 7. Open decisions (resolved)

- **Tool granularity:** curated, domain-grouped, richly-described tools (~55) —
  NOT 1:1 with 236 routes. Rationale: agent usability + the block/style/appearance
  workflows need composition the raw endpoints don't express.
- **Transport:** stdio, official `@modelcontextprotocol/sdk`; dependency-free
  fallback shim retained behind the same registry.
- **Auth:** single `ssk_` API key via env (apiKey mode). Read-only mode gates
  write tools.
- **Block input:** one unified descriptor mapped per target; catalog documents
  per-type fields. Pages get nesting; posts are flat (documented).
