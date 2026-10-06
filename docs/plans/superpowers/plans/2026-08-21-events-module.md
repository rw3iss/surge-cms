# Events Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A complete event coordination system — calendar management, recurring events, attendee registration, tiered ticketing with checkout, a content block, and a `{{event()}}` template function — shipped as the opt-in `events` feature module.

**Architecture:** Recurring events are stored as a single row carrying a recurrence rule, expanded to occurrences at read time, with an overrides table for per-date cancellations and edits. Ticketing reuses the existing Shop cart and Stripe checkout by introducing a *virtual* line-item kind rather than creating real product rows. Admin and public calendars share one presentational component driven by a `mode` prop.

**Tech Stack:** Express + PostgreSQL (raw `pg`) + Redis; SolidJS + Vite; Stripe via the existing shop checkout; the existing mail provider abstraction for confirmations.

---

## 1. Decisions (locked before implementation)

| Decision | Choice | Why |
|---|---|---|
| Recurrence storage | Rule + overrides | No row explosion for "repeats forever"; per-date cancel/move without rewriting a series; matches iCal semantics. |
| Ticketing | Reuse Shop cart + checkout | One cart per user; reuses tested Stripe/tax/inventory code. Paid tickets require the `shop` feature; free tickets do not. |
| Timezone storage | UTC `TIMESTAMPTZ` + an IANA zone string per event | A wall-clock time ("7pm") must survive DST; storing the zone lets us re-render correctly. |
| Ticket rows | Issued only on payment success | Avoids phantom inventory from abandoned carts; a short server-side hold covers the checkout window. |
| Public URL | Operator-configurable, default `/events` | Spec requirement; validated against existing page slugs and reserved routes. |

### 1.1 Why tickets are not real products

Creating a `shop_products` row per event/tier would pollute the catalog, the sitemap, search, and the Printify sync. Instead the cart carries a **virtual line item** discriminated by `kind: 'event_ticket'`. The checkout re-resolves price and remaining inventory from `event_ticket_tiers` server-side, exactly as it already re-validates real products — so a tampered cart cannot change a price.

---

## 2. Data model

Migration `092_create_event_system.sql` (`-- @feature events`), extending the tables already created by `091`.

```
events                      (091, EXTENDED here)
  + timezone            VARCHAR(64)   -- IANA, e.g. America/New_York
  + ends_time           -- already covered by ends_at
  + recurrence_rule     VARCHAR(255)  -- NULL = single occurrence
  + recurrence_until    TIMESTAMPTZ   -- NULL = forever
  + registration_enabled BOOLEAN
  + registration_fields  JSONB        -- ['name','email','phone']
  + show_registrant_count BOOLEAN
  + ticketing_enabled    BOOLEAN
  + metadata             JSONB

event_occurrence_overrides            -- per-date exceptions to a series
  event_id, occurrence_date (UNIQUE together)
  status ('cancelled'|'moved'), starts_at_override, ends_at_override, title_override

event_ticket_tiers
  event_id, name, price_cents, currency, quantity_available (NULL = unlimited),
  position, created_at

event_registrations                   -- one per attendee per occurrence
  event_id, occurrence_date, user_id, email, name, phone, fields JSONB,
  status ('registered'|'cancelled'|'waitlist'), order_id, created_at
  UNIQUE (event_id, occurrence_date, LOWER(email))

event_tickets                         -- issued on payment (or free confirm)
  registration_id, tier_id, event_id, occurrence_date,
  code (UNIQUE), status ('valid'|'refunded'|'checked_in'), price_cents_paid
```

**Occurrence identity.** A recurring event's occurrence is addressed by `(event_id, occurrence_date)`. Registrations and tickets both carry it, so week 3 of a weekly series has its own attendees and its own inventory.

---

## 3. File structure

**Backend**
| File | Responsibility |
|---|---|
| `db/migrations/092_create_event_system.sql` | Schema above |
| `services/events/recurrence.ts` | Pure rule→dates expansion + override application. No I/O, fully unit-testable. |
| `services/events/index.ts` | Event CRUD (extends existing `services/events.ts`) |
| `services/events/registration.ts` | Register, cancel, capacity, registrant counts |
| `services/events/tickets.ts` | Tier CRUD, inventory maths, ticket issuance |
| `services/events/cart.ts` | Virtual cart-line validation + issuance hook for checkout |
| `repositories/events.repo.ts` | Extended with the new tables |
| `routes/events.ts` | Extended: tiers, registration, occurrence overrides, settings |

**Shared**
| File | Responsibility |
|---|---|
| `types/event.ts` | Extended types (recurrence, tiers, registration) |
| `utils/recurrence.ts` | Rule parse/format shared by client and server |
| `api/routes/events.ts` | Extended DTOs |

**Frontend — shared components**
| File | Responsibility |
|---|---|
| `components/common/calendar/Calendar.tsx` | Month grid. `mode: 'admin' \| 'public'`. Emits day-click/double-click. |
| `components/common/calendar/EventList.tsx` | Vertical list column, shared by both surfaces |
| `components/common/calendar/CalendarPage.tsx` | Composes grid + list + month/year pickers |

**Frontend — admin**
| File | Responsibility |
|---|---|
| `pages/admin/Events.tsx` | Calendar page (`/admin/events`, `/new`, `/:id`) |
| `pages/admin/events/EventModal.tsx` | Create/edit modal |
| `pages/admin/events/EventSettings.tsx` | `/admin/events/settings` |
| `pages/admin/events/RegistrantsTable.tsx` | Paged, tier-filterable attendee table |

**Frontend — public**
| File | Responsibility |
|---|---|
| `pages/Events.tsx` | Public calendar at the configured URL |
| `pages/EventDetail.tsx` | Detail + registration + ticket selection |

**Integration**
| File | Responsibility |
|---|---|
| `components/admin/blocks/types/EventBlock.tsx` | Block edit panel |
| SSR/mail/cms template runtimes | `{{event()}}` resolver in all three |

---

## 4. Task order

Dependency order. Each task ends green (build + tests) and committed.

1. **Migration + types** — schema, shared types, DTOs.
2. **Recurrence engine** — pure functions, heavy unit tests (DST, month-end, until-date, overrides). *Highest-risk logic; done first and in isolation.*
3. **Repo + service extensions** — CRUD over the new tables.
4. **Routes** — tiers, registration, overrides, settings; conflict-checked events URL.
5. **Settings → General** — Default Timezone + Default Currency.
6. **Sidebar** — Events item; reorder Media/Entities/Mailing Lists.
7. **Calendar components** — grid, list, page shell (shared).
8. **Admin Events page + modal** — full field set, URL-routed create/edit.
9. **Event Settings page** — notification + registration + ticketing toggles, shop dependency check.
10. **Public /events + detail** — read-only calendar, registration form.
11. **Ticketing** — tiers UI, virtual cart lines, checkout hook, issuance, emails.
12. **Registrants/tickets tables** — admin tabs, paging, tier filter.
13. **Content block** — `event` block type + registries (SSR/mail coverage tests will fail until every registry declares an arm).
14. **Template function** — `{{event()}}` in cms/ssr/mail runtimes + help page.
15. **Deploy to surgecms** and verify.

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| DST/timezone errors in recurrence | Pure engine, unit-tested against DST transitions before any UI exists |
| Ticket overselling under concurrency | Inventory decremented in the payment transaction with a row lock, same pattern as shop variants |
| Block-type registries | Adding a `BlockType` fails compile/tests until SSR + mail registries declare an arm — by design |
| Events URL collision | Validated against page slugs + reserved routes on save |
| Scope | Built in dependency order, tree kept green throughout |

---

## 6. Acceptance

- Recurring weekly event renders correct dates across a DST boundary.
- Cancelling one occurrence leaves the rest of the series intact.
- A tampered cart price is rejected at checkout.
- Tickets are issued only after payment; free tickets confirm without checkout.
- `/events` honours a custom configured URL and 404s when the feature is off.
