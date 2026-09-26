# SSR Block CSS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-rendered pages ship their block styling in the HTML, so a crawler and a JS-disabled visitor see the page as designed instead of unstyled block markup.

**Architecture:** `blockCss()` already lives in `@sitesurge/types` for exactly this reason — the work is not writing an emitter but *feeding* it. `ssr/routes.ts` currently hands the body builder a FLAT block list, so nested blocks (groups, component/entity subtrees) are invisible to it. Assemble the tree with the existing `buildBlockTree`, walk it, collect each block's CSS, and inject one `<style>` into the head next to the existing appearance CSS.

**Tech Stack:** TypeScript, Express, `@sitesurge/types` (`blockCss`, `buildBlockTree`), vitest.

---

## Background — why this matters now

SSR has never emitted block CSS. That was a small gap when block styling was
mostly padding and colour. In the 2026-09 window it became a large one: blocks
gained `borderRadius` (plus the `overflow: hidden` that pairs with it) and
arbitrary operator **Custom CSS**. A server-rendered article now arrives with
its markup and none of its shape, and repaints on hydration.

Two independent defects are in scope and should not be conflated:

1. **No CSS is emitted at all.** (This plan's main body.)
2. **The block list is flat**, so a `group`'s children are not walked — which is
   also why groups emit no *content* in SSR today. Fixing (1) without (2) would
   style only top-level blocks.

## Decisions to make before coding

- [ ] **Scope of the first cut.** Recommendation: emit the **default** layer and
      per-breakpoint `@media` rules, and SKIP the `@container ss-bp` preview
      variants — nothing on a server-rendered page declares that container, so
      they are dead weight in the payload. Confirm before implementing.
- [ ] **Custom CSS in SSR.** `scopeCss` is pure and environment-free, so it runs
      server-side unchanged. Include it — it is the part most visible by its
      absence.
- [ ] **Payload budget.** One `<style>` per page containing every block's rules.
      Measure it on the heaviest real page before shipping; if it is large,
      the follow-up is de-duplicating identical rule bodies, not dropping them.

## File structure

- **Create:** `packages/api/src/services/ssr/blockStyles.ts` — collect a tree's
  CSS into one string. One responsibility: walk + concatenate.
- **Create:** `packages/api/src/services/ssr/blockStyles.test.ts`
- **Modify:** `packages/api/src/services/ssr/routes.ts` — build the tree, call
  the collector, pass the result to the head injector.
- **Modify:** `packages/api/src/services/ssr/bodyBuilder.ts` (or wherever the
  flat list is consumed) — accept a tree.

---

### Task 1: A collector that walks a block tree and returns its CSS

**Files:**
- Create: `packages/api/src/services/ssr/blockStyles.ts`
- Test: `packages/api/src/services/ssr/blockStyles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, } from 'vitest';
import { collectBlockCss, } from './blockStyles';

const OPTS = {
    resolveFont: (v?: string,) => v,
    resolveHAlign: (v?: string,) => v,
    resolveColor: (v?: string,) => v,
};

describe('collectBlockCss', () => {
    it('emits the default layer for a single block', () => {
        const css = collectBlockCss(
            [{ id: 'a', type: 'rich_text', style: { padding: '10px', }, children: [], },],
            [],
            OPTS,
        );
        expect(css,).toContain('@layer block{',);
        expect(css,).toContain('.block[data-block-id="a"]',);
        expect(css,).toContain('padding:10px',);
    },);

    it('walks NESTED blocks, which the flat SSR list never reached', () => {
        // The second defect: a group's children are invisible to SSR today, so
        // styling only the top level would look like the feature half works.
        const css = collectBlockCss(
            [{
                id: 'g', type: 'group', style: {}, children: [
                    { id: 'child', type: 'rich_text', style: { padding: '4px', }, children: [], },
                ],
            },],
            [],
            OPTS,
        );
        expect(css,).toContain('data-block-id="child"',);
    },);

    it('returns EMPTY for blocks with no style, rather than an empty <style>', () => {
        expect(collectBlockCss([{ id: 'a', type: 'rich_text', style: {}, children: [], },], [], OPTS,),)
            .toBe('',);
    },);
},);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest --run --config config/api/vitest.config.ts packages/api/src/services/ssr/blockStyles.test.ts`
Expected: FAIL — `Cannot find module './blockStyles'`.

- [ ] **Step 3: Implement the collector**

```ts
/**
 * Every block's CSS for one server-rendered page, as one stylesheet.
 *
 * `blockCss` was hoisted into `@sitesurge/types` so SSR could call it; this is
 * the caller. The walk is the substance — SSR feeds a FLAT list today, so a
 * group's children have never been reached, for styling or for content.
 */
import { blockCss, type BlockResponsiveOptions, type SiteBreakpoint, } from '@sitesurge/types';

interface TreeBlock {
    id: string;
    type: string;
    style?: Record<string, unknown> | null;
    children?: TreeBlock[];
}

export function collectBlockCss(
    blocks: TreeBlock[],
    breakpoints: SiteBreakpoint[],
    opts: BlockResponsiveOptions,
): string {
    const out: string[] = [];
    const walk = (list: TreeBlock[],) => {
        for (const b of list) {
            const css = blockCss(b.id, b.style ?? undefined, breakpoints, opts,);
            if (css) out.push(css,);
            if (b.children?.length) walk(b.children,);
        }
    };
    walk(blocks,);
    return out.join('\n',);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest --run --config config/api/vitest.config.ts packages/api/src/services/ssr/blockStyles.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/ssr/blockStyles.ts packages/api/src/services/ssr/blockStyles.test.ts
git commit -m "feat(ssr): collect a block tree's CSS into one stylesheet"
```

---

### Task 2: Assemble the tree in the SSR route

**Files:**
- Modify: `packages/api/src/services/ssr/routes.ts`

- [ ] **Step 1: Find the flat list.** Locate where blocks are fetched and passed
      to the body builder. Note the exact shape — the repo returns
      `parentBlockId`, and `buildBlockTree` expects that key.

- [ ] **Step 2: Write a test asserting a nested block reaches the output.**
      Use the existing SSR route test harness. Expected: FAIL — the child is absent.

- [ ] **Step 3: Replace the flat pass-through with `buildBlockTree(flat)`.**
      Import it from `@sitesurge/types`; it is the same assembler the admin and
      public renderers use, so the three cannot disagree about nesting.

- [ ] **Step 4: Run the SSR suite.** Expected: the new test passes and every
      existing SSR test still does. Fixing the walk changes what groups emit as
      CONTENT too — review those snapshots deliberately rather than updating
      them reflexively.

- [ ] **Step 5: Commit**

```bash
git commit -am "fix(ssr): walk the block tree, so nested blocks are rendered"
```

---

### Task 3: Inject the stylesheet into the head

**Files:**
- Modify: `packages/api/src/services/ssr/routes.ts`

- [ ] **Step 1: Write the failing test** — request a page whose block has
      `style.borderRadius` and assert the response contains
      `border-radius:8px` inside a `<style>`.

- [ ] **Step 2: Run it.** Expected: FAIL.

- [ ] **Step 3: Emit it** beside the existing `site-appearance-css` style tag,
      with its own id (`ssr-block-css`) so it is identifiable in view-source and
      the SPA can leave it alone. Resolve swatch colours through the same
      palette the mail renderer uses — a `swatch:` ref must not reach the page.

- [ ] **Step 4: Run the SSR suite.** Expected: PASS.

- [ ] **Step 5: Verify against a real page.** Load a production page with
      `curl -s <url> | grep -c 'ssr-block-css'` and compare the rendered result
      to the hydrated one in a browser. Record the payload delta.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(ssr): emit block CSS into the head"
```

---

## Verification

```
npx tsc --noEmit -p config/api/tsconfig.json      # expect 0
npx vitest --run --config config/api/vitest.config.ts   # expect 923 pass / 3 known auth failures
```

Then, on the demo before production: load a page with a rounded block and
confirm the shape is present in view-source, not only after hydration.

## Out of scope

- De-duplicating identical rule bodies across blocks. Measure first.
- The `@container ss-bp` preview variants (see Decisions).
- Emitting mail-style inline fallbacks. SSR output is consumed by browsers,
  which have a full CSS engine.
