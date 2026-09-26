# Header / Footer Editor — Keystroke Lifting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `SiteFooterEditor` and `SiteHeaderEditor` onto the house rule — text inputs keep a local draft and lift on blur — so editing an item's text field cannot remount the focused row.

**Architecture:** Two independent halves. (1) The inputs lift per keystroke (`onInput → props.onChange`). (2) The parent holds its item list in `createSignal<T[]>` and rebuilds it with `.map()`, which hands the edited row a fresh object identity; `<For>` keys by reference, so that row remounts. Either alone is survivable; together they are the documented focus-loss bug. Fix (2) first — moving to `createStore` makes (1) harmless — then (1) for consistency.

**Tech Stack:** SolidJS (`createStore`, `produce`, `<For>`), TypeScript, vitest.

---

## ⚠️ Task 0 — Reproduce it first. Do not skip this.

**This plan is written from code reading. The focus loss was NOT observed.**
Everything below assumes a bug whose existence is inferred from two patterns
that usually combine into one. If it does not reproduce, this becomes a
consistency cleanup with a much lower priority, and the plan should be re-scoped
rather than executed as written.

- [ ] **Step 1: Open the editor.** `/admin/settings` → **Site Footer**. Expand
      an item that has a text field (a button item has *Label*, *URL*,
      *Button color*, *Border radius*).

- [ ] **Step 2: Type a multi-character value in one go.** Click into *Border
      radius* and type `12px` without pausing.

- [ ] **Step 3: Record what happens.**
  - Does focus survive all four characters?
  - Does the caret jump to the start or end?
  - Does only the first character land?

- [ ] **Step 4: Repeat on Site Header**, which uses the same
      `createSignal<T[]>` + `.map()` shape (`SiteHeaderEditor.tsx:145,332`).

- [ ] **Step 5: Write down the result in this file** before continuing. If focus
      survives, STOP and re-scope: the remaining value is consistency with the
      house rule, which is Task 3 alone.

> **Why the outcome is genuinely uncertain:** at `SiteHeaderEditor.tsx:332` the
> `.map()` gives a fresh identity to the *changed* item only, so unchanged rows
> do not remount. Whether the changed row does depends on how `<For>` reconciles
> and whether the input is keyed beneath it. That is a measurement, not a
> deduction.

---

### Task 1: Move the item list to `createStore`

**Files:**
- Modify: `packages/cms/src/components/admin/editors/SiteHeaderEditor.tsx:145,332,341,368,378,481`
- Modify: `packages/cms/src/components/admin/editors/SiteFooterEditor.tsx` (equivalent list)

- [ ] **Step 1: Write a failing test** that pins identity stability. The point
      is that editing one field must not replace the row object.

```ts
import { createRoot, } from 'solid-js';
import { createStore, produce, } from 'solid-js/store';
import { describe, expect, it, } from 'vitest';

describe('item list identity', () => {
    it('patching a field keeps the row object identical', () => {
        // `<For>` keys by reference: a fresh object here is a remount, and a
        // remount of the row being edited is the focused input being destroyed.
        const { rows, patch, } = createRoot(() => {
            const [rows, setRows,] = createStore([{ id: 'a', label: 'One', },],);
            const patch = (i: number, label: string,) =>
                setRows(produce(list => { list[i].label = label; },),);
            return { rows, patch, };
        },);
        const before = rows[0];
        patch(0, 'Two',);
        expect(rows[0],).toBe(before,);      // same object
        expect(rows[0].label,).toBe('Two',); // updated in place
    },);
},);
```

- [ ] **Step 2: Run it against the CURRENT signal-based shape** to show the
      contrast — replace the store with `createSignal` + `.map()` in a scratch
      copy and watch `toBe` fail. This is the evidence the change is needed.

- [ ] **Step 3: Convert the list.** `createSignal<SiteHeaderItem[]>([])` →
      `createStore<SiteHeaderItem[]>([])`. Rewrite each mutation:
  - `setItems(list => list.map(i => i.id === x ? {...updated} : i))` →
    `setItems(produce(list => { const r = list.find(i => i.id === x); if (r) Object.assign(r, updated); }))`
  - `setItems(prev => [...prev, item])` → `setItems(list => [...list, item])` (append is fine; it adds identity rather than replacing it)
  - `setItems(prev => prev.filter(...).map(reorder))` — removal legitimately
    rebuilds; keep it, but reorder with `produce` so surviving rows keep identity.

- [ ] **Step 4: Run the cms suite.** Expected: PASS.
      `npx vitest --run --config config/cms/vitest.config.ts`

- [ ] **Step 5: Re-run Task 0's reproduction.** Focus must now survive.

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(admin): hold header/footer items in a store, so editing a row does not remount it"
```

---

### Task 2: Verify drag-reorder and delete still work

**Files:** none (verification only)

Converting to a store changes how the list is replaced, and these two paths
replace it wholesale.

- [ ] **Step 1:** In the browser, drag an item to a new position. Confirm the
      order persists after Save + reload.
- [ ] **Step 2:** Delete an item. Confirm the remaining items renumber and no
      row renders stale content.
- [ ] **Step 3:** Add an item. Confirm it appears at the end and is editable.
- [ ] **Step 4: Commit** any fixes separately from Task 1 so a regression can be
      bisected to the behaviour it broke.

---

### Task 3: Switch the inputs to blur-commit

**Files:**
- Modify: `packages/cms/src/components/admin/editors/SiteFooterEditor.tsx` — 19 `onInput → props.onChange` sites
- Modify: `packages/cms/src/components/admin/editors/SiteHeaderEditor.tsx` — the equivalent sites

- [ ] **Step 1: Convert them mechanically.** `onInput={...}` → `onChange={...}`
      for every `input[type=text]` whose handler calls `props.onChange`.
      Leave genuine search-as-you-type boxes alone; there are none in these files.

- [ ] **Step 2: Check each converted field still SHOWS what was typed.** An
      input whose `value` is bound to the prop and now only commits on blur must
      still be editable mid-word — if any field was relying on the round-trip to
      display characters, it needs a local draft signal (the pattern in
      `EntityValueInput.tsx`).

- [ ] **Step 3: Run the cms suite + typecheck.**

```bash
npx tsc --noEmit -p config/cms/tsconfig.json   # expect the 8-error baseline, unchanged
npx vitest --run --config config/cms/vitest.config.ts
```

- [ ] **Step 4: Verify in a browser** that every converted field saves. Blur
      commits are easy to break silently: a field that never fires `change`
      because the operator hits Save while it still has focus would lose the
      edit. Confirm the Save path flushes the focused field, or that clicking
      Save blurs it first.

- [ ] **Step 5: Commit**

```bash
git commit -am "refactor(admin): header/footer text fields commit on blur"
```

---

## Verification

```
npx tsc --noEmit -p config/cms/tsconfig.json     # 8 errors (unchanged baseline)
npx vitest --run --config config/cms/vitest.config.ts
```

Plus the browser passes in Tasks 0, 2 and 3.4 — this is a focus-and-persistence
bug, and neither symptom is visible to a test runner.

## Risk

**Medium-high.** Two long, heavily-used editors, and the failure mode of getting
it wrong (an edit that silently does not save) is worse than the bug being
fixed. Do Task 1 and Task 3 as separate commits so either can be reverted alone.
