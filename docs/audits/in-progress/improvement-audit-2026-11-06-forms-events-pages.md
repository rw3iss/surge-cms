# Improvement audit 2026-11-06 — forms / events / pages

Area: forms (sections, contact field, clone, renderer, submissions), branded email layout, events location map + label, system pages + page/post editors, gallery item page collection column, Social block YouTube facade. Changes since f28ea8ae plus the surrounding code. Done as four sub-audits with non-overlapping files; each section below keeps its own numbering (F#, E#, P#, G#).

| Sub-area | Findings | Applied | Planned | Skipped / blocked | Highest impact |
|---|---|---|---|---|---|
| F — Forms + branded email | 28 | 25 | 2 | 1 | Editors could not open draft forms; one-submission check trusted `X-Forwarded-For`; CSV formula injection; blank/null passed `required`; clone not transactional; preheader unescaped; question cards remounted on each keystroke; drafts never restored |
| E — Events location map | 15 | 13 | 1 | 1 (no guide → written: `docs/how-it-works/EVENTS.md`) | Cached reverse lookup moved the pin; lng outside ±180 blocked saves; stale lookups; save stored old point with new address; API location change kept old point |
| P — System pages + editors | 14 | 10 | 1 (revisions ENTITY_SKIP, lead) | 2 skipped (+1 checked, no change) | Claim/release now one locked transaction; unsaved-changes leave guard showed no modal; double Ctrl+S created duplicates; post drafts never restored |
| G — Gallery item page + Social | 15 | 9 | 1 | 2 (+3 no change) | Known `SocialBlock.tsx` tsc error fixed; YouTube facade a11y + thumbnail fallback; collection strip kept focus; ←/→ item navigation |

Migrations: 214 (`214_form_contact_field_text_only.sql`, clears contact_field on non-text questions; idempotent). 215 unused.

Docs updated: `docs/how-it-works/FORM_ACTIONS.md`, `docs/how-it-works/GALLERY.md`, `docs/how-it-works/SOCIAL.md` (YouTube facade), new `docs/how-it-works/EVENTS.md` (location, map, geo lookups).


---

# F — Forms + branded email


Scope: form sections, contact field, clone, collapsible sections, join prefill, form answers email, branded layout, form editor / submissions / preview / view modal, forms API (commits 25347c5f … 021bc7df since f28ea8ae, plus surrounding code).

| # | Title | Risk | Status |
|---|-------|------|--------|
| 1 | Editors could not open draft forms / saw only published forms | A | applied |
| 2 | One-submission-per-IP check read the client-controlled `X-Forwarded-For` | A | applied |
| 3 | CSV export open to formula injection | A | applied |
| 4 | Required check passed blank text / `null` | A | applied |
| 5 | Answers to unknown question ids stored; answer size unbounded | A | applied |
| 6 | Clone not atomic (published duplicate on failure) | B | applied |
| 7 | Contact-field guess: false positives on choice questions / "Email preferences" | B | applied (+ migration 214) |
| 8 | Contact field on choice questions from the 198 backfill — invisible, uneditable, wins | B | applied |
| 9 | Non-address "email" accepted as the submitter's email | A | applied |
| 10 | Branded email: AI/data preheader inserted as raw HTML | A | applied |
| 11 | Branded email: empty site name → empty header link / footer | A | applied |
| 12 | Plain-text answers: a root question after a section read as part of it | A | applied |
| 13 | FormRenderer: labels not tied to inputs, no error wiring, no group semantics | B | applied |
| 14 | Collapsible section: no `aria-controls`, heading semantics lost | A | applied |
| 15 | FormRenderer: cleared number field = 0 (passes "required") | A | applied |
| 16 | FormRenderer: errors in a collapsed section opened it but focus stayed on Submit | A | applied |
| 17 | Form editor: card remounted on every edit → focus lost (Tab) | B | applied |
| 18 | Form editor: drafts written but never restored | B | applied |
| 19 | Form editor: Clone → same route kept old form's draft key / state | B | applied |
| 20 | Form editor: native `confirm()` for delete form / remove question | A | applied |
| 21 | FormSubmissions: pre-existing tsc errors; native checkboxes | A | applied |
| 22 | FormSubmissions: no CSV export button; >500 submissions silently cut | A | applied |
| 23 | SubmissionViewModal: no sections, no submitter, values not reactive | A | applied |
| 24 | joinPrefill: non-string values passed through; empty hand-off kept the old one | A | applied |
| 25 | dropFormRow: target in a missing section → index −1 | A | applied |
| 26 | Form editor metadata inputs are raw `<input onInput>` (not CommitInput/FormField everywhere) | C | planned |
| 27 | Form update + question sync not one transaction | B | planned |
| 28 | Forms cache keys outside `CACHE_KEYS` | A | lead follow-up |

### Findings

1. **Editors could not open draft forms / saw only published forms** — `packages/api/src/routes/forms.ts` GET `/` and GET `/:id`. Used `isAdminRole`; forms are staff content (editors). An editor's admin Forms list was the public published list and opening a draft 404'd. Fix: `isStaffRole` (from `@sitesurge/types`). Risk A. applied.
2. **IP from X-Forwarded-For** — `routes/forms.ts` submit. The FIRST XFF entry is client-supplied (nginx appends), so anyone could bypass "one submission per visitor". Fix: `req.ip` (trust proxy 1). Risk A. applied. (Same bug in `routes/messages.ts` — lead follow-up.)
3. **CSV formula injection** — `services/forms.ts` `escapeCSV`. Visitor answers like `=HYPERLINK(…)` ran in Excel. Fix: leading `'` for `= + - @ \t \r`, quote on `" , \r \n`, UTF-8 BOM, CRLF. Exported + tested. Risk A. applied.
4. **Required check** — `services/forms.ts` submit. `'   '`, `null`, `['']` passed. Fix: `missingRequiredQuestion` / `isBlankAnswer`. Tests. Risk A. applied.
5. **Unknown answers stored / unbounded** — `services/forms.ts` + route schema. Fix: `cleanSubmittedAnswers` (form's questions only, one per question, last wins); zod: text ≤ 20 000, ≤ 200 choices × 1 000, ≤ 500 answers. Client also sends only known ids. Risk A. applied.
6. **Clone not atomic** — `services/forms.ts` `clone`. `entities.copy` committed, THEN the reset to draft ran; a failure left a published duplicate with the source's `submission_count`. Fix: `copyRecord` + the reset in ONE `transaction`; entity + form caches invalidated. Questions/sections/settings copied by the generic deep copy (section ids are per-form strings, so `section_id` needs no remap); slug suffixed by `uniqueSuffixed`; submissions not copied. Risk B. applied.
7. **Contact-field guess false positives** — `packages/shared/src/utils/formContact.ts` `guessContactField`. "Email preferences" (radio) → email; it could also SHADOW the real email question (first guess wins). Fix: label guesses only on typed-in types (text/textarea/email/number; number only → phone); labels ABOUT email/phone (preferences, updates, opt-in, type, method…) not guessed. Tests. Risk B. applied.
8. **Contact field on choice questions** — migration 198 backfill set `contact_field` on radio/select questions; the editor hides the select there, and an explicit field wins. Fix: `contactFieldAllowed(type)` (shared) — ignored by `contactQuestions`, refused by the repo on create/sync/update; migration `214_form_contact_field_text_only.sql` clears them (idempotent). Risk B. applied.
9. **Non-address email** — `formContactValues`: any text answer to the email question was "the email" (subscribe/invite of garbage). Fix: must match a basic address pattern, else `null`. Test. Risk A. applied.
10. **Branded preheader raw HTML** — `services/mail/branded.ts` `brandedEmail`. `wrapEmailShell` inserts the preheader unescaped; the social digest passes the AI headline. Fix: escaped in `brandedEmail` (documented as plain text). Test. Risk A. applied.
11. **Unnamed site** — `branded.ts`. Empty `siteName` → empty link/alt/footer. Fix: `nameOf` falls back to the host; footer host has no trailing slash and is not repeated when it is the name. Test. Risk A. applied.
12. **Plain-text sections** — `services/formAnswersEmail.ts` `formAnswersText`. Blank line after a section block. Test. Risk A. applied. (HTML escaping verified: titles, descriptions, labels, answers all `escapeHtml`.)
13. **FormRenderer accessibility** — `packages/cms/src/components/forms/FormRenderer.tsx`. `<label>` had no `for`; inputs no id; errors not tied; radio/checkbox had no group; "question as placeholder" had no accessible name. Fix: per-render ids (`createUniqueId`), `for`/`id`, `aria-describedby` (help + error), `aria-invalid`, `aria-required`, `role="group"` + `aria-labelledby` for choices, `sr-only` label when the question is the placeholder; required `*` `aria-hidden`. Risk B. applied.
14. **Collapsible section a11y** — toggle now inside an `<h3 class="form-renderer__section-heading">` (disclosure pattern) with `aria-expanded` + `aria-controls` (its fields' ids). Native `<button>` keeps keyboard. SCSS reset for the heading. Risk A. applied.
15. **Cleared number = 0** — `Number('')` stored 0. Fix: cleared → answer removed. Risk A. applied.
16. **Error in collapsed section** — opened the section but left focus on Submit. Fix: scroll to + focus the first invalid control after opening. Risk A. applied.
17. **Editor focus loss** — `packages/cms/src/pages/admin/FormEditor.tsx`. `rows` was a signal of new objects; `updateQuestion` rebuilt the row → `<For>` remounted the card on each commit (Tab from Question Text to Type lost focus). Fix: rows in `createStore`, `reconcile(…, { key: 'rowKey' })` (`withRowKey`: saved id / uiKey / section id). Verified identity with a probe test. Risk B. applied.
18. **Drafts never restored** — `useAutoSave` wrote `form-draft-*` but nothing read it. Fix: `restoreDraft` — after load (or on mount for a new form) a draft newer than `updatedAt` that really differs (`stableJson`) is applied + marked dirty + toast; header **Revert** (ConfirmModal) clears it and re-creates the editor. Risk B. applied.
19. **Clone kept stale state** — Clone navigates `/admin/forms/A` → `/admin/forms/B` on the SAME route: draft key, collapsed set, fields stayed A's. Fix: `FormEditorRoute` re-creates the editor per id (`<Show keyed>`), also used by Revert. Risk B. applied.
20. **Native confirm()** — delete form + remove question now `ConfirmModal` (delete shows the submission count, busy state). Risk A. applied.
21. **FormSubmissions tsc + checkboxes** — `useParams<{ id: string }>()`, typed `Set<string>`; row/select-all selection uses `components/ui/Checkbox`; delete modal uses `loading`/`busyLabel`. Risk A. applied.
22. **Export / truncation** — header **Export CSV** (`cms.forms.exportSubmissions` → Blob download, every submission); a note when the server total exceeds the 500 loaded. Risk A. applied.
23. **SubmissionViewModal** — answers laid out with section headings (`formLayoutItems`), "Signed in as …" line (repo already joins `user_name`/`user_email`), answer values reactive. Risk A. applied.
24. **joinPrefill** — strings only (trimmed, ≤ 300), all-empty → null; saving an empty hand-off removes an older one. Once + 30-minute expiry verified. Tests. Risk A. applied.
25. **dropFormRow guard** — `formSections.ts`: section dragged next to a question whose section row is missing used index −1. Fix: treat as root question. Edge tests added (empty sections at end round-trip, positions after delete, position past the end, no-op moves). Risk A. applied.
26. **Editor metadata inputs** — title/slug/description/etc. are raw `onInput` inputs (signals, so no remount bug) and question fields are raw `<label>`+`<input onChange>` inside `.form-group`. Convention says `FormField` + `CommitInput`. Plan: replace the question card fields with `FormField` + `CommitInput` (`onCommit` → `updateQuestion`), keep the title→slug live typing for new forms. Risk C (large markup churn, no bug left). planned.
27. **Update not one transaction** — `services/forms.ts` `update`: `updateForm` (incl. sections) then `syncQuestions` in a separate transaction; a failed question sync leaves new sections with old questions (renders fine — orphans go to root). Plan: pass a client through `updateForm` and run both in one `transaction`. Risk B. planned.
28. **Cache keys** — `services/forms.ts` uses raw `'forms:public'` / `` `form:slug:${slug}` `` (not in `CACHE_KEYS`). Out of scope (`cache.ts`). lead follow-up.

Verified, no change: `moveFormRow` / `dropFormRowAtEnd` / `removeFormSection` (keep = in place) / `cleanFormSections` (bounded, unique ids, collapsed requires collapsible); clone copies questions + sections + action config; `formAnswersEmailHtml` escapes everything; join prefill is once + 30 min.

### Lead follow-up

- `packages/api/src/routes/messages.ts:55` — same spoofable IP: replace `(req.headers['x-forwarded-for'] as string)?.split(',')[0] || req.ip!` with `req.ip || req.socket.remoteAddress || ''`. Also `services/auth.ts` `clientIp()` reads the first XFF entry (used by login/ban checks) — consider `req.ip` there too.
- `packages/api/src/services/cache.ts` — add `CACHE_KEYS.formsPublic = 'forms:public'` and `CACHE_KEYS.formSlug = (slug) => \`form:slug:${slug}\``; then `services/forms.ts` uses them (string values unchanged, so no key change).
- `packages/api/src/services/formActions.ts` — the `email` action renders `emailTo` with visitor answers (`{{email}}`), so a visitor can make the site mail the submission to any address (open relay of the form text). Suggest: when `emailTo` contains `{{`, rate-limit per IP and/or require a validated `email`-type answer.
- CLAUDE.md, Forms bullet, "Contact field" sentence — replace "(`@sitesurge/types` `utils/formContact.ts`: explicit field → type `email` → loose label match; name falls back to first + last)" with: "(`@sitesurge/types` `utils/formContact.ts`: explicit field → type `email` → loose label match — typed-in questions only (`contactFieldAllowed`: text/textarea/email/number; migration 214 cleared choice-question values), labels ABOUT email/phone ('Email preferences') not guessed, an email value must be an address; name falls back to first + last)".
- CLAUDE.md, Forms bullet — add: "Submissions keep only answers to the form's questions (one each); blank text / null = unanswered; CSV export (admin **Export CSV**) neutralises formulas. Forms GET `/` (all=true) and `/:id` drafts are STAFF (editors), not admin. Form editor: rows in a keyed store (`rowKey`), drafts restored when newer + different (Revert), editor re-created per form id."
- `docs/API.md` / manifest — route summaries for GET `/forms` and `/forms/:id` changed ("staff"); regenerate with `npm run docs:api`.

### Verification

- `cd packages/shared && npm run build` — ok; `npx vitest run` — 330 passed (incl. formContact 32, formSections 19).
- `cd packages/api && npx tsc --noEmit -p .` — clean.
- `cd packages/api && npx vitest run src/services/formActions src/services/formAnswersEmail.test.ts src/services/forms.submit.test.ts src/services/membership` — 8 files, 70 passed; `src/services/social/analytics src/services/notifications src/services/reply src/services/mail/purposeDefaults` — 20 files, 176 passed.
- `cd packages/cms && npx tsc --noEmit -p .` — only the known CampaignDonations errors remain (FormSubmissions errors fixed).
- `cd packages/cms && npx vitest run --config ../../config/cms/vitest.config.ts src/utils/joinPrefill.test.ts` — 4 passed. Keyed `reconcile` identity verified with a throw-away probe test (removed).
- Not verified in a browser: FormRenderer a11y wiring, editor draft restore / Revert, focus retention, Export CSV download. Migration 214 not run against a DB.

### Files touched

- packages/shared/src/utils/formContact.ts, formContact.test.ts, formSections.ts, formSections.test.ts
- packages/api/src/services/forms.ts, services/forms.submit.test.ts (new), services/formAnswersEmail.ts, services/formAnswersEmail.test.ts, services/mail/branded.ts, routes/forms.ts, repositories/forms.repo.ts, db/migrations/214_form_contact_field_text_only.sql (new)
- packages/cms/src/components/forms/FormRenderer.tsx, FormRenderer.scss
- packages/cms/src/pages/admin/FormEditor.tsx, FormSubmissions.tsx
- packages/cms/src/components/admin/forms/SubmissionViewModal.tsx, SubmissionViewModal.scss
- packages/cms/src/utils/joinPrefill.ts, joinPrefill.test.ts (new)
- docs/how-it-works/FORM_ACTIONS.md (Contact field + Submission rules sections)

---

# E — Events location map


Scope: commits 9de86294, 0b153930, 1b2f33a8 (+ surrounding code) — `services/geo.ts`, `routes/geo.ts`, `events/crud.ts` (map parts), `components/map/LocationMap`, `components/admin/events/LocationField`, `pages/EventDetail.tsx` (map parts), `pages/admin/events/EventModal.tsx`, `shared/utils/mapLink.ts`.

| # | Title | Risk | Status |
|---|-------|------|--------|
| 1 | Cached reverse lookup returned another caller's point | A | applied |
| 2 | Picked longitude can be outside -180…180 → save refused | A | applied |
| 3 | Stale lookup results moved the pin back | B | applied |
| 4 | Geo queue unbounded; identical lookups not shared; bad JSON = 500 | B | applied |
| 5 | Save could stall on the geo queue (mapPointFor no own timeout) | B | applied |
| 6 | API location change kept the old address's point | B | applied |
| 7 | Lazy map had no local Suspense boundary | A | applied |
| 8 | Event-page map not keyboard reachable; picker had no keyboard drop | A | applied |
| 9 | Map built after unmount (leak) | A | applied |
| 10 | Background lookup errors invisible while the map panel is closed | A | applied |
| 11 | Wrong ARIA role on "Other matches"; OSM tile subdomains | A | applied |
| 12 | "Nothing found" cached 7 days | A | applied |
| 13 | Nominatim 1 req/s is per PROCESS, not per site | B | planned (needs cache.ts) |
| 14 | Save during an in-flight editor search stores the old point | B | applied |
| 15 | No events how-it-works guide exists | — | blocked (lead) |

### Findings

1. **Cached reverse lookup returned another caller's point** — `packages/api/src/services/geo.ts` `reverse()`. The cache key rounds to 5 decimals but the stored value held the FIRST caller's exact lat/lng (`{ ...found, lat, lng }`), so a later caller's pin silently snapped to the earlier caller's point (contradicting the "the point the user chose stays the point" comment). Fix: store the place as found; apply the caller's point on every return (`atPoint`). Test `geo.reverse.test.ts`. Risk A. **applied**.

2. **Longitude outside -180…180** — `components/map/LocationMap.tsx` click + dragend. Leaflet repeats the world when zoomed out (the picker opens at zoom 3); a click on a repeated copy gives e.g. lng 200. `/geo/reverse` then 400s (the field falls back to coordinates text) and the event save is refused by zod (`locationLng.max(180)`) with a confusing validation error. Fix: `latlng.wrap()` on click, drag and keyboard drop. Risk A. **applied**.

3. **Stale lookups moved the pin back** — `LocationField.tsx` `searchText` / `picked`. A slow search (8 s timeout, queued 1.1 s apart) that answered after the user dragged the pin, chose a match or cleared the pin re-set the point and text. Fix: a sequence counter — only the latest lookup applies its result / clears busy; choose / clear pin / a too-short text cancel running lookups. Risk B. **applied**.

4. **Geo queue robustness** — `geo.ts` `throttled` / `call`. The per-process queue had no bound (a burst or a slow upstream piles up requests, each waiting ≥1.1 s); two editors / a double commit of the same text made two upstream calls; a non-JSON upstream answer (Nominatim error page) threw a raw error → 500. Fix: `MAX_QUEUED` = 20 → 503 `GEO_BUSY`; `shared()` in-flight dedupe per cache key; JSON parse failure → 502 `GEO_UNAVAILABLE`. Tests in `geo.test.ts` (fake timers) + `geo.reverse.test.ts`. Risk B. **applied**.

5. **Save could stall on the geo queue** — `events/crud.ts` `mapPointFor`. Best-effort, but it awaited the full queue + 8 s fetch timeout, so a save could wait many seconds. Fix: `Promise.race` with `MAP_POINT_WAIT_MS` (5 s; the late lookup still fills the cache); late rejection handled. Tests in `mapPoint.test.ts`. Risk B. **applied**.

6. **API location change kept the old point** — `events/crud.ts` `update`. A `PUT` that changed `location` without sending `locationLat/Lng` (API, MCP, imports) kept the old point, so the map and "View map" (point wins in `mapLinkFor`) showed the OLD place. Fix: `pointAfterLocationChange()` drops the stored point when the text really changes and no point is sent; `mapPointFor` then re-places it when the map is on. The editor always sends the point, so it is unaffected. Tests added. Risk B. **applied**.

7. **No local Suspense for the lazy map** — `LocationField.tsx`, `EventDetail.tsx`. Loading the Leaflet chunk suspended the nearest boundary (the admin page outlet / the public app boundary) → a whole-region flash. Fix: local `<Suspense>` with a same-height placeholder ("Loading map…" in the admin). Risk A. **applied**.

8. **Keyboard access** — `LocationMap.tsx`. The display map (event page) is a click target with no tab stop. Fix: `role="link"`, `tabIndex=0`, Enter/Space opens it, `:focus-visible` outline, label "Open map: …". Picker: Enter on the focused map drops the pin at its center (arrows already pan); hint text says so. Risk A. **applied**.

9. **Map built after unmount** — `LocationMap.tsx` `onMount`. `await import('leaflet')` then `L.map(el)` ran even if the component was already disposed (open → close fast), leaking a map. Fix: `disposed` flag; cleanup resets refs. Risk A. **applied**.

10. **Invisible background errors** — `LocationField.tsx`. "Show a map" / a changed address search with the panel closed; the error and "Looking up…" only rendered inside the panel. Fix: error rendered outside the panel; a "Looking up the address on the map…" status while closed. Risk A. **applied**.

11. **ARIA + tiles** — `role="listbox"` on a group of buttons → `role="group"`; tile URL `{s}.tile.openstreetmap.org` → `tile.openstreetmap.org` (OSM deprecated the subdomains). CSP `img-src` already allows `https:`. Risk A. **applied**.

12. **Empty results cached 7 days** — `geo.ts`. A "not found" (search or reverse) now caches 1 day (`EMPTY_TTL_SECONDS`). Risk A. **applied**.

13. **Nominatim rate is per process** — `geo.ts`. With `CLUSTER_WORKERS > 1` each worker may call 1 req/s, exceeding Nominatim's 1 req/s per application. Volume is staff-only and small. Plan: add to `services/cache.ts` a `CACHE_KEYS.geoGate` + helper `acquireGate(key, ms)` (`SET key 1 NX PX ms`, fail open when Redis is down), and in `throttled` loop `await acquireGate(...)` before the fetch. Risk B. **planned** (cache.ts is outside scope).

14. **Save during an in-flight editor search** — `EventModal.tsx` + `LocationField.tsx`. A changed address is searched on blur, and the click on Save IS that blur, so Save sent the OLD point with the new text (the server keeps a sent point). Disabling Save would not work (the blur disables the button under the click, so the click is lost). Fix: new pure `components/admin/events/pendingLookups.ts` (`createPendingLookups(onChange)`: `track(p)`, `count()`, `settled(maxMs = 10 s)` — waits for running lookups, also ones started while waiting, never rejects, gives up after `maxMs`); LocationField tracks its search/reverse calls via a new `lookups` prop; EventModal's `save()` awaits `lookups.settled()` before it reads the location/point, and the button reads "Locating…" meanwhile. Test `pendingLookups.test.ts` (4 cases). Risk B. **applied**.

15. **No events guide** — `docs/how-it-works/` has no events guide (grep for `*EVENT*` finds nothing), so no guide update was made. **blocked** — see Lead follow-up.

Verified OK: `/geo/*` are `staff` tier + `geo:lookup` (STAFF default) permission; lat/lng/q bounds in zod (route) and on the event write (`locationLat` ±90, `locationLng` ±180, pair rule in `assertValid`); cache keys via `CACHE_KEYS.geoSearch/geoReverse`; User-Agent identifies the site; search only on commit (no autocomplete, per Nominatim policy); Leaflet CSS + JS are in the lazy chunk only; `eventLocationText` is used on the event page, cards (web/SSR/email via `locationText`), ticket page, registration/purchase/unregister mails and JSON-LD; "Set text" uses `Toggle` + `CommitInput`.

### Lead follow-up

- `packages/api/src/services/cache.ts`: finding 13 (cross-process Nominatim gate) — `CACHE_KEYS.geoGate: () => 'geo:gate'` + `acquireGate(key, ms): Promise<boolean>` (`SET NX PX`, fail open); then I (or the lead) call it in `geo.ts` `throttled`.
- `docs/how-it-works/`: no events guide exists. If one is created, document: map lookups are serialized (≤ 20 queued, else 503 `GEO_BUSY`), "not found" cached 1 day, a save waits ≤ 5 s for a background map lookup, and a `PUT` that changes `location` without a point drops the old point.
- CLAUDE.md, Events "Location + map" paragraph: append "an API update that changes the location without a point drops the old point (`pointAfterLocationChange`); `mapPointFor` waits ≤ 5 s; geo lookups: in-flight dedupe, ≤ 20 queued (503 `GEO_BUSY`), empty results cached 1 day; picked points are wrapped to ±180."
- Optional `services/ssr/staticMeta.ts:190`: add `geo: { '@type': 'GeoCoordinates', latitude, longitude }` to the event JSON-LD Place when `location_lat/lng` are set.
- No migration was needed (215 unused).

### Verification

- `cd packages/api && npx tsc --noEmit -p .` — clean for my files (0 errors at the last run).
- `cd packages/cms && npx tsc --noEmit -p .` — only the known errors in CampaignDonations.tsx / FormSubmissions.tsx; none in my files.
- `cd packages/cms && npx vitest run --config ../../config/cms/vitest.config.ts src/components/admin/events/pendingLookups.test.ts` — 4 passed. cms tsc re-run after this change: no errors in my files (others: DiscountCodeModal, CampaignDonations, FormSubmissions).
- `cd packages/api && npx vitest run src/services/geo.test.ts src/services/geo.reverse.test.ts src/services/events/mapPoint.test.ts src/services/events/crud.test.ts` — 4 files, 26 tests passed.
- Not browser-tested (Leaflet keyboard/wrap behavior verified by reading Leaflet 1.9 API: `LatLng.wrap()`, `Map.getCenter()`).

### Files touched

- packages/api/src/services/geo.ts
- packages/api/src/services/geo.test.ts
- packages/api/src/services/geo.reverse.test.ts (new)
- packages/api/src/services/events/crud.ts
- packages/api/src/services/events/mapPoint.test.ts
- packages/cms/src/components/map/LocationMap.tsx
- packages/cms/src/components/map/LocationMap.scss
- packages/cms/src/components/admin/events/LocationField.tsx
- packages/cms/src/components/admin/events/LocationField.scss
- packages/cms/src/pages/EventDetail.tsx
- packages/cms/src/pages/admin/events/EventModal.tsx
- packages/cms/src/components/admin/events/pendingLookups.ts (new)
- packages/cms/src/components/admin/events/pendingLookups.test.ts (new)

---

# P — System pages + editors


### Findings

1. **System page claim was not atomic — race gave 409, failed save unassigned the key**
   - Location: `packages/api/src/services/pages.ts` (`claimSystemPage` → now `resolveSystemPageClaim` + `writeClaiming`, ~l.190-235); `packages/api/src/repositories/pages.repo.ts:164` (`withSystemPageLock`), `:248` (`updatePage(…, run)`), `releaseSystemPage`/`createPage` take `run`.
   - Problem: the key was released from the old page and written to the new page in two separate autocommit statements. (a) Two saves claiming the same key at once both released, then the second write hit the partial-unique index `idx_pages_system_page` → 409 "A resource with this identifier already exists". (b) A write that failed AFTER the release (for example a slug unique conflict) left the key on NO page — the homepage silently went back to the built-in screen.
   - Fix: release + write run in ONE transaction holding `pg_advisory_xact_lock(hashtext('pages:system_page:<key>'))`. A second claim waits, then takes the key over cleanly (and reports the page it replaced); a failed write rolls the release back. No lock when the key does not change. Pure `resolveSystemPageClaim` exported + tested.
   - Risk: B. Status: applied. Tests: `src/services/pages.systemPage.test.ts` (7).

2. **Revision restore did not refresh public settings**
   - Location: `packages/api/src/services/pages.ts:328` (`restoreRevision`).
   - Problem: a restore can change slug / status / open access / system_page, which the public settings carry (`systemPages`, `membership.openPaths`); only the page cache was cleared.
   - Fix: also `cache.invalidateSettingsCache()`.
   - Risk: A. Status: applied.

3. **Revision restore can re-take or collide on a system page key**
   - Location: `packages/api/src/services/revisions.ts:419` `ENTITY_SKIP` (out of scope).
   - Problem: the snapshot carries `system_page` + `is_homepage`. Restoring an old version writes them back: if another page holds that key now, the whole restore fails with 23505 (409); if no page holds it, the restore silently makes this page the Homepage again.
   - Fix: see Lead follow-up (skip those columns for pages).
   - Risk: A. Status: planned (out of scope).

4. **Leaving a dirty page/post editor in-app did nothing**
   - Location: `packages/cms/src/hooks/useEntityEditor.ts` (destructured `useUnsavedChanges`), `packages/cms/src/components/admin/editors/EntityEditorShell.tsx:173`.
   - Problem: `useNavigationGuard` blocks the router navigation and sets `pending`, expecting the caller to render a confirmation. The page/post editors never rendered one, so with unsaved edits the sidebar links, the Cancel button and Back silently did nothing.
   - Fix: `useEntityEditor` exposes `leaveGuard { pending, confirmLeave, cancelLeave }`; the shell renders a `ConfirmModal` ("Unsaved changes" — Stay / Leave without saving). Leaving flushes the local draft first so the edits are kept in the browser.
   - Risk: A. Status: applied.

5. **Double save (Ctrl+S twice / click + Ctrl+S)**
   - Location: `packages/cms/src/hooks/useEntityEditor.ts:214`.
   - Problem: `handleSave` had no in-flight guard (the button disables while saving, Ctrl+S does not; the blur wait runs before `beginSave`). Two parallel saves of a NEW page/post created it twice (or failed on the slug).
   - Fix: `saveInFlight` flag held for the whole save; a second call returns.
   - Risk: A. Status: applied.

6. **Edits made while a save is in flight were marked saved**
   - Location: `packages/cms/src/hooks/useEntityEditor.ts:274`.
   - Problem: after the save, `savedBlocks`/`savedFields` were read from the CURRENT state and `markClean()` + `autoSave.clear()` ran — an edit typed during the save request lost its dirty flag and its draft, and the View link could follow an unsaved slug.
   - Fix: snapshot fields + blocks when the save starts; record THAT as saved; if the state changed meanwhile (existing entity), stay dirty and flush the draft instead of clearing it.
   - Risk: B. Status: applied.

7. **Restored draft was not marked dirty (page)**
   - Location: `packages/cms/src/pages/admin/PageEditor.tsx:317`.
   - Problem: the draft is applied over the server copy but the editor stayed "clean" — no leave warning, a tab close dropped nothing visible, Preview button logic used clean state.
   - Fix: `editor.markDirty()` after `applyDraft`.
   - Risk: A. Status: applied.

8. **Post editor never restored the draft of an existing post**
   - Location: `packages/cms/src/pages/admin/PostEditor.tsx:443`.
   - Problem: drafts of existing posts were written to localStorage but never read (only NEW posts offered a restore). Revert then showed for edits a reload had already dropped, and the stale draft lived forever. CLAUDE.md already describes restore for page AND post.
   - Fix: extracted `applyDraft`; the hydrate effect restores a draft newer than `updatedAt` (+ toast + markDirty), clears an older one. For a live show the server's `typeSettings` are kept (the server writes recordings/provider input there while the show runs).
   - Risk: B. Status: applied.

9. **Public settings reloaded only on key/status change**
   - Location: `packages/cms/src/pages/admin/PageEditor.tsx:230`, new `packages/cms/src/utils/pagePublicSettings.ts`.
   - Problem: renaming the slug of a system page (or an open-access page), or toggling open access, did not reload `siteSettings` — the "Use as page" holder note then named the page's OWN old slug as "the Homepage page now — saving replaces it", and public routes in the same tab used the old slug.
   - Fix: `publicSettingsChanged(prev, next)` — key change, open-access change, or slug/status change of a page that holds a key or is open. Tests (5).
   - Risk: A. Status: applied.

10. **Slug field accepted characters the server refuses**
    - Location: `PageEditor.tsx` / `PostEditor.tsx:557` slug inputs; `packages/cms/src/utils/autoSlug.ts` `cleanSlug`.
    - Problem: "My Page" in the slug field → save fails with a generic 400 (route regex `^[a-z0-9-]+$`).
    - Fix: on BLUR the slug is reduced with `generateSlug` (lowercase, spaces → `-`, others dropped). Not per keystroke (a trailing `-` while typing survives). Test added.
    - Risk: A. Status: applied.

11. **SystemPageRoute blank forever when the settings load failed**
    - Location: `packages/cms/src/components/common/SystemPageRoute.tsx:27`.
    - Problem: `<Show when={siteSettings()}>` — if `cms.settings.getPublic()` failed, `siteSettings` stayed null and /posts, /search, /events… rendered nothing.
    - Fix: a local `settled` flag (load finished, with or without data) also opens the gate → built-in screen.
    - Risk: A. Status: applied.

12. **followTitleSlug** — checked: follows only for new items / empty slug, stops after a manual edit (slug no longer equals slug(prevTitle)), never rewrites a saved slug; after the first save the editor is `isNew=false` so it stops. No change.

13. **Trashed / unpublished page holding a key** — checked: `findSystemPage` (public) needs `published`, `findSystemPageSlugs` needs `published`, the include-drafts read skips deleted/archived; bulk + editor status changes clear `page:system:*` and the settings cache. Kept the key on trash on purpose (restoring from the trash brings the assignment back; a claim from another page takes it over and reports it). Status: skipped (by design).

14. **Native `confirm()` for the new-post draft restore** (`PostEditor.tsx` ~l.352) — style rule prefers ConfirmModal. Status: skipped (cosmetic; works; would need a modal + state).

### Lead follow-up
- `packages/api/src/services/revisions.ts` `ENTITY_SKIP` (~l.419): skip `system_page` and `is_homepage` on restore (they are assignments, not content):
  `'id', 'created_at', …, 'updated_at', 'system_page', 'is_homepage',` — prevents a 409 restore failure / silent homepage take-over (finding 3).
- `packages/cms/src/stores/siteSettings.ts` `reloadSiteSettings`: do not `setSiteSettings(null)` before the fetch — keep the old value until the new one lands (set it in the load). Today every page/settings save blanks every reader of `siteSettings()` for one request (SystemPageRoute flashes the built-in screen, feature checks fall back to defaults).
- CLAUDE.md, System pages bullet: after "saving takes the key over from another page (`claimSystemPage` …)" change to: "saving takes the key over from another page — release + write in ONE transaction under `pg_advisory_xact_lock` (`withSystemPageLock` in `pages.repo`, `writeClaiming`/`resolveSystemPageClaim` in `services/pages.ts`), so concurrent claims serialize and a failed save keeps the old assignment".
- CLAUDE.md, Admin styles or Revert bullet: "Page/post editors show an Unsaved changes modal on in-app leave (`useEntityEditor().leaveGuard`, rendered by `EntityEditorShell`); a save snapshots what it sends — edits made during the save stay dirty."

### Verification
- `cd packages/api && npx tsc --noEmit -p .` → clean.
- `cd packages/api && npx vitest run src/services/pages.systemPage.test.ts` → 7 passed.
- `cd packages/cms && npx tsc --noEmit -p .` → only the known errors (CampaignDonations ×2, FormSubmissions ×3); none in my files.
- `cd packages/cms && npx vitest run --config ../../config/cms/vitest.config.ts src/utils/autoSlug.test.ts src/utils/pagePublicSettings.test.ts src/components/common/SystemPageRoute.test.ts` → 19 passed; `src/hooks src/components/admin/editors` → 32 passed.
- Not run in a browser (leave modal, draft restore) — type-checked only.

### Files touched
- packages/api/src/repositories/pages.repo.ts
- packages/api/src/services/pages.ts
- packages/api/src/services/pages.systemPage.test.ts (new)
- packages/cms/src/hooks/useEntityEditor.ts
- packages/cms/src/components/admin/editors/EntityEditorShell.tsx
- packages/cms/src/pages/admin/PageEditor.tsx
- packages/cms/src/pages/admin/PostEditor.tsx
- packages/cms/src/components/common/SystemPageRoute.tsx
- packages/cms/src/utils/autoSlug.ts (+ test)
- packages/cms/src/utils/pagePublicSettings.ts (new, + test)

---

# G — Gallery item page + Social block


### Findings

1. **SocialBlock tsc error (publishedAt: Date vs string)** — `packages/cms/src/components/blocks/types/SocialBlock.tsx:344`. `SocialPost.publishedAt` is typed `Date` (a string on the wire); the cast to `{ publishedAt?: string }` failed TS2352. Fix: `SocialEmbedProps.publishedAt` accepts `string | Date` (it is only passed to `new Date()`), the block passes `post.publishedAt` directly. Risk A. **applied** (tsc clean).

2. **YouTube facade thumbnail had no fallback** — `components/blocks/social/SocialEmbed.tsx:79,141`. Thumbnail was a CSS `background-image`; a stored `maxresdefault.jpg` that YouTube lacks gives a 404 / 120×90 grey placeholder, and a background image cannot detect it. Fix: real `<img class="social-embed__yt-thumb">` (object-fit cover, lazy, async decode, `alt=""` — the button carries the name) with onLoad/onError → swap to `hqdefault.jpg` when it failed or is ≤120px wide (`needsThumbFallback`). SCSS: facade background now plain `#000`, new `.social-embed__yt-thumb` rule. Risk A. **applied**.

3. **Focus lost after activating the facade** — `SocialEmbed.tsx` bindPlayer. The `<button>` is replaced by the iframe; keyboard focus fell to `<body>`. Fix: the iframe takes focus (`preventScroll`) when created. Risk A. **applied**.

4. **Facade / player accessible name was the full post description** — `aria-label={`Play: ${props.content}`}` and `title={props.content}` could be hundreds of characters. Fix: `youtubeFacadeLabel` (whitespace-collapsed, ≤100 chars with …), button "Play video: <title>", iframe title = the same. Risk A. **applied**.

5. **Iframe attributes** — video id interpolated unencoded into the embed + watch URLs; no `referrerpolicy` (YouTube's documented `strict-origin-when-cross-origin`; embeds without a referrer can refuse to play); `loading="lazy"` on a frame that only exists because the visitor tapped. Fix: `youtubeEmbedSrc` encodes the id, watch link encodes too, `referrerpolicy` added, `loading=lazy` removed. Risk A. **applied**.

6. **youtube-nocookie.com** — privacy-friendlier host; the coordinator already accepts both origins. Not switched: a CSP `frame-src` / behavior change for every site that should be the operator's call. Risk B. **skipped (product decision)**.

7. **One iframe at a time** — players stay mounted after play; `playbackCoordinator` already pauses others page-wide. No change. **n/a**.

8. **isSocialAutoFeed** — rule checked (`usePinned === true` only), covered by `shared/src/utils/socialDisplay.test.ts`. **n/a**.

9. **Collection strip remounted on every item switch (focus lost)** — `pages/gallery/GalleryItemPage.tsx:202`. Each switch refetches the neighbours list as new objects; `<For>` keyed by reference re-created every thumbnail, so the link just activated lost focus (keyboard users fell to the page top). Fix: `<For each={stripIds()}>` (strings) + `stripById` memo — DOM, focus and scroll stay; only `is-active` moves. Risk B. **applied**.

10. **Strip thumbnails could have no accessible name** — link name came only from img alt (`alt || title || ''`). Fix: `aria-label` = title, else alt, else "Item N", "(video)" suffix for videos; img `alt=""`. Risk A. **applied**.

11. **No keyboard prev/next** — added ←/→ on the item page (`pages/gallery/itemKeyNav.ts` `galleryNavKey` + `ARROW_OWNERS`): ignored in text fields, contenteditable, sliders, menus/listboxes, the video player (`.vp`, `.media-video`, `video`, `iframe`) and with any modifier; prev/next links carry `aria-keyshortcuts`. Risk B. **applied**.

12. **Scroll-to-current** — reviewed: sets `scrollTop`/`scrollLeft` on the list itself (`position: relative` offset parent), never `scrollIntoView`, so the page does not move. Sticky column uses `--site-header-offset` for `top` and `max-height`. Mobile becomes a static horizontal strip. No change. **n/a**.

13. **Neighbours capped at 200** — `GalleryItemPage.tsx:83` (`limit: 200`). In a collection with >200 items, an item past 200 gets no prev/next and is missing from the strip. Fix plan: when `findIndex < 0` and `meta.total > 200`, fetch the page that holds the item (needs a position/`around=<id>` API param in `services/gallery/items.ts` + DTO + SDK). Risk C. **planned** (outside scope).

14. **Hidden-in-gallery / empty / one-item collection** — hidden item: not in `listing` → no prev/next, strip shows siblings with nothing active (consistent with the guide). One item: strip hidden (`> 1`). Loading: "Loading…"; 404 → NotFound; 403 → access-denied fallback. No change. **n/a**.

15. **Mobile collections select on an item in a hidden collection** — `GalleryCollections.tsx` select `value` has no matching option, so it reads "All items". Cosmetic. **skipped (low value)**.

### Lead follow-up
- CLAUDE.md, Social hub bullet, after "the player iframe is created on tap (`autoplay=1`)": add "— the facade is a `<button>` with an `<img>` thumbnail that falls back to `hqdefault.jpg` when the stored one fails or is the 120px placeholder; the player takes focus, is named by the (shortened) title, and sends `referrerpolicy=strict-origin-when-cross-origin` (`social/youtubeFacade.ts`)".
- CLAUDE.md, Gallery bullet "Item page extras": add "←/→ open previous/next (not in text fields / the player); the strip keeps its DOM across item switches".
- docs/how-it-works/SOCIAL.md has no YouTube facade paragraph; optionally add one with the text above.
- Neighbours >200 (finding 13): needs an API param in gallery items service + DTO + SDK.

### Verification
- `cd packages/cms && npx tsc --noEmit -p .` → no errors in Social/Gallery files (SocialBlock error gone; remaining errors only CampaignDonations, FormSubmissions — pre-existing, other scope).
- `npx vitest run --config ../../config/cms/vitest.config.ts src/pages/gallery/itemKeyNav.test.ts src/components/blocks/social` → 3 files, 18 tests passed.
- Not browser-tested (per verification-depth rule).

### Files touched
- packages/cms/src/components/blocks/types/SocialBlock.tsx
- packages/cms/src/components/blocks/social/SocialEmbed.tsx
- packages/cms/src/components/blocks/social/SocialEmbed.scss
- packages/cms/src/components/blocks/social/youtubeFacade.ts (new) + youtubeFacade.test.ts (new)
- packages/cms/src/pages/gallery/GalleryItemPage.tsx
- packages/cms/src/pages/gallery/itemKeyNav.ts (new) + itemKeyNav.test.ts (new)
- docs/how-it-works/GALLERY.md

---

# Lead follow-up (all sub-areas, consolidated)

See each section's "Lead follow-up" for exact text. Summary:
1. `services/cache.ts`: `CACHE_KEYS.geoGate` + `acquireGate(key, ms)` (SET NX PX, fail open) for a cross-process Nominatim gate (E13); `CACHE_KEYS.formsPublic` / `formSlug` (F).
2. `routes/messages.ts:55` + `services/auth.ts` `clientIp()`: use `req.ip`, not the first `X-Forwarded-For` entry (F).
3. `services/formActions.ts`: `emailTo` with `{{…}}` can relay a submission to any address — rate-limit / require a validated email answer (F).
4. `services/revisions.ts` `ENTITY_SKIP`: add `system_page`, `is_homepage` (P).
5. `cms/src/stores/siteSettings.ts` `reloadSiteSettings`: keep the old value until the new one lands (P).
6. Gallery neighbours beyond 200 items: API param in gallery items service + DTO + SDK (G13).
7. Optional `ssr/staticMeta.ts`: `GeoCoordinates` in the event JSON-LD Place (E).
8. CLAUDE.md wording for Forms, Events "Location + map", System pages, Revert/leave guard, Social hub facade, Gallery item page extras (exact text in sections).
9. `npm run docs:api` (forms route summaries changed to staff).

# Verification (lead re-run, 2026-11-06)

- `packages/api`: `npx tsc --noEmit -p .` — 0 errors.
- `packages/cms`: `npx tsc --noEmit -p .` — only `CampaignDonations.tsx` (2, known, outside area). `SocialBlock.tsx` and `FormSubmissions.tsx` known errors are fixed.
- api vitest: mapPoint, events/crud, geo, geo.reverse, pages.systemPage, formAnswersEmail, forms.submit — 7 files, 52 passed.
- cms vitest: pendingLookups, SystemPageRoute, itemKeyNav, autoSlug, joinPrefill, youtubeFacade (+pagePublicSettings) — 7 files, 32 passed.
- shared vitest: formContact, formSections, socialDisplay — 69 passed.
- Not done: browser tests of the UI changes; migration 214 not run against a database.
