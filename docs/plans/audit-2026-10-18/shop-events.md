## shop-events

Scope: Shop + Printify + Events work since 2026-09-25 (order reconcile + tracking `96a3472f`, `667b557f`, shop admin review fixes `3dac2b7d`, inventory / sold out, ticketing through the cart, event access rules `9f6cf8c0`, one-email sign-up, ticket page). Read-only audit; nothing was changed.

**Totals: 32 findings (SE1–SE30 + 2 feature gaps at the end) — Phase A: 16 · Phase B: 11 · Phase C: 5.** Highest value first within each section.

---

### 1. Correctness / data integrity

#### SE1 — Reconcile is never idempotent for shipped orders (jsonb key order)
- **Location:** `packages/api/src/services/shop/providerFulfillment.ts:314` (`canonicalState`), used at `:369-376`
- **Problem:** `changed` compares `JSON.stringify(state.shipments)` (JS key order: carrier, number, url, shippedAt, deliveredAt) with `JSON.stringify(row.shipments)` read back from a **jsonb** column. Postgres jsonb stores keys sorted by length then bytes (url, number, carrier, shippedAt, deliveredAt), so the two strings never match once a row has shipments. Every 15-min cron run rewrites every shipped/delivered row in the 60-day window, bumps `updated_at`/`last_synced_at`, and reports them as "updated" in the Sync toast and the log. The unit test does not catch it because its mock stores the JS object unchanged (`providerFulfillment.test.ts:115`).
- **Fix:** canonicalise shipments with a fixed key order (`shipments.map(s => [s.carrier ?? null, s.number, s.url ?? null, s.shippedAt ?? null, s.deliveredAt ?? null])`) on both sides. Add a test whose mock reorders the keys.
- **Risk:** low · **Phase:** A
- **Status:** DONE (shipments canonicalised as positional tuples; jsonb key-reorder regression test)

#### SE2 — Supplier submit is not claimed: two concurrent submits can create two Printify orders
- **Location:** `packages/api/src/services/shop/providerFulfillment.ts:78-118`
- **Problem:** `submitGroup` does `SELECT external_order_id` → (null) → `INSERT … ON CONFLICT DO UPDATE SET status='submitting'` → `provider.submitOrder`. Nothing stops a second caller (Stripe webhook redelivery, the 15-min `retryPendingProviderFulfillment`, a manual retry) from passing the same check while the first call is in flight. The retry sweep also selects rows whose status is `submitting` (`:425`), so a slow supplier call can be re-sent. A crash between the supplier accepting and our `UPDATE … external_order_id` also re-sends on the next sweep (the reconcile step usually links it first, but only if it is in the listing).
- **Fix:** claim atomically: `INSERT … ON CONFLICT DO UPDATE SET status='submitting' … WHERE shop_order_fulfillments.external_order_id IS NULL AND (status <> 'submitting' OR updated_at < NOW() - INTERVAL '10 minutes') RETURNING id`; no row returned = skip. Make the retry sweep exclude fresh `submitting` rows by the same age rule.
- **Risk:** medium · **Phase:** B
- **Status:** DONE (atomic claim `ON CONFLICT … WHERE external_order_id IS NULL AND (status<>submitting OR stale) RETURNING`; sweep skips fresh `submitting`; SUBMIT_CLAIM_MINUTES=10; providerSubmit.test.ts)

#### SE3 — Recurring events: sign-up always targets the FIRST occurrence
- **Location:** `packages/cms/src/components/events/EventSignup.tsx:157`; `packages/cms/src/pages/Events.tsx:18`; `packages/api/src/services/events/registration.ts:69`
- **Problem:** `occurrenceDate = props.event.startsAt.slice(0, 10)`. The calendar navigates to `/events/:slug` without the clicked date, so a visitor who picks week 3 of a weekly series registers / buys tickets for week 1 (often already past). Tier capacity and "sold" counts on the page are also for week 1. Also `slice(0,10)` of a UTC ISO string gives the NEXT day for evening events in US time zones (20:00 ET = 00:00Z).
- **Fix:** navigate with `?date=YYYY-MM-DD`; `EventDetail` reads it (falling back to the next upcoming occurrence, not the series start) and passes `occurrenceDate` to `EventSignup` + `listTiers`; compute the date in the event's `timezone`. Show the chosen date on the card with a date picker for the series.
- **Risk:** medium · **Phase:** B
- **Status:** DONE (calendar links `?date=`; EventDetail picks ?date / next upcoming occurrence, re-reads tiers per date, shows a date picker for a series; times shown in the event time zone; register() with no date → next upcoming occurrence. Occurrence keys stay UTC dates — the engine's canonical key — so the "next day" note is a display fix, not a key change)

#### SE4 — Occurrence dates are never validated on register / ticket purchase
- **Location:** `packages/api/src/services/events/registration.ts:69`, `packages/api/src/services/events/tickets.ts:72-76`
- **Problem:** any `YYYY-MM-DD` is accepted: a date with no occurrence, a cancelled occurrence (`event_occurrence_overrides`), or a past one. Because capacity is per occurrence, a made-up date also has a full, fresh capacity.
- **Fix:** one helper `assertBookableOccurrence(event, date)` using the shared recurrence engine (`@sitesurge/types utils/recurrence.ts`) + overrides: must be an occurrence, not cancelled, not ended. Call it from `register()` and `resolveTicketLines()`.
- **Risk:** low · **Phase:** A
- **Status:** DONE (`services/events/bookable.ts` assertBookableOccurrence: real occurrence, not cancelled, not ended — enforced on public register + ticket resolve; not on post-payment fulfilment)

#### SE5 — Free ticket claim mixes occurrence dates
- **Location:** `packages/api/src/services/events/purchase.ts:52-68`
- **Problem:** only "one event" is enforced. Lines for two dates of the same series pass; the registration is created for `lines[0].occurrenceDate` while `issueTickets` writes each ticket with its own line date (`tickets.ts:173`), so a ticket points at a registration for a different day.
- **Fix:** require a single `(eventId, occurrenceDate)` per purchase (or register once per date, as `issueOrderTickets` already does).
- **Risk:** low · **Phase:** A
- **Status:** DONE (free claim refuses lines for more than one date)

#### SE6 — Apliiq tracking webhooks are only logged; `recordProviderTracking` has no caller
- **Location:** `packages/api/src/services/shop/providers/handlers.ts:183-188`; `packages/api/src/services/shop/providerFulfillment.ts:439`
- **Problem:** `fulfillment` / `warehouse_shipment_complete` return 200 and write a log line ("lands in Task 5"). Apliiq orders never get tracking, never move to shipped, and the buyer never sees a link. `recordProviderTracking` (the intended sink) is dead code, and it stores the raw supplier status string (case-sensitive vs `SHIPPED_ROW`). The log line also writes up to 400 chars of the payload, which carries the customer's name and address.
- **Fix:** parse the Apliiq payload into `ProviderFulfilmentState` and call `applyFulfilmentState` (the same path Printify uses — it already handles manual tracking, roll-up and forward-only status). Delete `recordProviderTracking` or make it normalise to `FulfilmentRowStatus`. Log only ids.
- **Risk:** medium · **Phase:** B
- **Status:** DONE (`providers/apliiq/tracking.ts` tolerant parser → applyFulfilmentState; matched by Apliiq order id or our order number; logs ids only; dead recordProviderTracking removed)

#### SE7 — Reconcile matches Printify manual orders by label
- **Location:** `packages/api/src/services/printify/orderSync.ts:209-228`
- **Problem:** "skip manual + sample" is only a side effect of not matching. An operator who re-creates a failed order by hand in the Printify dashboard and types our order number as the label (a natural thing to do) gets it matched and linked; a manual order typed with the wrong number links to the wrong order. `metadata.order_type` is read in the type but never checked.
- **Fix:** for `order_type` `manual`/`sample`, allow only an exact stored-id match (or record it as "matched by label — confirm" in `result.errors` instead of linking).
- **Risk:** low · **Phase:** A
- **Status:** DONE (manual/sample Printify orders matched only by label/external id are reported "not linked automatically" in result.errors)

#### SE8 — Manual "Sync from Printify" and the cron can run at the same time; manual sync can outlive the HTTP timeout
- **Location:** `packages/api/src/routes/shop.ts:1107`; `packages/api/src/services/printify/orderSync.ts:401-422`; `packages/api/src/services/printify/cron.ts:24`
- **Problem:** the button runs the full product sync plus a 365-day order reconcile (up to 40 list pages + 25 single fetches) inside one request. On a busy store this passes nginx's 60 s proxy timeout: the browser shows a failure while the work continues. Nothing serialises it with the cron tick, so both write the same rows (mostly harmless today, but SE2 makes overlapping submits possible).
- **Fix:** take `pg_try_advisory_lock('printify:sync')` in both paths (manual answers 409 "a sync is running"); run the manual reconcile as a background job and poll a status endpoint, or cap the manual window to 90 days with a "Full resync" option.
- **Risk:** medium · **Phase:** B
- **Status:** DONE (session advisory lock `printify:sync` shared by cron + button → 409 SYNC_RUNNING; manual window 90 days; new `POST /shop/printify/orders/resync` runs the 365-day reconcile in the background; "Full order resync" button)

#### SE9 — Refund uses the env Stripe key, not the shop's configured key (same for Stripe Tax)
- **Location:** `packages/api/src/services/shop/orders.ts:115-124`; `packages/api/src/services/shop/checkout.ts:367-371`
- **Problem:** `new Stripe(config.stripe.secretKey)` ignores the per-context credentials (`stripeCredentials('shop')`, Settings → shop payment credentials). A shop on its own Stripe account (or DB-configured keys with no env key) gets "Stripe is not configured" on refund, or a "No such payment_intent" from the wrong account; tax silently computes 0.
- **Fix:** use `getStripeClient('shop')` in both places; add an `idempotencyKey: refund:<orderId>` to `refunds.create`.
- **Risk:** low · **Phase:** A
- **Status:** DONE (refund + Stripe Tax use getStripeClient('shop'); refund idempotencyKey `refund:<orderId>`; charge_already_refunded treated as success)

#### SE10 — Order detail: refund copy contradicts the behaviour; the status select refunds without a confirm
- **Location:** `packages/cms/src/pages/admin/shop/ShopOrderDetail.tsx:133`, `:245`
- **Problem:** the Refund confirm says "Issue the actual refund in Stripe separately", but `orders.update` DOES call `stripe.refunds.create` when the status moves to `refunded`. An operator following the text refunds in Stripe first; our call then fails ("already refunded") and the status never flips. Choosing `refunded` in the Status select and pressing Save also issues a real refund, with only the "email the customer?" prompt.
- **Fix:** copy: "Refund the full amount (…) to the customer's card through Stripe?" with the amount; remove `refunded` from the free status select (refund only via the button); disable the button while busy; use the project confirm modal instead of `confirm()`. Treat Stripe's `charge_already_refunded` as success that still flips the status.
- **Risk:** low · **Phase:** A
- **Status:** DONE (refund ConfirmModal with amount and true copy; `refunded` removed from the Status select; button disabled while busy; route requires shop.orders:refund on that transition)

#### SE11 — Merchandise announce can double-send
- **Location:** `packages/api/src/services/shop/merchandiseAnnounce.ts:328-338`
- **Problem:** products are stamped `merch_announced_at` only after `mailSend.send()` creates the job. A double-click, two admins, or the hourly auto-send overlapping a manual send each create a job for the same products → the list is mailed twice.
- **Fix:** claim first in one statement (`UPDATE … SET merch_announced_at = NOW() WHERE id = ANY($1) AND (merch_announced_at IS NULL OR $manual) RETURNING id`) under `pg_advisory_xact_lock('merch-announce')`, and clear the stamp if the send throws. Disable the modal's Send button while pending.
- **Risk:** low · **Phase:** A
- **Status:** DONE (claim-first single UPDATE with row locks; cron claims only never-announced, manual may re-announce outside a 10-min window; claim released on send failure; Send guarded)

#### SE12 — "Awaiting Printify" alert ignores cancelled supplier orders
- **Location:** `packages/api/src/services/printify/sync.ts:349-365`
- **Problem:** a paid order whose Printify order was cancelled (status `cancelled` on the fulfilment row) needs a human and usually a refund — `computeRollUp` deliberately leaves the order status alone — but the alert does not count it, so it is invisible.
- **Fix:** add `OR f.status = 'cancelled'` to the attention query and name the reasons separately in the bar ("2 not sent · 1 on hold · 1 cancelled by Printify").
- **Risk:** low · **Phase:** A
- **Status:** DONE (shared `services/shop/attention.ts` incl. supplier-cancelled; status returns per-reason counts; bar names them)

---

### 2. Security / privacy

#### SE13 — Shop and Events permissions are declared but never checked
- **Location:** `packages/api/src/services/permissions/catalog.ts:288-315`; `packages/api/src/routes/shop.ts`, `packages/api/src/routes/events.ts`
- **Problem:** `shop:read`, `shop:write`, `shop.orders:read`, `shop.orders:refund`, `events:read`, `events:write`, `events.registrations:read` exist in Settings → Permissions but no route or service calls them (only `shop.orders:write` on PATCH order and `shop.providers:write`). Removing "Refund orders" from a role changes nothing; an editor (staff tier) can read every event registrant's email/phone regardless of `events.registrations:read`. CLAUDE.md requires every gated read/write to check its permission. The merchandise announce (mails a real list) also skips `mailing_lists:send`, and `resend-receipt` / settings PUT / Printify sync check nothing beyond the tier.
- **Fix:** add `requirePermission` per route (refund on the `refunded` transition inside `orders.update`, `mailing_lists:send` on `/merchandise/announce`, `events.registrations:read` on `/:id/registrations`, `events:write` on create/update/delete/tiers/occurrences). Defaults already preserve today's access.
- **Risk:** low · **Phase:** A
- **Status:** DONE (route permission tables in routes/shop.ts + routes/events.ts wrap handlers; refund, announce (mailing_lists:send), registrants, event writes, settings, Printify sync, resend receipt; admin order reads need shop.orders:read; staff draft views need events:read; API keys skipped; routes/shopEvents.permissions.test.ts)

#### SE14 — HTML injection in order emails (buyer name, address, item titles, SKU)
- **Location:** `packages/api/src/services/shop/orderEmails.ts:110-113`, `:188`, `:300`
- **Problem:** `renderItemsTable`, `renderAddress` and `buildSellerNotification` interpolate `item.title`, `variantTitle`, `sku`, address lines and `customerName` raw. Name and address are buyer-typed at checkout; titles can come from the UNAUTHENTICATED Apliiq add-to-store webhook. A buyer named `<a href="https://evil">Refund request</a>` puts a working link into the seller notification. Tracking text in the same file IS escaped, so this is an inconsistency.
- **Fix:** wrap every interpolated value in `escapeHtml`; add a test with `<script>` in name/address/title.
- **Risk:** low · **Phase:** A
- **Status:** DONE (every interpolated value escaped in items/address/seller/status emails + shell; tests with markup in name/address/title)

#### SE15 — Anonymous order view exposes email, name and digital download tokens by order number
- **Location:** `packages/api/src/services/shop/orders.ts:87-95`; `packages/api/src/services/shop/orderNumber.ts:13`
- **Problem:** the public projection nulls addresses and Stripe ids but keeps `customerEmail`, `customerName` and each item's `downloadToken`. The order number appears in subjects, receipts (filename), screenshots and forwarded emails; anyone holding it gets the buyer's identity and the digital files — the "unguessable token" guard on `/download/:token` is moot. The random part of the number is only 16 bits (`randomBytes(3).hex.slice(0,4)`), the rest is a timestamp.
- **Fix:** anonymous projection: drop `customerEmail`/`customerName`, keep `downloadToken` only when the viewer owns the order (user id/email) or presents a separate secret (e.g. a `?k=` confirmation key stored on the order and put in the post-checkout redirect + email). Use `randomBytes(5)` base32 for new order numbers.
- **Risk:** medium (changes what the confirmation page can show) · **Phase:** B
- **Status:** DONE (migration 171 `shop_orders.access_key` + lower(email) index; anonymous by-number view drops email/name/download tokens unless signed-in owner or `?k=` key; key in post-checkout redirect, confirmation email link and receipt URL; order numbers now 40 random bits base32)

#### SE16 — Ticket codes use `Math.random`
- **Location:** `packages/api/src/services/events/tickets.ts:107-114`
- **Problem:** the code is the credential for `/tickets/:code` (attendee name, event, sibling tickets) and a later check-in. `Math.random` is not a CSPRNG; there is also no retry on a unique-constraint collision (the insert would abort the whole transaction).
- **Fix:** `crypto.randomInt(alphabet.length)`; retry the insert on `23505` up to 3 times.
- **Risk:** low · **Phase:** A
- **Status:** DONE (crypto.randomInt codes; ON CONFLICT (code) DO NOTHING + 3 retries so a clash never aborts the transaction)

#### SE17 — Public endpoints email arbitrary addresses with no limit
- **Location:** `packages/api/src/routes/events.ts:110-147`, `:224-251`; `packages/api/src/services/events/subscriptions.ts:24-45`
- **Problem:** anonymous `POST /events/:id/register` sends "You're registered" to any address; `POST /events/subscribe` subscribes any address to every future announcement with no confirmation; `/push/subscribe` takes `body.email ?? user.email` (body wins, the reverse of every other route). This is a free mail cannon from the site's sending domain (SES reputation) and lets strangers sign people up.
- **Fix:** per-IP + per-email Redis rate limit (reuse the discussions `spam.ts` pattern), honeypot field, double opt-in for anonymous `subscribe` (confirmation link, like mailing lists), `user?.email ?? body.email` on push.
- **Risk:** low · **Phase:** B
- **Status:** DONE (Redis per-IP + per-address limits on register / subscribe / ticket purchase via discussions limiter; honeypot `website` on register + subscribe (form field added to EventSignup); anonymous subscribe is double opt-in — migration 172 `event_subscribers.confirmed_at`, signed confirm link `GET /events/subscribe/confirm/:token`, unconfirmed rows never notified; push uses the account email first)

#### SE18 — Event emails: unescaped title/location, wrong timezone, hardcoded URL
- **Location:** `packages/api/src/services/events/registration.ts:85-97`; `packages/api/src/services/events/purchase.ts:101-128`
- **Problem:** `event.title` / `location` go into HTML raw; `toLocaleString('en-US')` runs without `timeZone`, so on a UTC server an 7 pm ET event reads "11:00 PM"; the ticket email links `/events/${slug}` and ignores the configurable `eventsUrl` (the registration email uses `eventUrl(event)` correctly); `#666` literal.
- **Fix:** shared `formatEventWhen(event)` using `event.timezone ?? settings default`; `escapeHtml`; `eventUrl(event)` in both. See SE27 for moving these bodies to mail purposes.
- **Risk:** low · **Phase:** A
- **Status:** DONE (`format.ts` describeWhen in event tz → site default → America/New_York, per occurrence; eventLink honours Settings → Events URL; escaped; #6b7280)

---

### 3. UI / UX

#### SE19 — Order confirmation page flashes "Loading…" on every poll
- **Location:** `packages/cms/src/pages/shop/ShopOrderConfirmation.tsx:70`
- **Problem:** `<Show when={!order.loading}>` — `refetch()` sets `loading` true, so while an order is `pending` the whole page is replaced by "Loading…" every 4 s for up to 2 min — exactly the moment the buyer is anxious about the payment.
- **Fix:** gate on `order.state === 'pending'` (first load only) and read `order.latest`; keep the "Confirming your payment…" line. Also add the Discount row the admin shows (totals do not add up without it) and show the status through a human label map.
- **Risk:** low · **Phase:** A
- **Status:** DONE (first-load gate only, reads order.latest; Discount row via shared totals; buyer-facing status labels)

#### SE20 — Digital products cannot be downloaded by the buyer
- **Location:** `packages/cms/src/pages/shop/ShopOrderConfirmation.tsx:106-121`; `packages/api/src/services/shop/orderEmails.test.ts:95`
- **Problem:** the token-gated `/orders/:n/download/:token` exists, and CLAUDE.md says the confirmation page shows download links, but nothing renders them: the page lists items without a Download button, and the email deliberately omits the link (the endpoint returns JSON). A buyer of a digital item has no path to the file.
- **Fix:** on the confirmation page (and profile order history) render a Download button per `isDigital` item that calls `cms.shop.orders.download(number, token)` and navigates to the URL; the buyer email links to the confirmation page ("Get your downloads"). Combine with SE15's ownership/secret check.
- **Risk:** low · **Phase:** B
- **Status:** DONE for the confirmation page + email (Download button per digital item via downloadUrl; buyer email links "Get your downloads"/"View your order" with the access key). Profile order history download buttons → CROSS-AREA

#### SE21 — Admin order detail: no per-supplier fulfilment panel or retry
- **Location:** `packages/cms/src/pages/admin/shop/ShopOrderDetail.tsx:229-317`
- **Problem:** `shop_order_fulfillments` holds per-supplier status, external order id, `last_error`, attempts, synced-at — the very data the "awaiting Printify" alert counts — but the order page shows none of it. The operator sees "paid / unfulfilled" and must open Printify to learn why. There is no "Retry submission" or "Re-sync this order".
- **Fix:** a Fulfilment panel: one row per supplier (status badge, external id linking to the supplier's order page, last error, attempts, last synced) + **Retry** (`POST /shop/orders/:id/fulfilment/:provider/retry` → `submitOrderToProviders`) and **Refresh from supplier** (`getOrder` → `applyFulfilmentState`). Permission `shop.orders:write`.
- **Risk:** low · **Phase:** B
- **Status:** DONE (`GET /shop/orders/:id/fulfilments`, `POST …/fulfilment/:provider/retry|refresh`; provider contract gains `fetchOrderState` (Printify implements); Suppliers panel on the order page)

#### SE22 — Order detail never leaves "Loading order…" when the read fails
- **Location:** `packages/cms/src/pages/admin/shop/ShopOrderDetail.tsx:50`, `:152`
- **Problem:** the fetcher returns `null` on any error and the `Show` fallback is the loading text, so a bad id / 404 / network error shows "Loading order..." forever. Resend receipt has no busy state (double-send on double-click).
- **Fix:** distinguish `order.loading` from `order() === null` → "Order not found" + back link; `busy` on Resend receipt.
- **Risk:** low · **Phase:** A
- **Status:** DONE (not-found state with back link; Resend receipt busy state)

#### SE23 — Orders list: no search, no "needs attention" filter, no export
- **Location:** `packages/cms/src/pages/admin/shop/ShopOrders.tsx:33-54`; `packages/cms/src/pages/admin/shop/PrintifySyncBar.tsx:117`
- **Problem:** the list filters only by status (hardcoded option list duplicating `ORDER_STATUSES`). An operator cannot find an order by number or email, and the alert's "Review orders" link lands on the unfiltered list. Every other money table (donations, users, entities) has the Export menu; orders do not.
- **Fix:** `search` (order number / email / name, ILIKE) + `attention=1` filter backed by the SAME SQL as `getStatus` (extract it into one function), date range, and an `orders` export source in `services/export/sources.ts` + `ExportMenu`. Link the alert to `?attention=1`.
- **Risk:** low · **Phase:** B
- **Status:** DONE (search / date range / needs-attention filters backed by the shared attention SQL; status options from shared SHOP_ORDER_STATUSES; `GET /shop/orders/export` CSV/print (data:export + shop.orders:read) + ExportMenu; alert links `?attention=1`). Built inside the shop module rather than services/export (another area)

#### SE24 — Dashboard "Recent paid sales" is computed from the last 10 orders on the client
- **Location:** `packages/cms/src/pages/admin/shop/ShopDashboard.tsx:21`, `:52-57`, `:195`
- **Problem:** the headline number is the sum of whichever of the last 10 orders are paid — it moves randomly with order mix and is not a period. The dashboard also loads 100 products just to count them.
- **Fix:** `GET /shop/stats` (revenue + order count for 7 / 30 days, paid-not-shipped count, attention count, low-stock count) in one SQL round-trip; render as stat cards with the period named.
- **Risk:** low · **Phase:** B
- **Status:** DONE (`GET /shop/orders/stats` one round-trip: 7/30-day paid revenue + orders, to ship, needs attention, low stock, product counts; dashboard stat cards; no more 100-product load)

#### SE25 — Buyers' own orders matched by case-sensitive email
- **Location:** `packages/api/src/repositories/shop/shopOrders.repo.ts:183`; `packages/api/src/services/shop/orders.ts:67`
- **Problem:** guest checkout as `Jane@x.com`, account `jane@x.com` → the profile order history and `GET /orders/:id` do not find the order.
- **Fix:** `lower(customer_email) = lower($n)` (+ functional index) and the same in `assertOwnership`.
- **Risk:** low · **Phase:** A
- **Status:** DONE (lower(customer_email) in list + ownership; functional index in migration 171)

---

### 4. Styling / consistency

#### SE26 — Native checkboxes in shop admin
- **Location:** `packages/cms/src/pages/admin/shop/ShopProductEditor.tsx:914`, `:933`, `:1111`; `ShopProducts.tsx:206`, `:241`; `ShopCollections.tsx:215`; `MerchandiseAnnounceModal.tsx:210`
- **Problem:** CLAUDE.md: no native checkbox anywhere — `Toggle` for settings, `components/ui/Checkbox` for selection. Category/collection membership, product row selection, collection product picker and announce product picker are selection → `Checkbox`; variant "Requires shipping" is a setting → `Toggle`. Shop SCSS also carries literal `#fff` (`_shop.scss:126,131,980,1029,1199`) and the order emails hardcode `#e63946` three times instead of the site primary.
- **Fix:** swap to `Checkbox`/`Toggle`; `$white`/token variables in `_shop.scss`; pass `appearance.primaryColor` into `wrapEmail` for link colour.
- **Risk:** low · **Phase:** A
- **Status:** DONE (selection → ui/Checkbox, "Requires shipping" → Toggle; literal #fff → $background in _shop.scss; order-email accent = site primary when a hex)

---

### 5. Architecture / code

#### SE27 — Event emails are hardcoded HTML, not mail purposes
- **Location:** `packages/api/src/services/events/registration.ts:89-98`, `packages/api/src/services/events/purchase.ts:114-129`
- **Problem:** "You're registered" and "Your tickets" are inline template strings: the operator cannot edit them, they bypass the shared template engine and email shell (no logo, no site typography), and every fix (SE18) must be done twice. Shop emails already use purposes (`shop_order_shipped`, …).
- **Fix:** add `event_registered` and `event_tickets` to `MAIL_PURPOSES` with built-in default bodies (empty blocks = default, as for every purpose) and variables `event.*`, `occurrence.when`, `tickets[]` (code, tier, url), `registration.*`; render through `sendTemplatedEmail`.
- **Risk:** medium · **Phase:** C
- **Status:** DONE (`event_registered` + `event_tickets` mail purposes with built-in default bodies + variables; sent via sendPurposeMail; Emails section in Event Settings)

#### SE28 — Shop Settings save hand-lists every field
- **Location:** `packages/cms/src/pages/admin/shop/ShopSettings.tsx:108-139`
- **Problem:** the save builds `settings` field by field; the last commit had to add four that were silently dropped (`storefrontMode`, `cartDisplay`, …). Every new setting repeats that trap.
- **Fix:** send `{ ...unwrap(settings), shipping, tracking: cleaned }` and keep the explicit transforms only for the fields that need them (shipping dollars→cents, tracking rows); the server's zod schema already whitelists keys.
- **Risk:** low · **Phase:** B
- **Status:** DONE (save spreads every setting, explicit transforms only for shipping + tracking; server zod still whitelists)

#### SE29 — Order totals / shipping breakdown duplicated across surfaces
- **Location:** `packages/cms/src/pages/admin/shop/ShopOrderDetail.tsx:203-221`; `packages/cms/src/pages/shop/ShopOrderConfirmation.tsx:142-173`; `packages/api/src/services/shop/orderEmails.ts` (`renderTotals`); `receipt.ts`
- **Problem:** four renderings of subtotal / shipping (+ first/additional breakdown) / tax / discount / total; they already disagree (the storefront omits Discount, the admin omits the "= total" on the first-item line).
- **Fix:** a shared `orderTotalsLines(order, shippingSettings)` in `@sitesurge/types` returning labelled rows; one `OrderTotals` Solid component used by admin + storefront + profile; email and PDF map the same rows.
- **Risk:** low · **Phase:** C
- **Status:** DONE (`orderTotalsLines` in @sitesurge/types + `components/shop/OrderTotals`; admin, storefront, order emails and PDF receipt all print the same rows)

#### SE30 — `orderSync` / `providerFulfillment` / `PrintifySyncBar` are getting the supplier-specific logic the provider contract was meant to hold
- **Location:** `packages/api/src/services/printify/orderSync.ts`; `packages/api/src/services/shop/providers/types.ts`; `packages/api/src/services/printify/cron.ts`
- **Problem:** reconcile (list + match + map), the "needs attention" query and the cron are Printify-only modules, while Apliiq has a stub (SE6) and Printful a scaffold. Adding the second supplier with tracking will copy ~400 lines. The legacy `shop_orders.printify_order_id/printify_status` are still written on every reconcile (`orderSync.ts:328`).
- **Fix:** add `reconcileOrders?(config, sinceDays)` returning `{ externalOrderId, ourOrderNumber, state }[]` to `ShopProvider`; make the matching/apply loop, the attention query and the cron provider-generic (`shop:fulfilment-sync`), Printify keeping only `listOrders` + `mapPrintifyOrder`. Stop writing the legacy columns once no reader remains (they are read-only by design).
- **Risk:** medium · **Phase:** C
- **Status:** PARTIAL (provider contract already had reconcileOrders; added fetchOrderState, provider-generic attention SQL and `runProviderReconciles` called from the 15-min cron for non-Printify pull suppliers). SKIPPED: stop writing legacy printify_order_id/printify_status — still exposed as `ShopOrder.printifyOrderId/printifyStatus` in the published SDK, so a reader remains. CROSS-AREA: a dedicated `shop:fulfilment-sync` cron needs lib.ts

---

### Feature gaps (small, operator-expected) — folded into the findings above
- Per-supplier fulfilment panel + retry (SE21) · order search / attention filter / CSV (SE23) · real period stats (SE24) · digital downloads (SE20) · editable event emails (SE27).
- **Status (registrant export + check-in):** DONE — `GET /events/:id/registrations/export` (CSV / print door list with ticket codes; events.registrations:read + data:export) + Export menu on the Registrants table; migration 172 `event_tickets.checked_in_at`; `PUT /events/tickets/:code/check-in` (events:write) + Check in / Undo on the ticket page for staff.
- **Status (per-buyer free-ticket cap):** DONE — migration 172 `event_ticket_tiers.max_per_order`; enforced on public purchase + shop checkout by email per date; "Per person" column in the tier editor.
- Not yet listed above, Phase C: **registrant export + check-in** (`packages/cms/src/pages/admin/events/RegistrantsTable.tsx`) — add an `event_registrations` export source (CSV / print with ticket codes) and a ticket `checked_in` toggle on the ticket page for staff (the `checked_in` status already exists in `issueTickets`' count). **Per-buyer free-ticket cap** (`tiers.ts`/`purchase.ts`: today one email can claim the whole free capacity, 50 per line, unlimited calls) — add `maxPerOrder` on the tier and count existing valid tickets per email + occurrence.


---

### Implementation summary (2026-10-18)

Migrations added: **171** `171_shop_order_email_lower_access_key.sql` (shop), **172** `172_event_subscriber_confirm_ticket_caps.sql` (events) — both registered in `features/registry.ts`. 173–174 unused.

#### Cross-area follow-ups
- Profile → Orders (profile area): render a **Download** button per digital item (`cms.shop.orders.downloadUrl`) and use `components/shop/OrderTotals` for the totals (SE20, SE29).
- `packages/api/src/lib.ts`: register a dedicated provider-generic `shop:fulfilment-sync` cron (today `runProviderReconciles` runs inside the Printify cron tick) (SE30).
- `packages/shared/src/types/mailPurposes.ts` (shared registry) gained the two `event_*` purposes — owner of that file should know.
- `services/export/sources.ts` / `routes/exports.ts` (exports area): optionally move the orders + registrants export sources there; today they live in the shop/events modules.
- `variables.scss`: no `$white` token; `_shop.scss` uses `$background` for white text-on-dark — a dedicated `$on-primary`/`$white` token would read better.
- Legacy `shop_orders.printify_order_id/printify_status`: stop writing once the SDK `ShopOrder.printifyOrderId/printifyStatus` fields are deprecated (SE30).

#### Docs to update
- `docs/API.md` + `docs/api-manifest.json`: regenerate (`npm run docs:api`) — new routes: `GET /shop/orders/stats`, `GET /shop/orders/export`, `GET /shop/orders/:id/fulfilments`, `POST /shop/orders/:id/fulfilment/:provider/{retry,refresh}`, `POST /shop/printify/orders/resync`, `GET /events/subscribe/confirm/:token`, `GET /events/:id/registrations/export`, `PUT /events/tickets/:code/check-in`; `?k=` on `/shop/orders/number/:n` + receipt; order list `search/attention/from/to`. Then `npm run check:drift -w packages/cms-client`.
- CLAUDE.md:
  - Shop: order **access key** (`?k=`, migration 171) — what an anonymous order-number view shows vs. owner/key; order numbers 40-bit base32; refunds via the shop Stripe context (idempotent, "already refunded" = success); Status select no longer offers `refunded`.
  - Shop: Suppliers panel + retry/refresh routes; provider contract `fetchOrderState`; Apliiq tracking webhooks now write tracking (`providers/apliiq/tracking.ts`); supplier submit claim (`SUBMIT_CLAIM_MINUTES`); Printify sync lock + 90-day manual window + background full resync.
  - Shop: one "needs attention" definition (`services/shop/attention.ts`, incl. supplier-cancelled) used by the bar and `?attention=1`; dashboard stats endpoint; orders export; `orderTotalsLines` / `OrderTotals` as the one totals definition.
  - Shop: merchandise announce claims products first (no double send).
  - Shop + Events: route permission tables (`SHOP_ROUTE_PERMISSIONS`, `EVENT_ROUTE_PERMISSIONS`) — which permission gates which route.
  - Events: occurrence-aware sign-up (`?date=`, date picker, next upcoming default), `assertBookableOccurrence`, single date per free claim, per-buyer cap `max_per_order`, double opt-in subscriptions (`confirmed_at`), public write rate limits + honeypot, `event_registered` / `event_tickets` mail purposes, check-in, registrant export, emails in the event time zone + configurable events URL.
- `docs/how-it-works/shop-go-live-checklist.md`: mention the order access key and the refund permission.
