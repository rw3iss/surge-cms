# Block-Type Registry — Implementation Plan

> **For agentic workers:** Execute this with the `superpowers:subagent-driven-development` skill — the tasks are independent-ish and sequential, each ending in a green build + test checkpoint and a commit. Do NOT batch tasks; land one at a time and verify SSR output parity before moving on. Read `superpowers:test-driven-development` before Task 5 (the coverage guard).

## Goal

Converge the backend's per-consumer block-type `switch`/dispatch code onto ONE block-type catalog (the enumeration) with **per-consumer render registries** (the strategies). Today block types are enumerated independently in three places:

1. **SSR/SEO body renderer** — `packages/api/src/services/ssr/bodyBuilder.ts` `renderBlockForSeo()` (a `switch (block.type)` at ~line 155).
2. **Email renderer** — `packages/api/src/services/mail/blocks/index.ts` — **already a clean per-type renderer registry** (`RENDERERS: Record<string, BlockEmailRenderer>`). This is the pattern to mirror; the only change here is retyping its key to the shared catalog and adding a coverage guard.
3. **SSR route resolver** — `packages/api/src/services/ssr/routes.ts` — consumes `buildPageBody`/`buildPostBody` and fetches the flat block rows; no per-type `switch` of its own, but it is the caller that feeds the SSR body renderer and must keep working unchanged.

Adding a new block type today means editing the SSR switch by hand (and it silently no-ops for anything not enumerated). After this change, a new `BlockType` is added once to the shared catalog and the compiler + a coverage test force every consumer registry to declare a strategy for it (even if that strategy is "not indexable").

## Architecture

- **Shared catalog (enumeration only)** lives in `@sitesurge/types`: a runtime `ALL_BLOCK_TYPES: readonly BlockType[]` array derived from — and exhaustively checked against — the existing `BlockType` union in `packages/shared/src/types/content.ts`. It carries no rendering logic (mail HTML tables and SSR semantic HTML depend on api-only utils like `sanitize`), so it stays framework-free and importable by every package. Decision rationale: the *type union* already lives in shared; adding a *value* array there (with a compile-time exhaustiveness assertion) gives both mail + ssr — and any future consumer — one list to iterate for coverage, without leaking api concerns into shared.
- **Per-consumer render registries** each map `Record<BlockType, Strategy>`:
  - **Mail** (`services/mail/blocks/`): already exists as `RENDERERS`. Retype its key from `string` to `BlockType`, key it exhaustively, done.
  - **SSR** (`services/ssr/blocks/`, NEW): mirror the mail folder shape — an `index.ts` exporting the `SsrBlockRenderer` type + a fully-populated `SSR_BLOCK_RENDERERS` registry + a `renderBlockForSeo(block)` dispatcher, plus small per-type strategy files for the content-emitting types and two shared sentinel strategies for the non-emitting ones.
- **A new type registers once**: add it to the `BlockType` union → `ALL_BLOCK_TYPES` fails to compile until you add the value → the coverage test fails until each registry has an entry. No consumer can silently ignore it.
- **Additive plumbing, output-preserving**: every strategy reproduces the *exact* bytes the current `switch` arm emits. This is a refactor, not a behavior change.

## Tech Stack

- TypeScript (Node, `@sitesurge/server` = `packages/api`), `@sitesurge/types` = `packages/shared`.
- Vitest (`config/api/vitest.config.ts`). Current suite: **108 tests** — must stay green.
- Existing helpers reused verbatim: `utils/sanitize.ts` `sanitize()`, the local `escapeHtml`/`isoToReadable` in `bodyBuilder.ts`.
- Build: `pnpm --filter @sitesurge/server build`. Test: `pnpm --filter @sitesurge/server test`. Shared must build first when its types change: `pnpm --filter @sitesurge/types build`.

---

## Coverage table — block type × consumer

Derived from the current `switch (block.type)` in `bodyBuilder.ts` (SSR) and `RENDERERS` in `mail/blocks/index.ts` (email). "SSR body" column shows what `renderBlockForSeo` emits **today**; note the two distinct no-op forms — a **comment** (`<!-- <type> block (not server-rendered) -->`, from the explicit dynamic-block case) vs an **empty string** (from the `default:` fallthrough). Preserving that distinction is a correctness requirement.

| BlockType     | SSR body today                          | Email today (`RENDERERS`)     | SSR target strategy        | Email target |
|---------------|-----------------------------------------|-------------------------------|----------------------------|--------------|
| `rich_text`   | sanitized `<div>`                       | `renderRichText`              | `richText` emitter         | keep         |
| `text`        | sanitized `<div>` (same arm)            | `renderRichText`              | `richText` emitter         | keep         |
| `html`        | raw `<div>` (unsanitized, same arm)     | `renderHtml`                  | `richText`/html emitter*   | keep         |
| `hero`        | `<section>` h2/p/content                | `renderHero`                  | `hero` emitter             | keep         |
| `image`       | `<img>`                                 | `renderImage`                 | `image` emitter            | keep         |
| `document`    | `<a>` download link                     | `renderDocument`              | `document` emitter         | keep         |
| `url_link`    | `<a>` link                              | `renderUrlLink`               | `urlLink` emitter          | keep         |
| `form`        | **comment** (not rendered)              | `renderForm`                  | `NOT_INDEXABLE` (comment)  | keep         |
| `social`      | **comment**                             | `renderSocial`                | `NOT_INDEXABLE` (comment)  | keep         |
| `post_list`   | **comment**                             | `renderPostList`              | `NOT_INDEXABLE` (comment)  | keep         |
| `carousel`    | **comment**                             | `renderCarousel`              | `NOT_INDEXABLE` (comment)  | keep         |
| `gallery`     | **comment**                             | `renderImage` (legacy→image)  | `NOT_INDEXABLE` (comment)  | keep         |
| `campaign`    | **comment**                             | `renderCampaign`              | `NOT_INDEXABLE` (comment)  | keep         |
| `post`        | **comment**                             | `renderPostList` (legacy)     | `NOT_INDEXABLE` (comment)  | keep         |
| `spacer`      | **comment**                             | `renderSpacer`                | `NOT_INDEXABLE` (comment)  | keep         |
| `video`       | **empty string** (`default:`) ⚠️ gap    | `renderVideo`                 | `NOT_RENDERED` (empty)     | keep         |
| `group`       | **empty string** (`default:`) ⚠️ gap    | `renderGroup` (recurses)      | `NOT_RENDERED` (empty)     | keep         |
| `group_item`  | **empty string** (`default:`) ⚠️ gap    | `() => ''` (parent renders)   | `NOT_RENDERED` (empty)     | keep         |

\* `html` shares the `rich_text`/`text` arm but branches internally: `block.type === 'html' ? html : sanitize(html)` (html is emitted raw/unsanitized). The SSR emitter must keep that branch.

**Gaps the registry exposes/closes:**
- **SSR silently no-ops `video`, `group`, `group_item`** (they hit `default: return ''`) whereas mail renders them. The registry makes this an explicit, reviewed decision (`NOT_RENDERED`) rather than an accidental fallthrough. Output stays identical (still empty) — we are *not* changing what SSR emits, only making the omission intentional and guard-tested.
- **SSR never walks group children**: `routes.ts` fetches a flat block list ordered by `"order"` and does not `buildBlockTree`, so a `group`'s nested content is invisible to SSR today. **Out of scope** for this plan (changing it would alter SSR output). Note it as a follow-up in the registry file's header comment so it's discoverable.
- Mail already covers 100% of types; its only "gap" is that its registry key is `string`, so a typo'd/removed type wouldn't be caught. Retyping to `Record<BlockType, …>` + the coverage test closes that.

## File Structure

```
packages/shared/src/
├── types/content.ts                 # BlockType union (unchanged)
└── utils/
    ├── blockCatalog.ts              # NEW: ALL_BLOCK_TYPES + exhaustiveness assertion; re-export via utils barrel
    └── index.ts                     # add export * from './blockCatalog' (if a barrel exists; else export from package root)

packages/api/src/services/
├── ssr/
│   ├── bodyBuilder.ts               # renderBlockForSeo() REMOVED; buildPageBody imports it from ./blocks
│   ├── routes.ts                    # unchanged (keeps calling buildPageBody/buildPostBody)
│   └── blocks/                      # NEW folder, mirrors mail/blocks/ shape
│       ├── index.ts                 # SsrBlockRenderer type, SSR_BLOCK_RENDERERS: Record<BlockType,…>, renderBlockForSeo dispatcher, NOT_INDEXABLE/NOT_RENDERED sentinels
│       ├── _util.ts                 # escapeHtml, isoToReadable (moved from bodyBuilder), re-export sanitize wrapper
│       ├── richText.ts              # rich_text / text / html emitter
│       ├── hero.ts                  # hero emitter
│       ├── image.ts                 # image emitter
│       ├── document.ts              # document emitter
│       └── urlLink.ts               # url_link emitter
│       └── blocks.test.ts           # coverage guard (Task 5)
└── mail/blocks/
    └── index.ts                     # RENDERERS retyped Record<string> → Record<BlockType>
```

`SsrBlockInput` (the argument shape) matches what `buildPageBody` already passes each block:
```ts
export interface SsrBlockInput {
    type: string;
    title?: string | null;
    content?: string | null;
    settings?: Record<string, unknown> | null;
}
export type SsrBlockRenderer = (block: SsrBlockInput) => string;
```

---

## Task 1 — Add the shared block-type catalog

**Files:**
- `packages/shared/src/utils/blockCatalog.ts` (new)
- `packages/shared/src/utils/index.ts` (barrel — add re-export; verify the file exists, else re-export from `packages/shared/src/index.ts`)

Steps:
- [ ] Create `blockCatalog.ts` with a runtime array of every `BlockType`, plus a compile-time exhaustiveness assertion so removing a value from the union (or forgetting one) is a build error:
```ts
import type { BlockType, } from '../types/content';

/**
 * Runtime enumeration of every block type. The `satisfies` +
 * exhaustiveness assertion below make this list provably complete
 * against the BlockType union — drop or add a union member and this
 * file fails to compile until ALL_BLOCK_TYPES matches. Consumers
 * (mail + ssr render registries, coverage tests) iterate this so a
 * new block type can never be silently ignored.
 */
export const ALL_BLOCK_TYPES = [
    'rich_text',
    'text',
    'post',
    'post_list',
    'form',
    'image',
    'video',
    'gallery',
    'social',
    'campaign',
    'hero',
    'html',
    'document',
    'url_link',
    'carousel',
    'spacer',
    'group',
    'group_item',
] as const satisfies readonly BlockType[];

// Exhaustiveness guard: if a BlockType is added to the union but not
// to ALL_BLOCK_TYPES, `Exclude<BlockType, …>` is non-never and this
// line errors.
type _MissingBlockType = Exclude<BlockType, (typeof ALL_BLOCK_TYPES)[number]>;
const _exhaustive: _MissingBlockType extends never ? true : never = true;
void _exhaustive;
```
- [ ] Re-export from the shared utils barrel (mirror how `blockTree.ts` / `format.ts` are re-exported). Confirm importing `import { ALL_BLOCK_TYPES } from '@sitesurge/types'` resolves.
- [ ] Verify: `pnpm --filter @sitesurge/types build` (shared compiles; assertion holds).
- [ ] Commit: `feat(shared): ALL_BLOCK_TYPES runtime block-type catalog`.

## Task 2 — Define the SSR block registry interface + sentinel strategies (mirror the mail pattern)

**Files:**
- `packages/api/src/services/ssr/blocks/index.ts` (new)
- `packages/api/src/services/ssr/blocks/_util.ts` (new)

Steps:
- [ ] Create `_util.ts` by **moving** (not copying) `escapeHtml` and `isoToReadable` out of `bodyBuilder.ts` verbatim, and re-exporting `sanitize`:
```ts
export { sanitize, } from '../../../utils/sanitize';

export function escapeHtml(s: unknown,): string {
    if (s === null || s === undefined) return '';
    return String(s,)
        .replace(/&/g, '&amp;',)
        .replace(/</g, '&lt;',)
        .replace(/>/g, '&gt;',)
        .replace(/"/g, '&quot;',)
        .replace(/'/g, '&#39;',);
}

export function isoToReadable(iso: string | null | undefined,): string {
    if (!iso) return '';
    try {
        const d = new Date(iso,);
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', },);
    } catch {
        return '';
    }
}
```
- [ ] In `index.ts`, define the interface + sentinels (mirror `mail/blocks/index.ts`'s `RENDERERS`/`renderNode` structure). The two sentinels reproduce the two current no-op forms **exactly**:
```ts
import type { BlockType, } from '@sitesurge/types';
import { ALL_BLOCK_TYPES, } from '@sitesurge/types';

export interface SsrBlockInput {
    type: string;
    title?: string | null;
    content?: string | null;
    settings?: Record<string, unknown> | null;
}
export type SsrBlockRenderer = (block: SsrBlockInput,) => string;

/** Dynamic blocks: emit an HTML comment naming the type (matches the
 *  old explicit `case 'form': … return '<!-- … -->'` arms). Bots can't
 *  index runtime feeds; the SPA renders them on mount. */
export const notIndexable: SsrBlockRenderer = (block,) =>
    `<!-- ${block.type} block (not server-rendered) -->`;

/** No SSR output at all (matches the old `default: return ''` fallthrough
 *  that video/group/group_item currently hit). */
export const notRendered: SsrBlockRenderer = () => '';
```
- [ ] Add the registry skeleton keyed exhaustively by `BlockType` (emitters imported in Task 3; wire sentinels now, leave emitters as `notRendered` placeholders temporarily ONLY if needed — prefer to land Task 2+3 together so no arm is ever wrong). Recommended: keep Task 2 and Task 3 in one commit to avoid an intermediate state where emitters are stubbed. If splitting, mark placeholders with a `// TODO Task 3` and do NOT run the parity check until Task 3 lands.
- [ ] Do NOT delete the old `switch` yet.
- [ ] Verify: `pnpm --filter @sitesurge/server build`.
- [ ] Commit (if landing standalone): `feat(ssr): block render registry scaffold + sentinels`.

## Task 3 — Port the content-emitting SSR strategies (byte-for-byte)

**Files:** `packages/api/src/services/ssr/blocks/{richText,hero,image,document,urlLink}.ts` (new), `packages/api/src/services/ssr/blocks/index.ts` (wire registry)

Each strategy is the corresponding `switch` arm from `bodyBuilder.ts` lines 156–193, unchanged. Steps:
- [ ] `richText.ts` — covers `rich_text`, `text`, AND `html` (they share one arm; `html` branches to raw output):
```ts
import type { SsrBlockRenderer, } from './index';
import { sanitize, } from './_util';

export const renderRichText: SsrBlockRenderer = (block,) => {
    const settings = (block.settings || {}) as Record<string, any>;
    const html = block.content || (settings.content as string) || '';
    if (!html) return '';
    return `<div class="ssr-block ssr-block--${block.type}">${
        block.type === 'html' ? html : sanitize(html,)
    }</div>`;
};
```
- [ ] `hero.ts`:
```ts
import type { SsrBlockRenderer, } from './index';
import { escapeHtml, sanitize, } from './_util';

export const renderHero: SsrBlockRenderer = (block,) => {
    const settings = (block.settings || {}) as Record<string, any>;
    const heroBits: string[] = [];
    const t = block.title || (settings.title as string) || '';
    const subtitle = (settings.subtitle as string) || '';
    const content = block.content || (settings.content as string) || '';
    if (t) heroBits.push(`<h2>${escapeHtml(t,)}</h2>`,);
    if (subtitle) heroBits.push(`<p>${escapeHtml(subtitle,)}</p>`,);
    if (content) heroBits.push(sanitize(content,),);
    if (heroBits.length === 0) return '';
    return `<section class="ssr-block ssr-block--hero">${heroBits.join('',)}</section>`;
};
```
- [ ] `image.ts`:
```ts
import type { SsrBlockRenderer, } from './index';
import { escapeHtml, } from './_util';

export const renderImage: SsrBlockRenderer = (block,) => {
    const settings = (block.settings || {}) as Record<string, any>;
    const url = block.content || (settings.url as string) || '';
    const alt = (settings.alt as string) || block.title || '';
    if (!url) return '';
    return `<img class="ssr-block ssr-block--image" src="${escapeHtml(url,)}" alt="${escapeHtml(alt,)}" />`;
};
```
- [ ] `document.ts`:
```ts
import type { SsrBlockRenderer, } from './index';
import { escapeHtml, } from './_util';

export const renderDocument: SsrBlockRenderer = (block,) => {
    const settings = (block.settings || {}) as Record<string, any>;
    const url = (settings.url as string) || '';
    const name = (settings.fileName as string) || block.title || 'Download';
    if (!url) return '';
    return `<a class="ssr-block ssr-block--document" href="${escapeHtml(url,)}">${escapeHtml(name,)}</a>`;
};
```
- [ ] `urlLink.ts`:
```ts
import type { SsrBlockRenderer, } from './index';
import { escapeHtml, } from './_util';

export const renderUrlLink: SsrBlockRenderer = (block,) => {
    const settings = (block.settings || {}) as Record<string, any>;
    const url = (settings.url as string) || '';
    const t = block.title || (settings.title as string) || url;
    if (!url) return '';
    return `<a class="ssr-block ssr-block--url-link" href="${escapeHtml(url,)}">${escapeHtml(t,)}</a>`;
};
```
- [ ] Wire the full registry in `index.ts` (exhaustive `Record<BlockType, SsrBlockRenderer>` — mirror the mail arm ordering/comments) and add the dispatcher:
```ts
import { renderRichText, } from './richText';
import { renderHero, } from './hero';
import { renderImage, } from './image';
import { renderDocument, } from './document';
import { renderUrlLink, } from './urlLink';

export const SSR_BLOCK_RENDERERS: Record<BlockType, SsrBlockRenderer> = {
    rich_text: renderRichText,
    text: renderRichText,
    html: renderRichText,
    hero: renderHero,
    image: renderImage,
    document: renderDocument,
    url_link: renderUrlLink,
    // Dynamic blocks — emit a naming comment (was the explicit case list).
    form: notIndexable,
    social: notIndexable,
    post_list: notIndexable,
    carousel: notIndexable,
    gallery: notIndexable,
    campaign: notIndexable,
    post: notIndexable,
    spacer: notIndexable,
    // No SSR output (was the `default:` fallthrough).
    video: notRendered,
    group: notRendered,
    group_item: notRendered,
};

/** Server-side block renderer for SSR. Dispatches by type; unknown
 *  types (not in the union) emit nothing, matching the old default. */
export function renderBlockForSeo(block: SsrBlockInput,): string {
    const fn = SSR_BLOCK_RENDERERS[block.type as BlockType];
    return fn ? fn(block,) : '';
}
```
- [ ] Add the header note about the flat-blocks / no-`buildBlockTree` group follow-up (see Risks) to `index.ts`.
- [ ] Verify: `pnpm --filter @sitesurge/server build`.
- [ ] Commit: `feat(ssr): per-type SSR block render strategies`.

## Task 4 — Cut `bodyBuilder.ts` over to the registry; delete the switch

**Files:** `packages/api/src/services/ssr/bodyBuilder.ts`

Steps:
- [ ] Remove the private `renderBlockForSeo` function (lines ~141–209) and the now-unused local `escapeHtml`/`isoToReadable` **only if** nothing else in the file uses them — they ARE used by `buildPostBody`/`buildPostListBody`/`buildGenericBody`, so instead **import** them from `./blocks/_util` and delete the local copies to avoid duplication. Keep `sanitize` import as-is (still used by `buildPostBody`).
- [ ] Import the dispatcher: `import { renderBlockForSeo, } from './blocks';` and keep `buildPageBody`'s loop calling `renderBlockForSeo(block)` exactly as before (it already does at line 133).
- [ ] Confirm `buildPageBody`, `buildPostBody`, `buildPostListBody`, `buildGenericBody`, `invalidateSiteMetaCache` public exports are unchanged; `routes.ts` needs zero edits.
- [ ] Verify build + full suite: `pnpm --filter @sitesurge/server build && pnpm --filter @sitesurge/server test` — **108 tests green**.
- [ ] Verify: `routes.ts` unchanged (git diff shows no change to that file).
- [ ] Commit: `refactor(ssr): dispatch SEO block body via registry (drop switch)`.

## Task 5 — Coverage guard tests (prevent future gaps) + SSR output parity snapshot

**Files:** `packages/api/src/services/ssr/blocks/blocks.test.ts` (new), optionally `packages/api/src/services/mail/blocks/coverage.test.ts` (new)

Use TDD: write the assertions, watch them pass against the completed registries; then intentionally comment out one registry arm locally to confirm the test fails (proving the guard works), then restore.

Steps:
- [ ] SSR coverage: assert every catalog type has a strategy, and that the two no-op forms are preserved:
```ts
import { describe, expect, it, } from 'vitest';
import { ALL_BLOCK_TYPES, } from '@sitesurge/types';
import { SSR_BLOCK_RENDERERS, renderBlockForSeo, } from './index';

describe('SSR block registry coverage', () => {
    it('every BlockType has an SSR strategy', () => {
        for (const t of ALL_BLOCK_TYPES) {
            expect(SSR_BLOCK_RENDERERS[t], `missing SSR strategy for ${t}`,).toBeTypeOf('function',);
        }
    });

    it('registry has no strategy for a type outside the catalog', () => {
        const extra = Object.keys(SSR_BLOCK_RENDERERS,).filter(
            (k,) => !(ALL_BLOCK_TYPES as readonly string[]).includes(k,),
        );
        expect(extra,).toEqual([],);
    });
});
```
- [ ] SSR output parity — lock the exact bytes per type so no future edit drifts the rendered HTML (this is the "snapshot before/after" from Risks, encoded as explicit expectations):
```ts
describe('SSR block output parity', () => {
    it('rich_text sanitizes into an ssr-block div', () => {
        expect(renderBlockForSeo({ type: 'rich_text', content: '<p>Hi</p>', },))
            .toBe('<div class="ssr-block ssr-block--rich_text"><p>Hi</p></div>',);
    });
    it('html passes through raw (unsanitized)', () => {
        expect(renderBlockForSeo({ type: 'html', content: '<p onclick="x">Hi</p>', },))
            .toBe('<div class="ssr-block ssr-block--html"><p onclick="x">Hi</p></div>',);
    });
    it('image emits an img with escaped attrs', () => {
        expect(renderBlockForSeo({ type: 'image', content: 'https://x/y.png', settings: { alt: 'A&B', }, },))
            .toBe('<img class="ssr-block ssr-block--image" src="https://x/y.png" alt="A&amp;B" />',);
    });
    it('dynamic blocks emit a naming comment', () => {
        expect(renderBlockForSeo({ type: 'form', },)).toBe('<!-- form block (not server-rendered) -->',);
    });
    it('video/group/group_item emit nothing', () => {
        expect(renderBlockForSeo({ type: 'video', },)).toBe('',);
        expect(renderBlockForSeo({ type: 'group', },)).toBe('',);
        expect(renderBlockForSeo({ type: 'group_item', },)).toBe('',);
    });
});
```
  - Sanity-check the exact expected strings against pre-refactor output: before Task 4, run the same inputs through the old `renderBlockForSeo` (temporarily export it or paste into a scratch test) and confirm the bytes match what's asserted here. The `sanitize()` output for `<p>Hi</p>` must be verified against the real util, not assumed — adjust the expected string to whatever `sanitize` actually returns.
- [ ] Mail coverage (dedupe onto the shared catalog — Task 6 makes this compile-clean; the test can land here or with Task 6):
```ts
import { RENDERERS, } from './index';
import { ALL_BLOCK_TYPES, } from '@sitesurge/types';
// expect every ALL_BLOCK_TYPES member to be a function in RENDERERS.
```
- [ ] Verify: `pnpm --filter @sitesurge/server test` — new tests pass, total now **> 108**, none regressed.
- [ ] Commit: `test(ssr): block registry coverage + output parity guards`.

## Task 6 — Dedupe mail registry onto the shared catalog (only if clean)

**Files:** `packages/api/src/services/mail/blocks/index.ts`

Steps:
- [ ] Retype `RENDERERS` from `Record<string, BlockEmailRenderer>` to `Record<BlockType, BlockEmailRenderer>` (import `BlockType` from `@sitesurge/types`). It is already exhaustive, so this should compile with zero arm changes. Keep `renderNode`'s `RENDERERS[node.blockType]` lookup — `node.blockType` is `string`, so cast at the lookup (`RENDERERS[node.blockType as BlockType]`) and keep the `if (!fn) return '';` guard for unknown runtime types.
- [ ] If retyping surfaces any friction (e.g. a key not in the union, or `EmailBlockNode.blockType` typing fights the index), STOP — leave mail as-is and note it; the SSR win stands alone. Do not force it.
- [ ] Add the mail coverage test from Task 5 if not already landed.
- [ ] Verify: `pnpm --filter @sitesurge/server build && pnpm --filter @sitesurge/server test`.
- [ ] Commit: `refactor(mail): key block renderers by shared BlockType catalog`.

## Task 7 — Docs

**Files:** `CLAUDE.md` (project), any SSR/mail dev notes

Steps:
- [ ] One-line note under the block/SSR section: block types now enumerate once in `@sitesurge/types` `ALL_BLOCK_TYPES`; SSR + email each provide a per-type render registry (`services/ssr/blocks/`, `services/mail/blocks/`); a coverage test guards that every type has a strategy. Mention the known SSR limitation (groups' children not walked in SSR).
- [ ] Commit: `docs: block-type registry + SSR/email render strategies`.

---

## Risks & rollback

- **SSR HTML output must stay byte-identical per type.** The two no-op forms (comment vs empty string) are easy to conflate — `video`/`group`/`group_item` must emit `''` (not a comment), everything in the old dynamic `case` list must emit the comment. The Task 5 parity test encodes this; treat any diff as a bug, not a "nicer" output. Mitigation: before deleting the switch (Task 4), capture the old function's output for one representative input per type (a scratch test) and diff against the new registry's output.
- **`sanitize()` exact output** is assumed in the parity test — verify the real bytes it produces rather than hand-writing the expected string.
- **The mail registry is battle-tested — do not regress it.** Task 6 is type-only and optional; if retyping causes any behavior change or compile fight, back it out and keep mail's `Record<string, …>`. The SSR conversion does not depend on Task 6.
- **`routes.ts` must not change.** If the diff touches it, something in the `buildPageBody`/`buildPostBody` signatures drifted — revert and re-check.
- **Rollback per task:** each task is its own commit; `git revert` the offending commit. Task 4 (switch deletion) is the only irreversible-feeling step, but it's guarded by the full 108-test suite + the new parity tests landing in Task 5 — land Task 5's parity assertions before or immediately after Task 4 so regressions surface instantly.
- **Shared exhaustiveness assertion** is the safety net for "someone adds a BlockType and forgets a consumer": union change → `ALL_BLOCK_TYPES` compile error → fix catalog → coverage test red until each registry has an arm.

## Self-review checklist

- [ ] `ALL_BLOCK_TYPES` contains exactly the 18 union members; the `Exclude<…>` assertion compiles (add a bogus member locally to confirm it *fails*, then remove).
- [ ] SSR registry is `Record<BlockType, …>` and fully populated — no `?` optionals, no `string` key.
- [ ] `video`/`group`/`group_item` → `''`; the 8 dynamic types → naming comment; 7 emitters → identical markup to the old arms.
- [ ] `html` still emits raw (unsanitized) content; `rich_text`/`text` still sanitize.
- [ ] `escapeHtml`/`isoToReadable` moved (not duplicated); `bodyBuilder.ts` imports them from `./blocks/_util`.
- [ ] `routes.ts` unchanged; `buildPageBody`/`buildPostBody`/etc. public signatures unchanged.
- [ ] `pnpm --filter @sitesurge/types build` and `pnpm --filter @sitesurge/server build` both pass.
- [ ] `pnpm --filter @sitesurge/server test` ≥ 108 tests, all green; the coverage guard fails when an arm is removed (verified once, then restored).
- [ ] Mail registry either cleanly retyped to `BlockType` or left untouched — never half-migrated.
- [ ] Commits are small and per-task; docs updated in the same chain.
