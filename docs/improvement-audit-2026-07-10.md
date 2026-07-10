# Improvement Audit — 2026-07-10

## 1. Summary
- Project: SiteSurge CMS (`rw-cms`)
- Working directory: `/home/rw3iss/Sites/rw/rw-cms`
- Focus (per request): refine recent features + give all **admin** sections
  professional, well-separated layouts with sensible section/input widths.
- Scope of this pass: shared admin styling primitives (highest leverage — one
  change lifts every admin page) + targeted polish on the recently-built shop
  surfaces. Full per-page bespoke restyle of all 16 admin pages is Phase C.

## 2. UI & UX improvements

### F1 — Admin content sprawls edge-to-edge on wide screens  ·  HIGH impact · LOW risk
- **Where:** `packages/cms/src/pages/admin/styles/_admin-shell.scss` `.admin-layout__main` (no max-width; `padding: $spacing-xl` only).
- **Problem:** On a 1440px+ display the content column fills the entire main area (~2300px on a 2560 screen). Forms, settings cards, and inputs stretch to unreadable widths — the single biggest "unprofessional" tell.
- **Fix:** Cap the content column to a token max-width (`$admin-content-max-width`, 1400px), centered, so content sits in a balanced, readable column over the full-bleed page background. Tables, dashboards, and 2-col editors all fit comfortably.

### F2 — Form inputs stretch to the full container width  ·  HIGH · LOW
- **Where:** `_forms.scss` `.admin-form-field` controls, `_admin-shell.scss` `.admin-form input/select/textarea` — all `width: 100%` with no cap.
- **Problem:** Even inside a capped column, a lone text input at 1400px reads poorly (eyes travel too far). Field width should be bounded to a comfortable line length.
- **Fix:** Cap admin form controls at a readable max (`~46rem`). Narrow columns/cells still get 100% (they're under the cap); wide single-column forms get a tidy field column. Matches the "reasonable width for each input type" ask.

### F3 — Inconsistent section separation & vertical rhythm  ·  MED · LOW
- **Where:** cards/sections across settings, editors, shop.
- **Problem:** Some card children sit flush (fixed for shop settings already); section headers, card padding, and inter-section gaps vary.
- **Fix:** A shared, consistent card/section spacing rhythm (padding, header treatment, gap) via the existing `.settings-card` / `.admin-form-section` primitives; extend the shop-settings row-gap pattern to the shared layer where safe.

### F4 — Recent shop features polish  ·  MED · LOW
- Product editor, shop settings (Stripe panel), shop dashboard, campaign editor were freshly built/reorganized. Tighten consistency with the new width/spacing system (headers, card treatment, field widths) so they read as one cohesive admin.

## 3. Styling & design system
- **Tokens present:** `variables.scss` has spacing/radii/breakpoints/`$container-max-width` (1200, used only for the public container). No **admin** content-width token → add `$admin-content-max-width` + `$admin-form-max-width` and use them.
- **Approach:** SCSS partials per feature (good). Improvements stay within this — no new system, no new deps. Extend shared primitives; don't fork.

## 4. Architecture & code quality
- Not the focus of this request (styling-led). Recent features already went through per-feature reviews. No architectural refactor applied in this pass. (Any component-API consolidation = Phase C.)

## 5. Recommended execution plan
- **Phase A (apply now, low risk):** F1 (content max-width), F2 (input width cap), F3 (shared section rhythm), F4 (shop polish). Verify per page via live screenshots; tsc + build gate.
- **Phase B (n/a this run):** user delegated "to the best of your ability… test and push"; low-risk styling applied directly.
- **Phase C (plan later):** bespoke per-page redesigns, shared-component API consolidation (unify one-off widgets), a full design-token sweep of remaining hardcoded values.

## 6. Applied changes (Phase A)

- **F1 — Content column cap.** `variables.scss`: `$admin-content-max-width: 1400px`.
  `_admin-shell.scss` `.admin-layout__main > *:not(.admin-full-bleed)` → capped +
  centered. Every admin page now reads as a balanced centered column over the
  full-bleed page bg instead of sprawling edge-to-edge. Opt-out hook
  `.admin-full-bleed` added for any page that wants full width.
- **F2 — Form control width cap.** `variables.scss`: `$admin-form-max-width: 46rem`.
  `_admin-shell.scss` caps `input/select/textarea` (excluding checkbox/radio/range)
  under `.admin-layout__main` to a readable line length; narrow containers/cells/
  inline fields stay 100% (already under the cap).
- **F3 — Form field separation.** `components/admin/forms/forms.scss`
  `.admin-form-section__items` base gap `$spacing-sm` → `$spacing-md` (8px→16px)
  for cleaner separation; the `--tight` checkbox-grid variant is unchanged.
- (Prior tasks this session already refined the recent shop/campaign surfaces —
  product editor 2-col, shop settings row-gap + Stripe status panel, shop
  dashboard nav columns, checkout width/autofill — F4 is largely satisfied by
  those; this pass adds the global width discipline on top.)

**Verification:** `npm run build -w packages/cms` clean (SCSS compiles, no errors);
changes are standard, low-blast-radius CSS. **Live visual review was blocked** —
the headless Chrome in this environment repeatedly failed to launch (180s
timeouts), so per-page screenshots couldn't be captured this run. The changes are
conservative by design; recommend an eyeball pass across a few wide-screen admin
pages (Settings, an editor, a list) and a follow-up run once the browser is
available to fine-tune per-page widths (Phase C).

## 7. Phase C — per-type width tuning (applied, visually verified)

The headless-Chrome launch was fixed (stale `SingletonLock` symlink in the MCP
profile pointing at a dead PID — removed; not a code issue). With the browser
working, each page type was screenshotted and tuned:

- **F5 — Single-column form pages get a tidy width.** `_shop.scss`:
  `.admin-layout__main > .shop-settings` → `max-width: 60rem`, and its
  settings-card controls fill the (now-narrow) card (override the 46rem field
  cap locally). A single-column settings form is no longer a wide, near-empty
  1400px card — it's a compact, aligned form (header + tabs + card share the
  60rem column). Verified on all four shop-settings tabs incl. the Stripe panel.

**Per-type verification (screenshots reviewed at 2560px):**
| Page type | Example | Result |
|---|---|---|
| 2-col card grid | `/admin/settings` | Balanced, centered @1400 ✓ |
| Single-col form | `/admin/shop/settings` | Tidy @60rem, inputs fill card ✓ |
| Data list/table | `/admin/posts` | Contained table @1400 ✓ |
| 2-col editor | `/admin/shop/products/:id`, `/admin/campaigns/new` | Columns fill @1400, full-width tables below ✓ |
| Status panel | Payments tab | Clean; live Stripe status ✓ |

## 8. Still deferred (future Phase C)
- Per-tab narrowing for the *main* Settings single-column tabs (Site Header/
  Footer/Connections) — same `.admin-narrow`-style treatment; low risk, do when
  touching those pages.
- Shared-component consolidation (unify one-off widgets into configurable ones).
- Full design-token sweep of remaining hardcoded values.

## 9. Documentation
No user-facing API/CLI/config surface changed (admin CSS only) → no README/docs
sync required. This audit records the styling changes.
