# Improvement Audit — 2026-07-18

Scope (per request): **forms** (public renderer, admin editor, submissions,
actions) and the **`{{ … }}` variable/function parsing system**, plus anything
directly related.

## 1. Summary
- Project: SiteSurge CMS (`@sitesurge/*` monorepo)
- Working directory: `/home/rw3iss/Sites/rw/rw-cms`
- Total findings: 12 (UI: 4, styling: 2, architecture: 6)

## 2. UI & UX improvements

### F1 — Public form ignores per-question validation *(applied — Phase A)*
- Location: `packages/cms/src/components/forms/FormRenderer.tsx`.
- Problem: `FormQuestion.validation` (`minLength/maxLength/min/max/pattern/patternMessage`)
  is stored + typed but never applied — the renderer only sets `required`.
- Fix: map validation → native input attributes (`minlength/maxlength/min/max/
  pattern/title`), add `inputmode`/`autocomplete` for email/number. Additive,
  no behavior change for forms without validation. Risk: low.

### F2 — FormEditor doesn't use the shared `FormField` primitive *(Phase B)*
- Location: `packages/cms/src/pages/admin/FormEditor.tsx` (raw `.form-group`
  markup vs. `components/admin/forms/FormField`).
- Problem: inconsistent label typography/tooltips vs. block editors. Risk: medium
  (touches the whole editor's markup).

### F3 — No `requiresAuth` toggle in FormEditor *(Phase B)*
- Location: `FormEditor.tsx`. `requiresAuth` is in the schema/DB/type but has no
  UI, so operators can't require login to submit. Risk: low-medium (additive).

### F4 — FormRenderer has no per-field error display *(Phase B)*
- Only a single top-level error banner; a field-level error state + `aria-invalid`
  would be clearer. Risk: medium.

## 3. Styling & design system

### S1 — Hardcoded brand rgba in FormRenderer.scss *(applied — Phase A)*
- Location: `FormRenderer.scss:125` `rgba(230, 57, 70, 0.04)` (literal brand red)
  and `:67-68` literal input bg/text.
- Fix: use `rgba($primary-color, …)` / theme tokens with fallbacks. Risk: low.

### S2 — FormEditor action section styling *(applied earlier)*
- `.form-subaction` / `.form-vars` already token-based (added with the feature).

## 4. Architecture & code quality

### A1 — Template value/utility functions duplicated 2× and missing from forms *(applied — Phase A)*
- Location: `packages/cms/src/services/template/runtime.ts:135-141`,
  `packages/api/src/services/ssr/templateRuntime.ts` (resolve switch),
  `packages/api/src/services/formActions.ts` (`resolve: () => undefined`).
- Problem: `upper/lower/truncate/formatDate/formatCurrency/formatNumber/default/
  now/year` are copy-pasted between the cms and SSR runtimes, and the form-email
  runtime has none — so form email templates can use `{{field}}` but not
  `{{upper(name)}}` / `{{formatDate(submitted_at)}}` / `{{default(name,'there')}}`.
- Fix: one shared `resolveValueFunction()` in `@sitesurge/types`
  (`packages/shared/src/template/valueFunctions.ts`); all three runtimes delegate
  to it (behavior-preserving for cms/SSR, additive for forms). Also adds `trim`.
  Risk: low (identical implementations consolidated) — build-verified.

### A2 — Two near-identical "render template → string" helpers *(Phase B)*
- `resolveContentForSsr` (ssr/templateRuntime) and `renderTpl` (formActions)
  both do `hasTemplateSyntax` gate → `renderTemplate` → flatten `html` nodes →
  try/catch fallback. Could share a `renderTemplateToString(src, runtime, onEntity?)`
  helper. Risk: low-medium.

### A3 — FormEditor is untyped (`data: any`, `payload as any`) *(Phase B)*
- Losing DTO type-safety across load/save. Type against `Form` / `FormCreateBody`.
  Risk: medium (may surface latent mismatches).

### A4 — Answer-value flattening duplicated *(Phase B)*
- `formActions.formatValue` and `forms.exportSubmissionsCsv` both join array
  answers to a string. Extract one `formatAnswerValue()`. Risk: low.

### A5 — `email` action supports functions but the editor help doesn't say so *(applied — Phase A)*
- The variables help lists field tokens only. Add a short note that value
  functions work. Docs: `docs/FORM_ACTIONS.md`. Risk: low.

### A6 — Full FormField migration across all admin editors *(Phase C — plan)*
- Unifying every block/form/settings input onto `FormField` is a broad,
  cross-cutting refactor (>10 files). Deserves a dedicated plan.

### A7 — BUG: question edits to an existing form were silently dropped *(applied — Phase B)*
- Location: `packages/api/src/services/forms.ts` `update()`.
- Problem: `forms.update` only patched form columns; the `questions` array the
  editor sends on save was ignored, so editing/adding/removing questions on an
  existing form never persisted (create worked; update didn't).
- Fix: `syncQuestions()` reconciles the submitted list — update by id, create
  new, delete removed. Question `id` now survives validation (`FormQuestionInput.id`
  + zod). Risk: medium (new behavior) — API test suite (118) still green.

## 5. Recommended execution plan
- **Phase A (applied):** A1 (shared value functions → forms gain functions),
  F1 (form validation attributes), S1 (token fixes), A5 (editor help + docs),
  `submitted_at` as a Date. *(committed 717022f, deployed)*
- **Phase B (applied):** F2 (FormField for Form-Details fields), F3 (requiresAuth
  toggle), F4 (per-field inline errors), A2 (shared `renderTemplateToString`),
  A3 (typed editor — dropped `any`), A4 (shared `formatAnswerValue`), **A7**
  (question-persistence bug fix). Build + 118 API tests green.
- **Phase C:**
  - ✅ **Transaction** — `syncQuestions` moved into a single transactional repo
    function (`forms.repo.syncQuestions`, mirroring `mailTemplateBlocks.repo.save`);
    the reconcile is now all-or-nothing.
  - ✅ **FormEditor → FormField (completed)** — Form-Details + the On-Submit
    action section now use the shared `FormField` (its `tooltip`/`hint` replaces
    the manual `<label> + <Tooltip>` / `<small>` boilerplate).
  - ⏸ **App-wide FormField sweep (deferred, awaiting decision)** — ~100 remaining
    `.form-group` instances across CampaignEditor (16), PostEditor (12),
    Settings (12), PageEditor (6), ConnectionEditor (5), and the block-type
    editors. `.form-group label` already renders **identically** to
    `.admin-form-field__label` by design, so this is a code-consistency sweep,
    not a visual fix — high blast radius, low per-file reward. Recommend a
    dedicated, reviewed pass rather than folding it into this one.
