# MCP / SDK Deficiency Audit

Date: 2026-07-09
Context: while designing `@sitesurge/mcp` (the CMS MCP server) I audited the
`@sitesurge/client` SDK + API surface for gaps that would block an agent from
building an entire site. This records every finding, the decision, and where it
is addressed. Per the directive, genuine missing pieces are implemented **before**
the MCP tools that depend on them.

Legend: **FIX-SDK** (change the SDK/API), **FIX-MCP** (handle in the MCP layer),
**INTENTIONAL** (documented asymmetry, no change), **VERIFIED-OK** (no gap).

---

## Findings

### D1 — No machine-readable block-type schema — **FIX-MCP** ✅
There is no authoritative, machine-readable description of each block type's
fields (they live implicitly in the admin editor components). An agent cannot
know that a `campaign` block needs `settings.campaignId`, or that `hero`/`carousel`
uses the nested `HeroCarouselSettings` shape.
- **Done:** `packages/cms-mcp/src/catalog/blockTypes.ts` (`BLOCK_TYPE_CATALOG`) —
  authoritative per-type field schemas, defaults, container (settings vs content),
  page-only flags, and wiring notes; exposed via `describe_block_types`. Derived
  from `packages/cms/src/components/admin/blocks/types/*` + `shared/src/types/*`.
- Not put in `@sitesurge/types` on purpose: it is agent-facing documentation, not a
  runtime contract; keeping it MCP-local avoids coupling the shared package to
  editor UX. (Candidate to promote later if the admin wants to consume it.)

### D2 — Media upload requires a Blob — **FIX-MCP** ✅
`cms.media.upload(file: Blob)` / `blockUpload` / `fonts.upload` take a `Blob`. An
agent driving MCP tools has a **local path** or a **remote URL**, not a Blob.
- **Done:** `upload_media` and `upload_font` accept `path` or `url`; the MCP reads
  the file (Node `fs`) or fetches the URL, builds a `Blob`, and calls the SDK.
- Considered adding `cms.media.uploadFromUrl()` to the SDK (**FIX-SDK**) but chose
  not to: the SDK is deliberately a pure HTTP client with no filesystem/implicit
  fetch-of-arbitrary-URLs behavior. The convenience belongs in the MCP host.

### D3 — Group nesting is a multi-step workflow — **FIX-MCP** ✅
A usable `group` block requires creating the group **and** its `group_item` slots
(one per column); only then can a child be placed with `parentBlockId = slotId`.
The raw block API exposes the primitives but not the workflow.
- **Done:** `add_page_block` synthesizes the group + N `group_item` slots (N =
  `columns`, default 2), mirroring the admin `BlockEditor.addBlock`, and returns
  the slot ids so the agent can fill them. `describe_block_types` documents the
  group → group_item → child rule.

### D4 — Posts have no granular block CRUD — **INTENTIONAL** (handled FIX-MCP) ✅
Pages have `POST/PUT/DELETE /pages/:pageId/blocks[/:blockId]`. Posts do **not**;
post content blocks are set as a whole array on `create`/`update` (delete-all +
insert-all) plus `reorderBlocks`.
- **Decision: do not add granular post-block endpoints.** The declarative
  full-array model is a good fit for agent-driven generation (no stale-id
  hazards; the whole desired state is expressed at once) and is the established
  server pattern.
- **Handled in MCP:** `set_post_blocks` (declarative) plus ergonomic
  `add/update/delete_post_block` implemented via read-modify-write over the array.
  The agent gets both a declarative and an incremental interface with no API
  change.

### D5 — Post blocks are not nestable — **INTENTIONAL** ✅
`post_content_blocks` has no `parent_block_id`; groups/group_items are a pages-only
feature. This is a structural product choice (posts are linear articles).
- **Decision: not changed.** `describe_block_types` marks `group`/`group_item` as
  page-only; post block tools reject them with a clear message.

### D6 — Navigation is page-derived, no custom-link endpoint — **VERIFIED-OK / minor** ✅
Site navigation is computed from published pages (`showInNav`, `navOrder`,
`isHomepage`) via `GET /pages/navigation`; there is no separate "arbitrary
external nav link" store.
- **Decision: no change.** The MCP manages nav through page fields
  (`update_page`) and documents this in `get_navigation`. Arbitrary external
  header links are already expressible via the **site header** items
  (`text_link`/`button`), which the MCP fully covers — so no capability is
  actually missing.

### D7 — url_link block needs unfurl; url-preview existed but was unwired — **VERIFIED-OK** ✅
`url_link` blocks store `{ url, title, description, image, siteName }`. The
`POST /utils/url-preview` route + `cms.utils.urlPreview` (SSRF-guarded) already
exist (added earlier). The MCP exposes `url_preview` and documents using it to
populate `url_link` blocks.

### D8 — Block-style "templates" vs "shared style templates" terminology — **VERIFIED-OK** ✅
The "shared style templates" in the product = **block styles** with a `name`
(`cms.blockStyles.*`). A block references one via `style: { id }`, carries inline
overrides via `style: { ...fields }`, clears with `style: null`, or inherits with
`style` omitted. Fully covered by `list/create/update/delete_block_style` +
`apply_block_style`. No gap.

### D9 — Appearance / swatches / fonts / header / footer coverage — **VERIFIED-OK** ✅
All present on `cms.settings.*` (`getAppearance`/`appearance`,
`listSwatches`/`replaceSwatches`/`swatchUsages`, `getSiteHeader`/`siteHeader`,
`getSiteFooter`/`siteFooter`) and `cms.fonts.*`. Mapped 1:1 to MCP tools.

---

### D10 — Post content-block ids are not stable across writes — **INTENTIONAL** (handled FIX-MCP) ✅
Found during Phase C implementation. Because post blocks are saved by whole-array
replace (`DELETE … + INSERT …`), the backend assigns **new** ids on every write,
so a block id from one `get_post` is invalid after the next post write. (Page
block ids ARE stable — pages use granular per-block rows.)
- **Decision: not changed** (inherent to the delete-all/insert-all model; a fix
  would mean the granular post-block endpoints rejected in D4).
- **Handled in MCP:** every ergonomic post-block tool re-fetches inside its own
  read-modify-write, so it is self-consistent. The `MCP.md` authoring guide tells
  agents to re-`get_post` after any post write before referencing a block id.

### D11 — `PUT /settings/appearance` is a whole-object replace — **FIX-MCP** ✅
Found during Phase D. A partial appearance PUT clobbers unspecified fields.
- **Done:** `update_appearance` now does get → merge → put, giving the tool true
  partial-update semantics. (`update_site_header`/`update_site_footer`/`set_swatches`
  remain intentional whole-object replaces — documented in `MCP.md`; their configs
  are lists/trees where a merge would be ambiguous.)

## Net

The SDK is **comprehensive** for the MCP's needs — no route is missing for the
authoring goal. The genuine "missing pieces" are ergonomic/knowledge gaps best
solved in the MCP host (D1–D3) plus one intentional model asymmetry handled by
read-modify-write (D4). No SDK/API code change was required to unblock the build.
Should any real API blocker surface mid-implementation, it will be fixed in the
SDK first and appended here as **FIX-SDK** with the commit.

## Follow-ups (optional, not blocking)
- Promote `BLOCK_TYPE_CATALOG` into `@sitesurge/types` if the admin editor or docs
  site later want a single source of block-type truth.
- Consider `cms.media.uploadFromUrl()` in the SDK if non-MCP consumers ask for it.
- Consider granular post-block endpoints only if a real concurrent-editing need
  emerges (none today).
