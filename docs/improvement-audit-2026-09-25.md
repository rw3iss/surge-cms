# Improvement Audit — 2026-09-25

## 1. Summary

- **Project:** SiteSurge CMS (`@sitesurge/*` monorepo)
- **Working directory:** `/home/rw3iss/Sites/rw/rw-cms`
- **Scope:** the 98 commits since the last audit (`11901e24`, 2026-09-07) —
  278 files, +22,727/−978. The large features in that window: block border-radius
  + per-block Custom CSS (web + email), the social block's navigation and item
  properties, scheduled mailing-list sends, the mail template editor's
  draft/revert/navigation-guard, media-storage and backup-destination settings,
  the admin presence channel, and the `{{site.*}}` / `{{list.*}}` / `{{template.*}}`
  template variables.
- **Total findings: 18** (UI: 2, testing: 4, architecture: 6, second pass: 6)

**Rule compliance across the new code is good.** Mechanical sweeps of every
changed file found **zero** occurrences of `!important`, zero raw
`<input type="checkbox">`, zero `cache.del`/`delPattern` outside `cache.ts`, and
exactly one new hardcoded hex (`#fff`, five times). The findings below are
therefore mostly *consolidation* — the same idea implemented more than once —
which is what this pass was asked to look for.

---

## 2. UI & UX

### U1 — New footer item field lifts state on every keystroke

- **Location:** `packages/cms/src/components/admin/editors/SiteFooterEditor.tsx:1851`
- **Problem:** the per-item **Border radius** field added in this window uses
  `onInput={(e) => props.onChange({ borderRadius: … })}`, pushing state to the
  parent on every character. `CLAUDE.md` § *Admin styles* requires text inputs to
  keep a local draft and lift on **blur**.
- **Why it matters:** the parent holds its item list in a `createSignal<T[]>` and
  updates it with `.map()`, which hands the edited row a fresh object identity.
  `<For>` keys by reference, so the edited row — the one with focus — remounts.
  That is the exact failure the house rule exists to prevent.
- **Honest caveat:** I did **not** reproduce the focus loss in a browser. The
  file has **19** other `onInput → props.onChange` sites and **8** blur-committing
  ones, all predating this window, so the new field follows the dominant local
  convention. Whether the remount is observable depends on how the parent
  re-renders, which I did not measure.
- **Fix:** for the one new field, switch to `onChange` (blur). For the file as a
  whole, see C1.
- **Risk:** low for the single field; the systemic fix is Phase C.

### U2 — `resolveSocialItemRadius` is public API with no production caller

- **Location:** `packages/shared/src/utils/socialDisplay.ts:237`
- **Problem:** introduced earlier in this window, then superseded hours later by
  `resolveSocialItemBox`, which returns all four Item properties. Both call sites
  were migrated to the box; only the function's own tests still reference it.
- **Why it matters:** it is exported from a **published** package, so it is
  public surface that nothing exercises in anger. Not harmful — it is a one-line
  delegation to the box — but it is a second name for one concept.
- **Fix:** keep it (removing it is a breaking change for `@sitesurge/types`
  consumers) and document it explicitly as a convenience alias, so the next
  reader does not treat it as a second source of truth. Do **not** delete — per
  the project rule, that is `/dead-code`'s call.
- **Risk:** low (documentation only).

---

## 3. Testing

### T1 — Shared-module tests lived in the consumer package, running against a stale build *(applied)*

- **Location:** `packages/cms/src/utils/socialNavigation.test.ts`,
  `packages/cms/src/utils/socialCount.test.ts`
- **Problem:** both import from `@sitesurge/types` and test shared code, but ran
  under the **cms** vitest config — which resolves the package to
  `packages/shared/dist`, the **built** output.
- **Why it matters:** this is not theoretical. During this window a change to a
  shared util was invisible to its own tests until `tsc` was re-run in
  `packages/shared`; the tests passed against the previous build. A test that can
  pass against stale code is worse than no test, because it reports confidence it
  does not have. `packages/shared` has had its own vitest runner since it gained
  `format.test.ts`, and tests there run against **source**.
- **Fix:** moved both into `packages/shared/src/utils/`, importing `./socialDisplay`
  directly.
- **Verified:** 29 tests moved. cms 261 → 232, shared 68 → 97; total 329 before
  and after, so nothing was lost or silently skipped.
- **Risk:** low. Applied.

> **Deliberately NOT moved:** `richTextTypography.test.ts`. It looked like a third
> instance, and moving it broke the run — it also imports `appearanceStyle` and
> `pasteCleanup`, which live in cms **on purpose** (`pasteCleanup` needs a DOM and
> `@sitesurge/types` is environment-free). It genuinely spans both packages and
> belongs where it is. Reverted.

### T2 — `buildSiteVariables` fed three runtimes with no tests *(applied)*

- **Location:** `packages/shared/src/utils/siteVariables.ts`
- **Problem:** the `{{site.*}}` bag is consumed by the client template engine,
  the mail renderer (`mailTemplates.ts:220`) and SSR
  (`ssr/templateRuntime.ts:184,189`). Its own doc comment records that those three
  had previously drifted into three different shapes. Nothing pinned the shape
  they converged on.
- **Why it matters:** `{{site.logo}}` has already failed in production twice —
  once rendering the catalog's placeholder `https://example.com/logo.png`, once
  arriving in an inbox as an unresolvable relative path. The spread order
  (raw keys first so canonical names win a collision) and the absolutising of
  asset paths are both load-bearing and both invisible to a reader.
- **Fix:** added `siteVariables.test.ts` — 13 tests covering the canonical names,
  backward-compatible raw keys, collision precedence, asset absolutising
  (relative, already-absolute, protocol-relative, `data:`, trailing/missing
  slashes) and the empty-string-never-undefined contract.
- **Verified:** 4 mutations introduced, all 4 caught.
- **Risk:** low (test-only addition). Applied.

### T3 — `useNavigationGuard` is untested while its sibling is

- **Location:** `packages/cms/src/hooks/useNavigationGuard.ts`
- **Problem:** `useEditorDraft` shipped with a 13-case test file; the guard
  beside it shipped with none, despite holding the `retry` callback that decides
  whether an operator's unsaved work survives a navigation.
- **Why it matters:** the `confirmLeave` path calls `retry?.(true)` — the `true`
  exists to stop the guard re-intercepting its own retry and looping. Nothing
  pins that.
- **Fix:** test it with a stubbed `@solidjs/router` `useBeforeLeave`; assert the
  dirty/clean gate, `isSelfNavigation` bypass, and that confirming forces the
  retry exactly once.
- **Risk:** low, but needs a router mock, so it is Phase B rather than a
  drive-by.

### T4 — Load-bearing modules shipped untested

- **Location:** `packages/api/src/services/adminChannel/peers.ts`,
  `services/mail/scheduleCron.ts`, `services/backup/cron.ts`,
  `packages/shared/src/utils/pageTitle.ts`
- **Problem:** cross-process presence merging, the scheduled-send due-window
  sweep and the backup cron all landed without tests.
- **Why it matters:** `scheduleCron` decides *when a newsletter goes out*, and
  its documented catch-up policy ("a daily schedule that missed three days sends
  ONCE") is a behavioural promise with no test behind it. `peers.ts` is inert
  unless `CLUSTER_WORKERS > 1`, so a regression there would be invisible in
  single-process development and only appear in production.
- **Fix:** unit-test the pure parts — the due-window predicate and the roster
  merge — without standing up Redis or node-cron.
- **Risk:** medium (needs fixture design). Phase B/C.

---

## 4. Architecture & code quality

### A1 — `findStringEnd` implemented twice, byte-for-byte *(applied)*

- **Location:** `packages/shared/src/utils/scopeCss.ts:114` and
  `packages/api/src/services/mail/blocks/customCss.ts:201`
- **Problem:** the same 12-line escape-aware string scanner, identical apart from
  the parameter name.
- **Why it matters:** it is the primitive that keeps a `}` inside
  `content: "}"` from being read as structure. Two copies is two chances for
  escape handling to diverge, and the failure mode is mangled CSS injected into a
  live page or an email.
- **Fix:** exported from `scopeCss.ts`; the api copy deleted.
- **Risk:** low. Applied.

### A2 — The lint pass depended on the renderer *(applied)*

- **Location:** `packages/api/src/services/mail/cssLint.ts:25` →
  `./blocks/customCss`
- **Problem:** `cssLint` analyses an operator's CSS and emits warnings. It
  reached into the email **renderer** for `parseDeclarations`.
- **Why it matters:** a dependency pointing the wrong way. The lint does not
  render, and nothing should stop the renderer being restructured without
  dragging the lint with it. (I introduced this edge earlier today.)
- **Fix:** `parseDeclarations` hoisted to `@sitesurge/types` beside
  `parseCssRules` and `findStringEnd`, which it already depends on. `customCss.ts`
  re-exports it so existing importers are unaffected.
- **Risk:** low. Applied; 253 mail tests still pass.

### A3 — The media-radius fragment written out four times *(applied)*

- **Location:** `blocks/image.ts:43`, `blocks/video.ts:16-17`,
  `blocks/carousel.ts:21-22` (and a variant in `social.ts`, `urlLink.ts`)
- **Problem:** each renderer built `radius ? ';border-radius:' + radius : ''` by
  hand. `video.ts` and `carousel.ts` were identical two-line blocks; `image.ts`
  called `mediaRadius(node)` **twice in one expression** to avoid a local.
- **Why it matters:** these style strings are assembled by concatenation with
  conditional fragments, so every copy is a chance to drop or double a `;`. The
  email tests already carry an assertion (`not.toMatch(/;\s*;/)`) that exists
  precisely because that class of bug is easy here.
- **Fix:** `mediaRadiusCss(node, fallback?)` in `blocks/_util.ts` returns the
  fragment including its leading separator, so callers append without thinking
  about punctuation.
- **Risk:** low. Applied; 253 mail tests still pass.

### A4 — Four overlapping hooks for one concern

- **Location:** `packages/cms/src/hooks/` — `useEditorState.ts` (76 lines,
  2 callers), `useUnsavedChanges.ts` (32, 2), `useEditorDraft.ts` (75, 1),
  `useNavigationGuard.ts` (74, 1), plus the heavyweight `useEntityEditor`.
- **Problem:** `useUnsavedChanges` and `useNavigationGuard` do the **same job** —
  `beforeunload` + `useBeforeLeave` — and `useNavigationGuard` is a strict
  superset: it hands the decision to the caller so the admin's own `ConfirmModal`
  can render it, and adds an `isSelfNavigation` escape hatch for the
  save-then-redirect case. `useUnsavedChanges` still fires a native
  `window.confirm`.
- **Why it matters:** this is **user-visible inconsistency**, not just
  duplication. Leaving the mail template editor dirty shows the admin's styled
  modal; leaving the Campaign editor or the Form editor dirty shows an
  OS-styled browser box that cannot say which editor it came from. The newer hook
  was written for exactly this and its own doc comment says so, but the two
  older call sites were never migrated.
- **Fix:** keep `useUnsavedChanges` as the owner of the dirty flag (its
  `markDirty`/`markClean` API is what the two editors use), but delegate the
  guard to `useNavigationGuard` and return `pending`/`confirmLeave`/`cancelLeave`
  so `CampaignEditor` and `FormEditor` can render `ConfirmModal`. One
  `beforeunload` implementation instead of two.
- **Risk:** medium — one shared hook plus two editors. **Phase B.**

### A5 — `customCss.ts` carries three unrelated responsibilities

- **Location:** `packages/api/src/services/mail/blocks/customCss.ts` (419 lines)
- **Problem:** the file contains (a) a CSS selector/declaration **parser**
  (`parseCompound`, `parseSelectorChain`, `serialize`), (b) a DOM-free **selector
  engine** over an HTML string (`compoundMatches`, `matchesChain`, the open-tag
  stack, `VOID_ELEMENTS`, `withStyle`, `applyInlineRules`), and (c) the
  email-**delivery policy** that decides which of the three groups a rule belongs
  to (`planCustomCss`, `importantify`).
- **Why it matters:** (b) is a genuinely reusable component — a tiny selector
  matcher — currently buried in a mail-specific module, which is why the lint had
  to import from here (A2). The policy in (c) is the only part that is about
  email at all.
- **Fix:** split into `cssSelectors.ts` (parse), `htmlInliner.ts` (match +
  rewrite), and keep `customCss.ts` as the policy. Pure file moves; the 55
  existing tests should pass unchanged.
- **Risk:** medium — a file restructure with no behaviour change. **Phase B.**

### A6 — SSR still emits no block CSS, and the gap is widening

- **Location:** `packages/api/src/services/ssr/` — no reference to `blockCss`,
  `borderRadius` or `customCss` anywhere.
- **Problem:** a pre-existing, documented gap. Server-rendered HTML carries the
  block markup but none of the block styling; the SPA applies it on mount.
- **Why it matters:** **it got worse in this window.** Before, SSR was missing
  per-breakpoint overrides. It is now also missing border-radius, the
  `overflow: hidden` that pairs with it, and arbitrary operator Custom CSS — so
  the flash of unstyled content before hydration is a bigger visual delta than it
  was, on exactly the pages that are server-rendered for SEO.
- **Fix:** `blockCss()` already lives in `@sitesurge/types` specifically so SSR
  can call it. The work is walking the block tree in `ssr/routes.ts` (which
  currently feeds a flat list, so groups emit nothing either) and emitting one
  `<style>` into the head.
- **Risk:** high — touches the SSR pipeline and changes what every crawler sees.
  **Phase C: needs its own plan.**

---

## 5. Recommended execution plan

### Phase A — low risk, applied automatically

| # | Change | Verified |
|---|--------|----------|
| A1 | `findStringEnd` hoisted to `@sitesurge/types`; api copy deleted | tsc 0, 253 mail tests pass |
| A2 | `parseDeclarations` hoisted; `cssLint` no longer imports the renderer | tsc 0, 42 lint tests pass |
| A3 | `mediaRadiusCss()` replaces four hand-built fragments | tsc 0, 253 mail tests pass |
| T1 | 2 shared-module test files moved into `packages/shared` | 29 tests, totals reconcile 329 → 329 |
| T2 | `siteVariables.test.ts` added — 13 tests | 4/4 mutations caught |

### Phase B — applied (user approved all five)

| # | Change | Verified |
|---|--------|----------|
| A4 | `useUnsavedChanges` delegates to `useNavigationGuard`; Campaign + Form editors now render the admin `ConfirmModal` instead of a native `window.confirm` | cms tsc 8 (baseline), 242 tests pass |
| A5 | `customCss.ts` (419 lines) split into `cssSelectors.ts` (106) + `htmlInliner.ts` (169) + `customCss.ts` (115, policy only) | 253 mail tests pass **unchanged** |
| T3 | `useNavigationGuard.test.ts` — 10 tests, router stubbed | 6/6 mutations caught |
| U1 | New footer Border radius field commits on blur | cms tsc/tests clean |
| U2 | `resolveSocialItemRadius` documented as a delegating alias | shared tsc clean |

**A4 note — what changed for users:** leaving the Campaign or Form editor with
unsaved changes previously raised an OS-styled browser dialog that could not say
which editor it came from. It now raises the same *"Unsaved changes — Discard and
leave / Stay on this page"* modal the mail template editor uses. The
`beforeunload` (tab-close) half is unchanged and still native, because no page is
permitted to draw that one.

**A5 note — what did NOT change:** the split is pure file moves. `customCss.ts`
re-exports `applyInlineRules`, `InlineRule` and `parseDeclarations`, so every
existing importer and all 55 custom-CSS tests are untouched. The extracted
`htmlInliner.ts` is now a general, mail-agnostic selector engine — which is what
made the A2 dependency inversion possible to fix properly.

### Phase C — plans written (user requested both)

- **A6** — `docs/superpowers/plans/2026-09-25-ssr-block-css.md`.
  Three tasks: a tree-walking CSS collector, fixing the flat block list (which
  is also why groups emit no SSR *content* today), and head injection. Names the
  two decisions to settle first — whether to skip the `@container` preview
  variants, and the payload budget.

- **C1** — `docs/superpowers/plans/2026-09-25-editor-keystroke-lifting.md`.
  **Task 0 is "reproduce it first, do not skip".** The plan is written from code
  reading and the focus loss was never observed; if it does not reproduce, the
  plan says to stop and re-scope rather than execute. Task 1 (list → `createStore`)
  and Task 3 (inputs → blur) are separate commits so either can be reverted alone.

---

## 5b. Second pass — parallel sub-audits

Three analysis agents swept the cms, api and shared boundaries in parallel.
**Every claim below was re-verified against the code before being recorded**, and
one was materially overstated (see S1).

### P1 — SSR and the SPA emit DIFFERENT JSON-LD, and the SPA's is poorer *(confirmed on production; PRE-EXISTING)*

- **Location:** `packages/api/src/services/ssr/schema.ts` (209 lines) vs
  `packages/cms/src/utils/schema.ts` (210 lines)
- **Problem:** two same-named modules build the same JSON-LD for the same pages
  and have drifted. Measured on `https://surgemedia.us/`:

  | | `NewsMediaOrganization` | `WebSite` / SearchAction |
  |---|---|---|
  | Raw HTML (no JS) | **10 keys** — `description`, `alternateName`, `areaServed`, `email`, `logo`, `sameAs`… | present |
  | After hydration | **5 keys** | **gone** |

  The API module exports `buildWebSiteSchema` with no cms twin; the cms module
  exports `buildFAQ` with no api twin; the shared builders have different names
  (`buildOrganizationSchema` vs `buildOrganization`).
- **Why it matters:** a crawler that executes JS — Google does — ends up with a
  strictly poorer Organization node and loses the sitelinks SearchAction
  entirely. This is the bug class `buildDocumentTitle` was hoisted to shared to
  kill: two surfaces, each internally consistent, disagreeing with each other,
  and nothing flags it.
- **Scope note:** **pre-existing.** Both files date from the June 2026 monorepo
  refactor and neither was touched in this window. Recorded anyway because it is
  live, confirmed, and squarely the kind of duplication this pass was asked to
  find.
- **Fix:** hoist to `packages/shared/src/utils/schemaOrg.ts`, reconciling
  field-by-field (superset wins); both files become re-export shims. Then work
  out why the SSR tags disappear on mount — they are in `<head>`, not `#root`,
  so something is clearing them.
- **Risk:** medium-high. Changes emitted markup on every page. **Phase C.**

### P2 — The Custom CSS cap was invisible to the operator *(applied)*

- **Location:** `BlockStyleEditor.tsx:767`; cap at `api/blockStyleInput.ts`
- **Problem:** the 16 KB cap I added in this window lived in `packages/api`, so
  the editor could not import it. No counter, no warning. An operator pasting a
  long sheet learns about it when the **page** save fails — by which time the
  block panel that owns the field is closed.
- **Fix:** `BLOCK_CUSTOM_CSS_MAX` moved to `@sitesurge/types` (api re-exports
  it, so the zod schema still has one source of truth); the editor shows
  `12,431 / 16,384` once the sheet passes 80% of the cap, in the primary colour
  past it.
- **Risk:** low. Applied.

### P3 — Typing in the mail Subject re-rendered every templated block *(applied)*

- **Location:** `stores/previewVariables.ts`; publishers `MailTemplateEdit.tsx:244`,
  `MailSend.tsx:112`
- **Problem:** the publisher rebuilds the whole variable bag inside a
  `createEffect` that also tracks `name()`/`subject()`/`preheader()`, returning a
  **new object per keystroke**. `TemplatedContent` keys a `createResource` on
  that signal, so every templated block in the editor re-ran `renderTemplate` —
  once per character, getting slower as the template grew.
- **Fix:** an `equals` guard on the signal itself, so identical content is not a
  change. One line in the store fixes every publisher, present and future,
  rather than debouncing each one.
- **Verified:** 3 tests; 2 mutations (guard removed / guard always true), both
  caught.
- **Risk:** low. Applied.

### P4 — Scheduled Sends table vanished after every action *(applied)*

- **Location:** `components/admin/mail/ScheduledSends.tsx:210`
- **Problem:** `<Show when={!schedules.loading}>`. Solid sets `loading` during a
  **refetch**, not only the first load, and pause/resume/delete/save all refetch
  (lines 154, 166, 182). Pressing Pause replaced the whole table with "Loading…"
  and rebuilt it, so the row the operator just acted on jumped.
- **Fix:** gate on `schedules() !== undefined` — "has it ever arrived" rather
  than "is it in flight".
- **Risk:** low. Applied.

### S1 — `escapeHtml` re-declared twice — but NOT a security issue *(correcting the sub-audit)*

- **Location:** canonical `api/src/utils/html.ts:12` (escapes `& < > " '`);
  copies at `api/src/services/events/format.ts:26` and
  `shared/src/utils/markdown.ts:22` (both omit `'`)
- **The claim I was given:** that the weaker copy's output "goes into email HTML
  attributes", implying an injection risk.
- **What I found:** **it does not.** All four uses in `events/notifications.ts`
  (lines 33–36) are element TEXT content. `markdown.ts` escapes the whole source
  once up front and emits only double-quoted attributes, with URLs additionally
  protocol-allow-listed. Missing `'` is inert in both.
- **What IS true:** the canonical file's own comment says "do not re-declare
  this elsewhere; import it", and it is re-declared twice. It also sits in
  `packages/api`, so `packages/cms` cannot reach it — the next cms surface that
  needs one will invent a fourth.
- **Fix:** move the 5-character version to `@sitesurge/types`; have both copies
  import it. A consistency fix, not a security fix — and worth stating plainly,
  because shipping it as a "security fix" would misrepresent the risk.
- **Risk:** low. **Phase B/C** — deferred, not urgent.

### Remaining sub-audit findings, not yet triaged

`stripHtml`/`truncateText` byte-identical across packages; `swatch:` reference
parsing duplicated between the web and mail resolvers; the CSS-value text field
hand-copied ~15 times (including the two added in this window). The api-boundary
sweep had not reported when this document was written.

---

## 6. Verification

After Phase A **and** Phase B:

```
shared   tsc: clean        97 tests passed
api      tsc: 0 errors    923 passed / 3 failed (pre-existing: auth.test.ts needs JWT_SECRET)
cms      tsc: 8 errors (unchanged baseline)   242 tests passed  (+10 from T3)
```

The 8 cms type errors and the 3 auth test failures are the documented
pre-existing baseline, identical before and after this pass.

## 7. Documentation

No user-facing documentation changed. Every Phase A item is an internal
refactor or a test addition — no public API, CLI surface, config key, default
value or visible behaviour moved. `docs/API.md` and `docs/api-manifest.json`
were last regenerated 2026-09-20, after the final route addition in this window;
the route-module edits since then narrowed zod schemas without adding or
removing a route.
