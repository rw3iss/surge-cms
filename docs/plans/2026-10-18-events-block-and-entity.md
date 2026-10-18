# Events block + `event` entity type — contract

Status: IN PROGRESS (2026-10-18). Two agents build to this contract (API/shared and UI).

## 1. `event` entity type (core, customizable) — DONE (server)
- Seed a core entity type `event` (`coreDescriptors.ts`, `ownerFeature: 'events'`, table `events`, `singularVar: 'event'`, `pluralVar: 'events'`, `hasSlug`, `hasStatus` (live = `published`), `routing.detailPrefix` = the configured events URL (default `/events`), `adminListRoute: '/admin/events'`, `adminEditRoute: '/admin/events/:id'`), admin-extensible like `product`/`contact` (operators can add fields → columns on `events`; core fields locked).
- An **events data provider** (`services/events/entityProvider.ts`, registered like the shop `product` provider) ENRICHES each record so templates and blocks get everything:
  `title, slug, url (absolute path to the event page), excerpt (plain text), description (rendered Markdown HTML), descriptionText, featuredImage (+ featuredMedia), startsAt, endsAt, allDay, timezone, when (pre-formatted date + time in the event TZ), dateLabel, timeLabel, nextOccurrence (ISO, recurring), recurrence, recurrenceLabel, location, locationUrl/address fields if present, status, isFree, priceFrom (dollars), priceFromCents, ticketsEnabled, registrationOpen, capacity, remaining (null = unlimited), soldOut, access: { view: 'public'|'members'|'tier', register: …, tierName? }, isPublic, requiresSignIn, requiresTier, tiers: [ { id, name, description, price (dollars), priceCents, currency, capacity (null = unlimited), sold, remaining, soldOut, maxPerOrder, requiredTierName, isFree } ]`.
- **Viewer gating:** public/site entity reads of `event` drop events the viewer may not SEE (same rule as `services/events/access.ts` — anonymous sees `public` view only; members see `members`; tier by rank; staff all). Email audience = public-view events only. Counts/pagination stay right (filter in SQL or via the access service's SQL helper).
- Virtual filters for queries: `upcoming` (true = ends/next occurrence ≥ now), `access` (public|members|tier), `tag`/`category` if events have them; sort fields `startsAt` (next occurrence for recurring), `title`, `createdAt`.

## 2. `events` content block (renamed from `event`) — DONE (types, migration, SSR + email); web/admin UI = UI agent
- `BlockType` gains `'events'`; migration (next free number) adds the enum value and converts existing `event` rows to `events` (`settings.eventId` → `settings.binding = { mode: 'list', refs: [eventId] }`). Keep `'event'` readable as an alias (renderers treat it as `events`), but the add-menu shows only **Events**.
- Settings (`EventsBlockSettings` in `@sitesurge/types`):
  `binding: SlotBinding` (Set data — specific events in order, or a live query; default live query `upcoming = true`, sort `startsAt asc`, limit 6) | `source?: 'data' | 'slot' | 'template'` + `slotId` (template slots / template data, type `event`, like Gallery);
  `layout: 'grid' | 'row' | 'column'` (row = horizontal carousel with paging / swipe, reuse the gallery/hero carousel paging helpers), `columns` (grid, default 3; mobile fallback 1), `itemsPerPage` (row, default 3; mobile 1), `gap` (CSS length, default 16px), `itemMaxWidth?` (max card width, desktop only; unset = fill; legacy `itemWidth` read as it); grid columns are capped at the event count so the block alignment can center fewer events;
  display toggles: `showImage`, `showDate`, `showTime`, `showLocation`, `showDescription` + `descriptionLength` (chars, default 200), `showTickets` (tier list with price + remaining when capacities are set), `showAccessBadge`, `showButton` + `buttonLabel` ('View event'), `heading?` + `headingAlign` (left/center/right, default center; SSR + email too), `emptyText?`.
- Rendering on every surface: admin block preview + full preview + site (web `EventCard` grid/row/column) — **UI DONE** (`components/events/EventCard` + `EventCardList`, `components/blocks/types/EventsBlock`, `components/common/PagedRow`; admin `components/admin/blocks/types/EventsBlockEdit`; `config/blockTypes.ts` add-menu "Events", `event` hidden alias; `BLOCK_CONFIGURED` empty only for an empty selection), SSR (indexable card HTML), **email** (grid/column only; row → wrapped grid like gallery; card table markup, button link to the event page, image with Outlook sizes).
- **Access badge** (**UI DONE**, `eventAccessBadge` in `components/events/eventsLayout.ts`): card upper-right floating icon — globe "Public", lock "Members" / "Subscribers (<tier>)"; a public event that requires sign-in to REGISTER shows the public badge plus a "Sign in to register" line.

## 3. Template functions — DONE (shared engine mapping, SSR + mail + cms runtimes, reference data)
- `{{event('id-or-slug')}}` → renders the default event card; with a property reads it (`{{event('x').when}}`); named args mirror the display toggles: `image=`, `date=`, `time=`, `location=`, `description=`, `descriptionLength=`, `tickets=`, `badge=`, `button=`, `buttonLabel=`.
- `{{events(limit?, upcoming=true, sort='startsAt', order='asc', access=, ids='a,b', layout='grid'|'column', columns=)}}` → a list (renders cards in a layout when alone; loopable in `{{ for events(...) as e }}`).
- Web whole-entity render **UI DONE** (`TemplateEntity`: `event` → `EventCard`, `eventList` → `EventCardList`).
- Same semantics in the web, SSR and mail runtimes. Reference data (`services/template/reference.ts`) lists every event property incl. `tiers[]` sub-properties; `/admin/help/variables-and-functions` gets an **Events** section at the bottom (**UI DONE** — `HelpVariables.tsx` `EventsSection`) (properties table, tiers table, function args, examples).

## 4. Seeded entity template "Event Card" — DONE
- One `html` block, list-mode, `listRender: 'each'`, using `{{ if }}` / `{{ for event.tiers as t }}` to render: TITLE (linked) · image · date+time · location · description (truncated, configurable via a CSS var / `truncate(...)`) · tiers list with remaining · View event button · access badge (top-right). Styles inside the block use site CSS variables (`--site-primary`, `--site-text`, `--site-text-muted`, `--site-radius`, `--site-border`, `--site-button-radius`, fonts) with a small, well-commented `<style>` scoped to a class.
- Seeded by an idempotent script `packages/api/scripts/seed-event-card-template.ts` (`npm run seed:event-template`), safe to re-run (by name); run on production after deploy.

## 5. Event page
- **DONE** (`EventSignup` → `AccessRequiredNotice` `signInLabel` + `offerJoin`). A public event whose registration requires sign-in shows "Sign in to register (or create an account)" with the in-page LoginModal; members-only events keep their gate.

---

## Implementation notes (server + shared, 2026-10-18)

**Shared (`@sitesurge/types`)**
- `types/eventsBlock.ts`: `EventRecord`, `EventRecordTier`, `EventRecordAccess`, `EventsBlockSettings`, `EventCardDisplay`,
  `EventsBlockLayout`, `DEFAULT_EVENTS_BINDING`, `DEFAULT_EVENT_CARD_DISPLAY`, `DEFAULT_EVENTS_BLOCK_SETTINGS`,
  `normalizeEventsBlockSettings(raw)` (fills defaults; legacy `eventId`/`eventSlug` → `{ mode: 'list', refs: [..] }`),
  `isEventsBlockType(type)` (`events` | legacy `event`), `truncateEventText(text, max)`, `eventTierAvailabilityLabel(tier)`.
- `BlockType` + `ALL_BLOCK_TYPES` gain `'events'` (`'event'` kept as a never-stored alias).
- `template/eventFunctions.ts`: `eventsCallFor(name, args, named)` → `{ single, binding: SlotBinding }`,
  `eventDisplayFrom(options)` → card toggles + `layout` (`grid`|`column`) / `columns` / `gap`; kinds `EVENT_KIND = 'event'`
  (data = one `EventRecord`) and `EVENT_LIST_KIND = 'eventList'` (data = `EventRecord[]`); display args ride on the ref's `options`.
- `EventTicketTier.description?` (new column, migration 180). `ENTITIES` catalog has `Event` + `EventTier` docs.

**EventRecord field names** — `id, slug, status, title, url` (absolute) `, path` (`/events/<slug>`) `, externalUrl,
description` (rendered Markdown HTML) `, descriptionText, descriptionMarkdown, excerpt, featuredImage, featuredMedia,
startsAt, endsAt, allDay, timezone, nextOccurrence, nextOccurrenceEnd, occurrenceDate, when, dateLabel, timeLabel,
upcoming, recurrence, recurrenceLabel, isRecurring, location, ticketsEnabled, registrationOpen, registrationEnabled,
isFree, priceFrom, priceFromCents, currency, capacity, remaining, soldOut, access { view, register, viewTierName,
registerTierName, tierName, badge, badgeLabel }, isPublic, requiresSignIn, requiresTier, tiers[], createdAt, updatedAt`
(+ any admin-added columns). Tier: `id, name, description` (HTML-escaped) `, price, priceCents, currency, capacity, sold,
remaining, soldOut, maxPerOrder, requiredTierName, isFree`.

**Server**
- `entities/coreDescriptors.ts` `eventDescriptor(detailPrefix)` (seeded at boot when events is on, on feature enable, and
  re-scaffolded when Settings → Events → URL changes); entity-layer caching off (per-viewer lists, live availability).
- `services/events/entityProvider.ts` — provider (registered in `lib.ts`), viewer gating in SQL (`viewFloorCondition`;
  non-staff → `published` only), single reads via the new `EntityDataProvider.allows` hook, virtual filters `upcoming` + `access`,
  `sortBy: 'startsAt'` = next occurrence. `EntityDataProvider.list` opts now carry `viewer` (`ProviderReadOpts`);
  `splitVirtualFilters` moved to `entities/virtualFilters.ts` (shared with providers).
- Card HTML: `services/events/render.ts` (`eventCardsSsrHtml`, `eventCardsEmailHtml`); records for blocks/functions:
  `services/events/serverRender.ts` (`resolveEventFunction`, `resolveEventsBlockRecords`, `EVENTS_RESOLVED_KEY = '__eventRecords'`).
  The mail pre-pass (`expandDynamicBlocks`, also used by SSR) resolves `events`/`event` blocks — `source` data / slot / template.
- Migrations: `179_events_block_type.sql` (core: enum value on `block_type` + `content_block_type`, guarded legacy conversion),
  `180_event_tier_description.sql` (`@feature events`). Tier `description` accepted on `PUT /events/:id/tiers` (omitted = keep).
- Seed: `npm run seed:event-template` (packages/api) — "Event Card" template (`services/events/eventCardTemplate.ts`).
- cms `services/template/runtime.ts`: `event()`/`events()` via `cms.entities.getOne/list('event', …)`; `reference.ts`:
  Events function group + `EVENT_FUNCTION_ARGS` + `EVENT_EXAMPLES` for the help page's Events section.

