# Improvement Audit — 2026-08-12

## 1. Summary

- **Project:** SiteSurge CMS (`@sitesurge/*` monorepo — `shared`/`api`/`cms`/`cms-client`/`cms-mcp`)
- **Working directory:** `/home/rw3iss/Sites/rw/rw-cms`
- **Scope of this pass:** DRY / reuse / SOLID + UI consistency + styling-token unification, per the `/improve` directive. Read-only audit → low-risk Phase A auto-applied (build-verified) → Phase B presented for approval → Phase C planned.
- **Conventions respected** (from `CLAUDE.md` + `ADMIN_STYLES.md`): the `defineRoute`/`registerModule` manifest framework, "services own logic / repositories own SQL", the `CACHE_KEYS` cache-key contract (no raw `cache.del` outside `cache.ts`), DTOs live in `@sitesurge/types`, `mapRow` snake→camel, `FormField` for admin fields, `$*`/`--site-*`/`--admin-*` design tokens, and the known dprint drift caveat (format only touched files).

Findings below are grouped UI → Styling → Architecture, each with location, problem, fix, and risk. The execution plan (§5) sorts them into Phase A/B/C.

---

## 2. UI & UX / component reuse

### U1. `components/ui/Button.tsx` exists but has **0 imports**; 316 raw `.btn` buttons
- **Location:** `packages/cms/src/components/ui/Button.tsx` (+ `Button.scss`); raw `class="btn …"` used in ~316 call sites across `packages/cms/src`.
- **Problem:** a capable `Button` primitive (variants, sizes, `loading` spinner, `leadingIcon`/`trailingIcon`, `block`) is unused — every button is a hand-written `<button class="btn btn--primary">`. Loading/disabled/icon states are re-implemented ad-hoc per call site (e.g. the checkout `Continue`/`Place Order` buttons, entity Copy spinner, feature-toggle busy states).
- **Fix:** adopt `Button` incrementally starting with new/loading buttons; OR (if the team prefers the class API) treat `Button` as dead and remove via `/dead-code`. Not an auto-migration (behavioral parity across 316 sites).
- **Risk:** high (breadth) — Phase C decision.

### U2. `ConfirmModal` under-adopted — 6 files hand-roll `confirm-modal` markup
- **Location:** shared `components/admin/common/ConfirmModal.tsx`; hand-rolled `confirm-modal` markup in `pages/admin/Settings.tsx`, `pages/admin/shop/ShopCollections.tsx`, `pages/admin/shop/ShopCategories.tsx`, `components/admin/mail/MailPreviewModal.tsx`, `components/admin/mailing-lists/SubscriberFormModal.tsx`, `components/admin/blocks/BlockEditor.tsx`.
- **Problem:** `ConfirmModal` only accepts a plain `message: string`, so richer confirmations (type-to-confirm inputs, warning lists) can't use it → they hand-roll the overlay + actions, duplicating markup + the `.confirm-modal__actions` button pair.
- **Fix:** extend `ConfirmModal` with backward-compatible optional props — `children` (body slot, used instead of `message`), `loading` (disables + spinners the confirm button), `busyLabel`. Then migrate the simple hand-rolled ones. Adding the props is low-risk (existing callers unaffected); each migration is medium-risk (per-file parity).
- **Risk:** Phase A (extend the component) + Phase B (migrations).

### U3. `empty-state` class hand-written 54× — no `<EmptyState>` component
- **Location:** `class="empty-state"` in 54 spots across admin lists/tables.
- **Problem:** every list/table re-writes `<div class="empty-state">No X found.</div>` (some with icons/actions, some without) — inconsistent copy + no shared affordance for an optional icon / call-to-action.
- **Fix:** add `components/admin/common/EmptyState.tsx` (`message`, optional `icon`, optional `action` slot) rendering the existing `.empty-state` class; adopt incrementally.
- **Risk:** low (additive) — Phase A to add; adoption Phase B.

### U4. Two parallel UI kits — `components/ui/*` vs `components/admin/forms` + raw `.btn`
- **Location:** `components/ui/*` (Button/FormField/FormSection/Input/Select/Tabs/Alert/Spinner/…) is imported by **only 8 files, all `pages/setup/*`**; the rest of the admin uses `components/admin/forms/FormField` (18 files) + raw `.btn`. `ui/FormField` (has `error`/`required`/`for=` a11y) and `admin/forms/FormField` (has `tooltip`/`hint`/`inline`) are divergent — neither a superset. `Button` (`ui-button` class) used 7×.
- **Problem:** two form systems + two button styles; fixes/a11y land in one, `/setup` silently diverges. Note: adopting `Button` changes the CSS class (`ui-button` ≠ `.btn`) → a **visual** change, not a mechanical swap.
- **Fix:** unify `FormField`/`FormSection` (fold `error`/`required`/`for=` into the admin one), migrate the 8 setup files, retire the `ui/` duplicates; decide one button style.
- **Risk:** high (kit consolidation) — Phase C.

### U5. Admin list-page scaffold copy-pasted ~14× → extract `<DataTable>` (highest-leverage)
- **Location:** `admin-header`+`admin-filter-bar`+optional bulk-bar+`Show loading`+`Show empty`+`admin-table-container`+`SortTh…`+`Pagination` repeats in `Posts/Campaigns/Users/Forms/Pages/Messages/MailingLists/FormSubmissions/CampaignDonations` + `shop/{Orders,Products,Reviews,Categories,Collections}` (`admin-table-container` in 19 files, `admin-filter-bar` in 10). Canonical: `Posts.tsx:48-176`.
- **Problem:** each page re-wires loading/empty/pagination/select-all; the data is already abstracted (`usePaginatedList` 9×, `useBulkActions`) but the markup isn't. Bulk-bar + filter-bar exist unevenly.
- **Fix:** a presentational `<DataTable items loading columns bulk? pagination>` driven by the existing hooks (headless already split — good SOLID base). Absorbs U6 (empty/loading), U10 (bulk bar), U11 (filter bar), U15 (checkbox-col).
- **Risk:** medium — Phase B/C (new shared component + incremental migration).

### U6. No `EmptyState`/`LoadingState` — `.empty-state` hand-written 44–54×, `Loading…` as text not spinner
- **Location:** `<div class="empty-state">Loading…</div>` / `No X found.` in 44 spots; `Spinner` used only 7×.
- **Fix:** add `<EmptyState>` + `<LoadingState>` (wrap `Spinner` + `.empty-state`); adopt incrementally. **Adding them is Phase A**; adoption Phase B.
- **Risk:** low (additive).

### U7. `window.confirm()` 26× + `ConfirmModal` under-adopted (see U2)
- **Location:** 26 native `confirm(...)` call sites; styled `ConfirmModal` used 9×.
- **Fix:** route destructive confirms through `<ConfirmModal danger>` (+ optional `useConfirm()` promise helper). Extend `ConfirmModal` first (U2).
- **Risk:** low per site — Phase B.

### U8. Tabs hand-rolled with 5+ class conventions vs `ui/Tabs`
- **Location:** `settings-tabs__tab--active` (Settings/ShopSettings/EntityDetail), `status-tabs` (MailJob), `social-hub__tab` (SocialHub), `profile__tab` (Profile); `ui/Tabs` used once.
- **Fix:** standardize a single `.tabs` (controlled `active`/`onChange`); keep URL-routed variants controlled. — Phase B.

### U9. `utils/badges.ts` half-adopted; `formatDate` redefined 13×
- **Location:** local status→class switches in `MailingLists/MailJob/MessageView/Plugins/UserDetail/JobManagementPanel` despite `getStatusBadgeClass`; private `formatDate` in 13 files despite shared `formatDate`.
- **Fix:** extend `STATUS_BADGE_MAP` + add a `<Badge status>`; import shared `formatDate` (add a preset). — Phase B (behavioral: mapping/format parity per site).

### U10-U14. Localized DRY: bulk-bar / filter-bar markup dup, public forms raw `<label>+<input>` (Login/Join/Contact/ShopCheckout), `<AddressForm>`/`<AddressDisplay>` not extracted, order-summary/totals block re-authored across cart→checkout→confirmation.
- **Fix:** components `<BulkActionBar>`, `<AdminFilterBar>`, `<AddressForm>`/`<AddressDisplay>`, `<OrderSummary>` (most fold into U5's DataTable). — Phase B.

---

## 3. Styling & design system

### S1. Warning/alert "pill" hex duplicated — `$warning-bg/fg/border` already exist
- **Location:** `pages/admin/styles/_dashboard.scss:135-137,167-168`; `_mailing-lists.scss:415-416,556-557`; `_editor-properties.scss:409-414`.
- **Problem:** `$warning-bg:#fff3cd` / `$warning-fg:#856404` / `$warning-border:#ffeeba` (variables.scss:19-21) exist for exactly this amber pill, but three partials re-hardcode it (bg+fg are **exact** matches → zero-visual swap).
- **Fix:** replace the literals with the tokens; consider a `%status-pill` placeholder later.
- **Risk:** low — Phase A (bg/fg exact; leave the `#ffc107` border alone or map to `$warning-color`).

### S2. `#f59e0b` literal == `$warning-color` (recent additions)
- **Location:** `components/admin/presence/AdminPresence.scss:160`; `pages/shop/shop.scss:982`.
- **Problem:** these two warning-banner borders (added in recent work) hardcode `#f59e0b`, which equals `$warning-color` exactly.
- **Fix:** `border: 1px solid $warning-color;` — zero-visual, tokenized.
- **Risk:** low — Phase A.

### S3. Raw `#fff` panel backgrounds ignore `--admin-panel-bg` (blocks admin theming)
- **Location:** ~25 raw `background:#fff;` in `_pagination.scss:20`, `_inline-editors.scss:328,359,374,423,486`, `_mailing-lists.scss:105,128,181`, `_settings.scss:134`, `_editor-properties.scss:446`, `_block-editor.scss:607`.
- **Problem:** `--admin-panel-bg`/`--admin-input-bg` exist and are used in ~7 places, but most card/panel/input surfaces hardcode `#fff`, so an admin theme (the pattern AdminPresence follows) can't reach them.
- **Fix:** `background: var(--admin-panel-bg, #fff);` (surfaces) / `var(--admin-input-bg, #fff)` (inputs). Fallback identical → zero-visual, enables theming.
- **Risk:** low-medium — Phase A for the unambiguous panel surfaces; verify input-vs-panel per line.

### S4. Duplicate spinner keyframes + `.spinner` re-rolls — `Spinner` primitive exists
- **Location:** `@keyframes spin` in both `global.scss:266` and `_block-editor.scss:1203`; standalone spinner defs in `EntitiesList.scss`, `features.scss`, `Contact.scss`, `Button.scss` besides the canonical `components/ui/Spinner.scss`. `@keyframes skeleton*` duplicated in `global.scss:228` + `_editor-properties.scss:261`.
- **Fix:** keep one `@keyframes spin`/`skeleton` in `global.scss`; delete the `_block-editor` / `_editor-properties` copies; route component spinners through a `%spinner` placeholder or the `Spinner` component.
- **Risk:** low — Phase A (remove the duplicate keyframes).

### S5. No spacing / text utility classes → inline `margin-bottom`/`font-size`/muted-color objects
- **Location:** inline `'margin-bottom':'1rem'` ×18 (+ other sizes), `var(--admin-text-muted,#6b7280)` inline ×9, `'font-size':'0.85rem'` ×11 — heaviest in `Settings.tsx`, `FormSubmissions.tsx`, `FormEditor.tsx`.
- **Problem:** `global.scss` has `.u-flex-*`/`.u-gap-*` but **no** margin/text utilities, so every vertical gap / muted caption is an inline object; `#6b7280` == `$text-light` exactly.
- **Fix:** add `.u-mb-xs…xl` / `.u-mt-*`, `.u-text-muted`, `.u-text-sm`/`.u-text-xs` to `global.scss` (mapped to `$spacing-*`/`$font-size-*`/`--admin-text-muted`). Adopt opportunistically.
- **Risk:** low (additive) — Phase A to add utilities; adoption Phase B.

### S6. Inline-editor greys bypass the palette (22 raw hex)
- **Location:** `pages/admin/styles/_inline-editors.scss` — `#d8d8d8`, `#f6f6f6`, `#b0b0b0`, `#c8c8c8`, `#e5e5e5`, `#555`, `#ececec`, `#111`, `#f0f0f0`, `#e0e0e0`, `#c0c0c0`, `#e8e8e8`.
- **Problem:** ADMIN_STYLES.md claims greys were swept onto `$border-color/$text-color/$text-light`; this partial escaped.
- **Fix:** map onto existing greys; add `$border-color-strong` (~#d8d8d8) / `$bg-muted` (~#f0f0f0) only if a distinct shade is genuinely needed. Near-identical, but not all exact → verify visually.
- **Risk:** medium — Phase B.

### S7. Dashboard categorical stat-pill palette fully hardcoded (12 hex, no token)
- **Location:** `_dashboard.scss:247-252` (blue/green/purple/orange/red/teal bg+fg pairs).
- **Fix:** add a categorical Sass map `$stat-pills` to `variables.scss` and generate modifiers via `@each`.
- **Risk:** low-medium — Phase B.

### S8. Card/panel surface recipe duplicated per feature (no shared card)
- **Location:** `.settings-card`, `.connection-card`, `.stat-card`, shop cards, `.mail-list` cards each redeclare `bg #fff + border $border-color + radius + shadow`.
- **Fix:** `%admin-card` placeholder in `styles/shared/` (surface via `--admin-panel-bg`), `@extend`/compose.
- **Risk:** medium — Phase B.

*(Full styling agent output captured; see findings S1-S8 + the utility/token additions.)*

---

## 4. Architecture & code quality

### A1. `formatMoney` reimplements the shared `formatCurrency`
- **Location:** `packages/api/src/services/shop/orderEmails.ts` `formatMoney(cents, currency)` re-does `Intl.NumberFormat`, while `@sitesurge/types` `utils/format.formatCurrency(cents, currency)` is the canonical (and the cms `money`/admin `formatCents` already delegate to it).
- **Fix:** `formatMoney = (cents, currency) => formatCurrency(cents, (currency || 'usd').toUpperCase())`. Behavior identical.
- **Risk:** low — Phase A.

### A2. `UUID_RE` regex redefined 4× despite `utils/uuid.ts`
- **Location:** identical `^[0-9a-f]{8}-…$/i` in `services/ssr/templateRuntime.ts`, `services/mail/templateRuntime.ts`, `services/entities.ts`, `services/audit.ts`; `utils/uuid.ts` already holds the regex privately.
- **Fix:** `export const UUID_RE` + `isUuid()` from `utils/uuid.ts`; import at the 4 sites.
- **Risk:** low — Phase A.

### A3. `escapeHtml` implemented 4× (unsubscribe, ssr/metaBuilder, ssr/blocks/_util, mail/blocks/_util)
- **Fix:** one `utils/html.escapeHtml`; the block `_util`s re-export. Verify escaping parity first.
- **Risk:** low — Phase B (parity check).

### A4. Two near-identical backend template runtimes (SSR vs Mail)
- **Location:** `services/ssr/templateRuntime.ts` + `services/mail/templateRuntime.ts` duplicate `fetchEntity` (id/slug dual lookup), the `memo` single-flight cache, and the entity-dispatch. Only the whitelisted kinds + whole-entity HTML serializer differ.
- **Fix:** shared `services/template/backendRuntime.ts` (`fetchEntity`/`fetchCollection`/`buildBackendRuntime({context, entityKinds, onEntity})` + `memoAsync`); each surface passes its serializer. Folds in A5 (`memo`).
- **Risk:** medium — Phase B.

### A5. Transactional-email shells hand-written 3× (`mail/renderer`, `orderEmails.wrapEmail`, `mail/verification`) with divergent bg/radius.
- **Fix:** one `services/mail/shell.ts` `wrapEmailShell({title,bodyHtml,…})`. — Phase B (visual snapshot).

### A6. `payment/webhook.ts` mixes routing with inline donation/subscription SQL (SRP)
- **Fix:** thin router → `payments.recordDonationFromIntent`/`applySubscriptionEvent`; move SQL to the service/repo (preserve `stripe_payment_intent_id` idempotency). — Phase B.

### A7. Open/Closed outliers: `search.ts` 8 copy-pasted FTS blocks; `social.ts` inline `twitter` special-casing through the `PROVIDERS` registry; `oauth/index.ts` single-case throwing switch.
- **Fix:** a `SEARCHABLE_ENTITIES` registry → one generic `searchEntity`; widen `SocialProvider` with `readCursor/writeCursor/isSyncEnabled`; an `OAUTH_PROVIDERS` map. — Phase B/C (search + social are behavioral).

### A8. Ad-hoc pagination alongside `paginatedQuery` (campaigns/users/mailingListSubscribers/mailSendJobs/forms repos + search); address field-mapping duplicated 3× (email/Printify/Stripe); manual timestamp mapping in ~7 repos vs `mapRow`; 64 `as never`/`as unknown` casts around entity-service calls that defeat the DTO contract.
- **Fix:** route through `paginatedQuery`/`buildLimitOffset`; a `shop/address.ts` (`toStripeAddress`/`toPrintifyAddress`/`formatAddressLines`); a `mapRowIso` variant; a typed `getEntityGeneric(kind, ref)` facade to drop the casts. — Phase B/C.

**Non-findings (checked clean):** the `CACHE_KEYS` cache-key contract holds (no raw `cache.del` outside `cache.ts`); `defineRoute` is applied consistently (shop's 45 routes are thin delegators — file-size only); swallowed catches are intentional graceful-degradation with logging.

---

## 5. Recommended execution plan

- **Phase A — APPLIED this pass (build ✓ + all 168 API tests ✓; changes left uncommitted for review):**
  - **A1 ✓** `orderEmails.formatMoney` now delegates to the shared `formatCurrency`.
  - **A2 ✓** `UUID_RE` + new `isUuid()` exported from `utils/uuid.ts`; the 4 local copies replaced with imports.
  - **S1 ✓** dashboard + mailing-lists warning-pill `bg/fg` → `$warning-bg`/`$warning-fg` (exact-value, zero-visual).
  - **S2 ✓** `#f59e0b` → `$warning-color` (AdminPresence banner + shop notice).
  - **S4 ✓** removed the duplicate `@keyframes spin` in `_block-editor.scss` (global one covers it).
  - **S5 ✓** added `.u-mb-*`/`.u-mt-*`/`.u-text-muted`/`.u-text-sm`/`.u-text-xs` utilities to `global.scss` (additive).
  - **U2 ✓** `ConfirmModal` extended with backward-compatible `children`/`loading`/`busyLabel` (existing callers unaffected).
  - **U6 ✓** added `EmptyState` + `LoadingState` components (`components/admin/common/`; additive, no adoption yet).
  - **Bonus ✓** fixed 4 **pre-existing broken tests** in `services/shop/products.test.ts` (stale cache mock missing `invalidateShopCatalogCache`; a naive `COUNT(*)` mock that spuriously fired the default-variant synth; a param-index assertion that never matched the literal-valued synth INSERT). These were left red when the variant-stability change landed and the full suite wasn't run. Suite is now fully green.
- **Phase B — APPLIED this pass (full combined build ✓ + 168 API tests ✓; approved all four batches):**
  - **Frontend (me):** U6 `EmptyState`/`LoadingState` **adopted in 10 list pages** (Posts, Pages, Campaigns, Forms, Users, MessageView, Shop Orders/Products/Reviews/Settings) — `Loading…` text now shows a real spinner. U9 `formatDate` unified via a new shared **`formatDateShort`** (null → em-dash preserved) across the 5 core list pages.
  - **Backend DRY (agent):** A3 `escapeHtml` → one `utils/html.ts` (4 copies collapsed). A4 shared `services/template/backendRuntime.ts` (`createAsyncMemo`/`fetchEntity`/`fetchCollection`/`buildBackendRuntime`) consumed by both SSR + mail runtimes. A5 one `services/mail/shell.ts` behind all 3 transactional-email shells. A8 `services/shop/address.ts` (`toStripe`/`toPrintify`/`formatAddressLines`) behind checkout/Printify/order-email address handling; `buildLimitOffset` in `base.repo` behind 4 hand-rolled paginations.
  - **Styling (agent):** S3 `#fff` → `--admin-panel-bg`/`--admin-input-bg` (per-line panel-vs-input). S6 inline-editor greys → tokens (+ new `$border-color-strong`/`$bg-muted`; 4 near-threshold greys kept raw to avoid a visible shift). S7 `$stat-pills` Sass map + `@each`. S8 `@mixin admin-card` behind `.settings-card`/`.stat-card`/`.connection-card` (now theme-reachable, unthemed look identical).
  - **Deferred within Phase B (documented, not applied — safe follow-ups):** U7 `window.confirm()`→`ConfirmModal` (26 sites), U8 tabs unify, badges map + remaining datetime `formatDate` copies, U10-U14 (`BulkActionBar`/`AdminFilterBar`/`AddressForm`/`OrderSummary`), the remaining ~34 EmptyState adoption sites.
- **Phase C — planned (too large / behavioral for a safe single-pass landing):**
  - **U5 `<DataTable>` / `<AdminListPage>`** — a presentational table driven by the existing `usePaginatedList`/`useBulkActions` hooks (columns config + row slots), absorbing the ~14 copy-pasted list scaffolds + bulk-bar + filter-bar. Highest single ROI; do as its own plan (build component → migrate 1 page → verify → sweep).
  - **U4 UI-kit unification** — merge `components/ui/FormField`/`FormSection` (has `error`/`required`/`for=`) with `components/admin/forms` (has `tooltip`/`hint`/`inline`) into one; migrate the 8 `pages/setup/*` consumers; retire the duplicate.
  - **U1/U4 Button adoption** — `components/ui/Button` is unused across 316 raw `.btn` sites; decide one button style, then adopt (note: `ui-button` ≠ `.btn` → visual change, needs a design call). Rebuild `ConfirmModal` actions on it once chosen.
  - **A7 registries** — `search.ts` 8 copy-pasted FTS blocks → a `SEARCHABLE_ENTITIES` registry + one generic `searchEntity`; `social.ts` inline Twitter special-casing → widen `SocialProvider` (`readCursor`/`writeCursor`/`isSyncEnabled`); `oauth/index.ts` throwing switch → an `OAUTH_PROVIDERS` map. All behavioral (public search / social sync) → need their own verification.
  - Each Phase C item is a good `superpowers:writing-plans` / `/implement` candidate.

*(This document is updated in place as Phase A lands.)*
