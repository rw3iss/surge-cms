# Improvement Audit — 2026-08-21

Scope: the **events module** (12 commits, 23 files, ~4,400 lines) built earlier
today. Reviewed with fresh eyes against the codebase's existing conventions.

## 1. Summary

- **Project:** SiteSurge CMS (`surge-cms`) — pnpm monorepo, Express + PostgreSQL,
  SolidJS + Vite, SCSS with design tokens.
- **Working directory:** `/home/rw3iss/Sites/rw/rw-cms`
- **Total findings: 9** (UI: 3, styling: 2, architecture: 4) — one uncovered *during* the pass.

Headline: the module works and is well tested, but it **reinvented three things
the codebase already had** — currency formatting, the modal shell, and the
month-grid window. Two of those reinventions carry real bugs.

---

## 2. UI & UX improvements

### A1 — Currency formatting is wrong for non-USD currencies ⚠️ BUG
**Location:** `packages/cms/src/pages/EventDetail.tsx:18-21`
**Problem:** I hand-rolled `money()` as `symbol + (cents/100).toFixed(2)`, while
`@sitesurge/types` already exports `formatCurrency()` (an `Intl.NumberFormat`
wrapper) and `pages/shop/shopFormat.ts` already wraps it. Mine produces:

| Input | Correct | Mine |
|---|---|---|
| 2500 JPY | `¥25` | `¥25.00` ❌ zero-decimal currency |
| 123456 USD | `$1,234.56` | `$1234.56` ❌ no thousands separator |

Since the module ships a **Default Currency** picker including JPY, this is
reachable, not theoretical.
**Fix:** delegate to the shared `formatCurrency`, keeping only the `Free` case.
**Risk:** low. **Phase A.** ✅ **Applied.** Verified: `2500 JPY → ¥25`,
`123456 USD → $1,234.56`.

### A2 — Ticket-tier hint hardcodes currency symbols
**Location:** `packages/cms/src/pages/admin/events/EventModal.tsx:412`
**Problem:** copy reads "A £0/$0 tier with a quantity…" — wrong for a site
configured in EUR or JPY, and mixes two symbols for no reason.
**Fix:** currency-neutral wording ("a zero-priced tier").
**Risk:** low. **Phase A.** ✅ **Applied.**

### B1 — Event modal ignores the shared `ModalShell`
**Location:** `packages/cms/src/pages/admin/events/EventModal.tsx:283-300`
**Problem:** I hand-rolled the overlay, panel and ✕ button.
`components/admin/common/ModalShell.tsx` already provides all of it **plus
Escape-to-close and a Portal**, which mine lacks — so the event modal is the only
admin modal you cannot dismiss with Escape, and it renders inside the page tree
rather than a portal.
**Fix:** wrap the modal body in `ModalShell` (`size="lg"`, `showClose`).
**Risk:** medium — changes DOM structure and the SCSS that targets it.
**Phase B.** ✅ **Applied + approved.** Verified live: modal renders via
`.modal-shell.event-modal`, uses the shared ✕, and **Escape now closes it** and
returns to `/admin/events`.

---

## 3. Styling & design system

### A3 — Hardcoded hex instead of tokens
**Locations:**
- `components/common/calendar/Calendar.scss:54` — `color: #fff`
- `components/common/calendar/EventList.scss:80` — `color: #fff`
- `pages/EventDetail.scss:77` — `color: #dc2626`
- `pages/EventDetail.scss:98` — `background: #f3f4f6`

**Problem:** `CLAUDE.md` states plainly: *"Don't add new literal hex values —
extend `variables.scss` instead."* The error red and the code-chip grey both have
existing tokens (`$error-color`, `$background`), and the two `#fff` should be
`--site-button-text` so an operator's palette carries through.
**Fix:** swap for the existing tokens.
**Risk:** low. **Phase A.** ✅ **Applied** — no bare hex remains in the events
styles (hex now appears only as a `var()` fallback).

### A4 — Month-grid window logic exists in three places
**Locations:**
- `packages/api/src/services/events/occurrences.ts:118` (`monthGridWindow`)
- `packages/cms/src/pages/admin/Events.tsx:33` (`gridWindow`)
- `packages/cms/src/pages/Events.tsx:20` (`gridWindow`)

Plus `MONTHS` duplicated across the two page files.
**Problem:** three implementations of "six weeks from the Sunday on or before the
1st". This is precisely the drift risk I flagged (and fixed) for the feature
catalog and the migration registry earlier today — I then introduced a fresh
instance of it. If one copy changes, the calendar and its data silently disagree
about which window to fetch.
**Fix:** export `monthGridDays()` + `MONTHS` from the shared calendar module and
have all three consume it.
**Risk:** low (pure extraction, no behaviour change). **Phase A.** ✅ **Applied,
and taken further than proposed:** the geometry was hoisted into
`@sitesurge/types` (`utils/calendarGrid.ts`) — the one package BOTH workspaces
already depend on — so the server's expander and the SPA share a single
definition rather than two that merely look alike. `gridWindow`/`gridDays` now
have 0 duplicate definitions; `MONTHS`/`yearOptions` have 1 each.

---

## 4. Architecture & code quality

### B2 — Admin and public calendar pages are near-duplicates
**Locations:** `pages/Events.tsx` and `pages/admin/Events.tsx`
**Problem:** 153 differing lines across two ~130-line files that share month
state, the fetch resource, prev/next stepping and the two-column layout. The
*components* were correctly shared; the *page shell* was not.
**Fix:** extract `components/common/calendar/CalendarPage.tsx` taking
`mode`, `onSelectOccurrence` and an optional toolbar slot — which is what the
module plan specified and I skipped.
**Risk:** medium — touches both routed pages. **Phase B.** ✅ **Applied +
approved.** `CalendarPage.tsx` owns month state, fetching, navigation and
layout, with a `toolbar` render-prop so the admin injects its month/year
dropdowns without the shell knowing about them. Public page 95 → **38 lines**;
admin 157 → **112**. Verified live: both render 42 cells; only the admin has the
dropdowns and Add button.

### C1 — `services/events.ts` is a 783-line module with nine responsibilities
**Location:** `packages/api/src/services/events.ts`
**Problem:** 22 exported functions spanning settings, CRUD, subscriptions,
notification dispatch, calendar reads, tiers, registration and ticket purchase.
**My own plan** (`docs/superpowers/plans/2026-08-21-events-module.md` §3)
specified splitting this into `services/events/{index,registration,tickets,
cart}.ts`; I extracted only `occurrences.ts` and `tickets.ts` and let the rest
accrete. The file also imports `./events/tickets.js` dynamically *from inside
itself*, which is a symptom of the missing split.
**Fix:** complete the planned split; keep `services/events.ts` as a thin barrel
so no import site changes.
**Risk:** high — every import site plus the route module. **Phase C.** ✅
**Applied.** 783 lines → a 68-line barrel over ten focused modules:

| Module | Lines | Owns |
|---|---|---|
| `settings.ts` | 86 | Site-level settings + calendar-URL validation |
| `crud.ts` | 207 | Event records + the registration-fields invariant |
| `calendar.ts` | 64 | Occurrence-expanded reads + per-date overrides |
| `occurrences.ts` | 128 | DB seam onto the pure recurrence engine |
| `subscriptions.ts` | 72 | Who signs up to hear about events |
| `notifications.ts` | 168 | Sending those + the reminder sweep |
| `registration.ts` | 101 | Attendees |
| `tiers.ts` | 63 | Tier definitions + live availability |
| `tickets.ts` | 166 | DB pricing + code issuance |
| `purchase.ts` | 121 | Checkout: free → issue, paid → Stripe |
| `format.ts` | 29 | Shared date/URL/escape helpers |

Two notes on the shape:
1. The plan's single `notifications` unit was split into **`subscriptions`**
   (sign-up) and **`notifications`** (send-out). Sign-up must look an event up,
   and event CRUD must send a notification — in one module those two facts are
   an import CYCLE. Apart, dependencies run one way:
   `crud → notifications → settings`, `subscriptions → crud`.
2. The `await import('./events/tickets.js')` *inside* the old file — the symptom
   the finding called out — is now an ordinary static import, because the split
   removed the cycle that forced it.

`import * as events from '../services/events'` in `routes/events.ts` (the only
import site) is untouched.

### C2 — `registrationFields` UI contract isn't enforced server-side
**Location:** `EventModal.tsx` disables the `email` checkbox; the API accepts any
array.
**Problem:** a direct `PUT` can omit `email`, and the public form would then not
collect it — while `register()` still requires an email, so the form becomes
unsubmittable. Not a security hole (email is validated regardless), but the UI's
invariant should live on the server.
**Fix:** normalise `registrationFields` to always include `email` in the service.
**Risk:** medium-low, but it changes stored data shape. **Phase C** (bundle with
C1's service work). ✅ **Applied.** `normalizeRegistrationFields()` in `crud.ts`,
applied on both create and update. It also drops duplicates and blanks (a
repeated key rendered the same input twice) while PRESERVING the admin's chosen
field order — `email` is appended only when genuinely absent. Verified against
the live server:

| `PUT` sent | Stored |
|---|---|
| `["name","phone"]` | `["name","phone","email"]` |
| `["name","name","  ","email"]` | `["name","email"]` |

### D1 — Create-event modal never opened ⚠️ BUG (pre-existing, found during this pass)
**Location:** `pages/admin/Events.tsx` (modal effect) + `App.tsx:152`
**Problem:** `/admin/events/new` is its OWN route with no `:id` segment, so
`params.id` was `undefined` there and the effect returned early — the create
modal **never opened from the URL**. My earlier verification only checked that
the route returned HTTP 200, which it did; nothing rendered inside it. This
predates the refactor (confirmed against commit `bcad5d6`); the improvement pass
surfaced it because B1 forced a real look at the modal's DOM.
**Fix:** detect the `/events/new` pathname explicitly rather than inferring it
from a param that route doesn't carry.
**Risk:** low. ✅ **Applied.** Verified live: the modal opens with 13 fields.

### C3 — No integration test covers the recurrence→registration seam
**Problem:** recurrence (20 tests), occurrences (11) and ticket pricing (10) are
each well covered in isolation. Nothing tests that registering for occurrence
*N* of a series lands on the right `occurrence_date` — which is exactly where the
`startsAt.slice` bug hid until live testing caught it.
**Fix:** add a service-level test with a stubbed repo.
**Risk:** low, but it is new test infrastructure. **Phase C.** ✅ **Applied.**
`services/events/registration.test.ts` (10 tests) drives the REAL expander
rather than a hardcoded date list, so a change in recurrence maths shows up as a
change in what gets registered. Covers: the series expands to the five September
Tuesdays; registering for occurrence *N* stores occurrence *N*'s date; five
occurrences register independently without collapsing onto one date; an omitted
date defaults to the series start; **`startsAt` arriving as a `Date` still
works** (the exact shape of the shipped bug); counts are per-occurrence; closed
registration and bad emails are refused before any DB write; a failed
confirmation email does not lose the registration.

Plus `crud.test.ts` (6 tests) pinning the C2 invariant. API suite: **230 → 246**.

Writing it found two fixture bugs of mine that a weaker test would have hidden:
the rule format is `weekly`, not `FREQ=WEEKLY` (an unparseable rule silently
yields ONE occurrence, so the test passed a single date), and `getByIdOrSlug`
routes a non-UUID to `findBySlug` — stubbing only `findById` exercised the other
path. Both are now guarded by an explicit fixture-integrity assertion.

---

## 5. Recommended execution plan

**Phase A — applied automatically (low risk)** — all ✅
- A1 currency formatting bug → shared `formatCurrency`
- A2 currency-neutral tier hint copy
- A3 hardcoded hex → existing tokens
- A4 de-duplicate `monthGridDays` + `MONTHS` into the shared calendar module

**Phase B — approved and applied**
- ✅ B1 adopt `ModalShell` in the event modal (gains Escape + shared ✕)
- ✅ B2 extract a shared `CalendarPage` shell for both calendar pages

**Found during the pass**
- ✅ D1 create-event modal never opened (pre-existing routing bug)

**Phase C — applied on request (originally plan-only)**
- ✅ C1 split `services/events.ts` per the module plan (783 → barrel + 10 modules)
- ✅ C2 enforce the `registrationFields` invariant server-side
- ✅ C3 add a recurrence→registration integration test (+16 tests)

---

## 6. Documentation sync

> **Superseded by the Phase C pass** — see the note at the end of this section.

**For Phases A and B, no documentation was updated, and none was required.** The events module has
no user-facing docs surface yet — there is no `docs/EVENTS.md`, and `CLAUDE.md`
has not yet gained an events section (the module postdates the last CLAUDE.md
pass). Checked against the step-9 trigger list:

| Trigger | Affected? |
|---|---|
| Public API / exported signatures | No — `services/events.ts` exports unchanged |
| CLI, env vars, config keys | No |
| Default values | No |
| Install / build / deploy | No |
| Visible labels & copy | A2 only (a hint string); not quoted in any doc |

Everything applied was an internal refactor or a bug fix that restores the
*intended* behaviour, so no doc says anything now untrue.

**Noted absence → now closed.** Phase C changed a server-side behaviour (C2) and
the module layout (C1), and the events module had no `CLAUDE.md` entry at all
while every other feature module did. `CLAUDE.md` now carries an **Events &
calendar** entry documenting the recurrence rule format (`weekly`, NOT iCal —
the trap that bit the C3 fixture), overrides, the registration-vs-subscription
distinction, the server-enforced `email` invariant, DB re-pricing at checkout,
the optional `web-push` dependency, the barrel/module layout with its one-way
dependency rule, routes, and the known paid-ticket gap.

**Docs updated: `CLAUDE.md` §Core Capabilities.**

## 7. Verification

Final state after Phase C: `npm run build` **exit 0**, **246 API tests pass**
(47 files) + 46 MCP tests, deployed to
surgecms.ryanweiss.net and verified against the LIVE server, not just by
type-check:

- calendar / list / public settings endpoints return the expected data
- registering for 09-15 and 09-22 stores those exact dates; an omitted date
  defaults to the series start 09-01; registrant lists stay per-occurrence
  (`09-01: 3, 09-15: 1, 09-22: 1, 09-29: 0`) rather than merging
- a free ticket confirms immediately with a code; a paid line claiming **1c**
  for 2 × $25 is priced at **$50** and returns `payment_required`
- the admin calendar renders 42 cells with the recurring event; the edit modal
  loads with `email` checked and disabled

(Verifying in a browser rather than by HTTP status is what surfaced D1.)

Each Phase A batch is followed by `npm run build` (checked by **exit code**, not
by grepping output — an indented pnpm failure line was missed that way earlier
today) plus the API and client test suites.
