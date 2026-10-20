/**
 * The `event` ENTITY record and the `events` CONTENT BLOCK.
 *
 * `EventRecord` is what every surface gets for an event read through the
 * entity system (`cms.entities.list('event')`, `{{event('x')}}`,
 * `{{ for events() as e }}`, the Events block, entity templates): the stored
 * columns PLUS everything a card needs, pre-computed server-side by the events
 * data provider (`services/events/entityProvider.ts`) — formatted dates in the
 * event's time zone, the next occurrence of a series, the access rules, and the
 * ticket tiers with live availability. Templates should never have to do date
 * maths or sum capacities.
 *
 * Records are VIEWER-INDEPENDENT (the same event reads the same for everyone):
 * the viewer only decides WHICH events are returned (an event the viewer may
 * not see is left out), never what a record contains.
 */
import type { SlotBinding, } from '../entities/entityBlock';
import type { MediaRef, } from './content';
import type { EventAccess, EventStatus, } from './event';

/** One ticket type of an event, with live availability for the next occurrence. */
export interface EventRecordTier {
    id: string;
    name: string;
    /** Optional blurb shown under the tier name. */
    description: string | null;
    /** Dollars (major units) — `{{formatCurrency(t.price)}}`. */
    price: number;
    priceCents: number;
    currency: string;
    /** null = unlimited. */
    capacity: number | null;
    /** Tickets already issued for the next occurrence. */
    sold: number;
    /** null = unlimited; never negative. */
    remaining: number | null;
    soldOut: boolean;
    /** Most tickets of this type one buyer may hold per date; null = no cap. */
    maxPerOrder: number | null;
    /** Name of the subscription tier this ticket type requires, else null. */
    requiredTierName: string | null;
    isFree: boolean;
}

/**
 * Who may see / register for an event, resolved against Settings → Events
 * (an event's `inherit` is replaced by the site default here).
 */
export interface EventRecordAccess {
    view: EventAccess;
    register: EventAccess;
    /** Tier named by the view rule (when `view === 'tier'`). */
    viewTierName: string | null;
    /** Tier named by the register rule (when `register === 'tier'`). */
    registerTierName: string | null;
    /** The tier a badge should name — the view tier, else the register tier. */
    tierName: string | null;
    /** Badge kind: `public` (globe) | `members` / `tier` (lock). From the VIEW rule. */
    badge: EventAccess;
    /** Badge text: "Public" · "Members" · "Subscribers (Gold)". */
    badgeLabel: string;
}

/** An event as read through the entity system (see the file header). */
export interface EventRecord {
    id: string;
    slug: string;
    status: EventStatus;
    title: string;
    /** Absolute URL of the event's public page (`<site>/events/<slug>`). */
    url: string;
    /** Site-relative path of the event page (`/events/<slug>`). */
    path: string;
    /** The event's own external link (tickets, venue page…), when set. */
    externalUrl: string | null;
    /** Rendered Markdown description (safe HTML). */
    description: string;
    /** Description as plain text (Markdown stripped). */
    descriptionText: string;
    /** The stored Markdown source. */
    descriptionMarkdown: string;
    /** Plain-text summary (first ~200 chars of the description). */
    excerpt: string;
    featuredImage: string | null;
    featuredMedia?: MediaRef | null;
    /** The series start (ISO). */
    startsAt: string;
    endsAt: string | null;
    allDay: boolean;
    /** IANA zone the times are shown in (the event's, else the site default). */
    timezone: string;
    /** Start of the next occurrence that has not ended (ISO) — the series start for a one-off. */
    nextOccurrence: string;
    /** End of that occurrence (ISO), when the event has an end. */
    nextOccurrenceEnd: string | null;
    /** `YYYY-MM-DD` key of that occurrence (registrations/tickets hang off it). */
    occurrenceDate: string;
    /** "Saturday, October 18, 2026 at 7:00 PM (EDT)" — the next occurrence, in the event zone. */
    when: string;
    /** "Sat, Oct 18, 2026" (the next occurrence's date). */
    dateLabel: string;
    /** "7:00 PM – 9:00 PM EDT"; "All day" for an all-day event. */
    timeLabel: string;
    /** "Oct 24" — the next occurrence's month + day (compact cards). */
    shortDate: string;
    /** "7:00 PM EDT" — its START time only; "All day" for an all-day event. */
    startTime: string;
    /** True when the next occurrence is still ahead or running. */
    upcoming: boolean;
    /** Raw recurrence rule (`weekly`, `monthly:15`…), null = does not repeat. */
    recurrence: string | null;
    /** "Every week" · "Every month on the 15th" … ('' for a one-off). */
    recurrenceLabel: string;
    isRecurring: boolean;
    location: string | null;
    /** Ticketing on (event + Settings → Events) with at least one ticket type. */
    ticketsEnabled: boolean;
    /** Registration or ticketing is on and the event has not ended / been cancelled. */
    registrationOpen: boolean;
    registrationEnabled: boolean;
    /** No paid ticket type (free registration, free tickets, or no tickets at all). */
    isFree: boolean;
    /** Cheapest ticket price in dollars; null without tickets. */
    priceFrom: number | null;
    priceFromCents: number | null;
    currency: string;
    /** Total capacity of the next occurrence (null = unlimited or no tickets). */
    capacity: number | null;
    /** Tickets left for the next occurrence (null = unlimited or no tickets). */
    remaining: number | null;
    /** Every ticket type is capped and none is left. */
    soldOut: boolean;
    access: EventRecordAccess;
    /** Anyone may see the event (view rule `public`). */
    isPublic: boolean;
    /** Registering needs at least an account (register rule is not `public`). */
    requiresSignIn: boolean;
    /** Seeing or registering needs a subscription tier. */
    requiresTier: boolean;
    /** Ticket types with live availability ([] when ticketing is off). */
    tiers: EventRecordTier[];
    createdAt: string;
    updatedAt: string;
    /** Admin-added schema fields ride along under their own keys. */
    [field: string]: unknown;
}

// ─── The `events` content block ─────────────────────────────────────────

/** `grid` = columns · `row` = a horizontal carousel (paging / swipe) · `column` = a stacked list. */
export type EventsBlockLayout = 'grid' | 'row' | 'column';

export type EventsHeadingAlign = 'left' | 'center' | 'right';

/** Which parts of an event card are shown (shared by the block, `{{event()}}` and `{{events()}}`). */
export interface EventCardDisplay {
    showImage: boolean;
    showDate: boolean;
    showTime: boolean;
    showLocation: boolean;
    showDescription: boolean;
    /** Characters of description before it is cut with an ellipsis. */
    descriptionLength: number;
    /** The ticket-type list (price + "N left" when capacities are set). */
    showTickets: boolean;
    /** The floating Public / Members / Subscribers badge (top-right). */
    showAccessBadge: boolean;
    showButton: boolean;
    buttonLabel: string;
}

export interface EventsBlockSettings extends Partial<EventCardDisplay> {
    /**
     * Where the events come from: `data` (default) = `binding`; `slot` = the
     * enclosing template's slot `slotId` (type `event`); `template` = the
     * record(s) the enclosing `event` template is rendering.
     */
    source?: 'data' | 'slot' | 'template';
    /** `source: 'data'`: specific events in order (`list`/`single`) or a live `query`. */
    binding?: SlotBinding;
    /** `source: 'slot'` only. */
    slotId?: string;
    layout?: EventsBlockLayout;
    /** Grid columns (default 3). */
    columns?: number;
    /** Grid columns on mobile (default 1). */
    columnsMobile?: number;
    /** Row: cards visible at once (default 3). */
    itemsPerPage?: number;
    /** Row: cards visible at once on mobile (default 1). */
    itemsPerPageMobile?: number;
    /** CSS length between cards (default 16px). */
    gap?: string;
    /**
     * Optional MAXIMUM card width (CSS length). Unset = cards fill their
     * column / page share. Grid: each column's max width · row: each slide's
     * max width (still `itemsPerPage` per page) · column: the card's max width.
     * Desktop only — on mobile cards always fill.
     */
    itemMaxWidth?: string;
    /** @deprecated read as `itemMaxWidth` (the editor rewrites it on save). */
    itemWidth?: string;
    /** Optional heading above the cards. */
    heading?: string;
    /** Heading alignment (default center). */
    headingAlign?: EventsHeadingAlign;
    /** Text shown when no event matches (empty = render nothing on the site). */
    emptyText?: string;
}

/** The default live query: upcoming events, soonest first, 6 of them. */
export const DEFAULT_EVENTS_BINDING: SlotBinding = {
    mode: 'query',
    query: { filter: { upcoming: true, }, sortBy: 'startsAt', sortOrder: 'asc', limit: 6, },
};

export const DEFAULT_EVENT_CARD_DISPLAY: EventCardDisplay = {
    showImage: true,
    showDate: true,
    showTime: true,
    showLocation: true,
    showDescription: true,
    descriptionLength: 200,
    showTickets: false,
    showAccessBadge: true,
    showButton: true,
    buttonLabel: 'View event',
};

export const DEFAULT_EVENTS_BLOCK_SETTINGS: Required<Pick<EventsBlockSettings,
    'source' | 'binding' | 'layout' | 'columns' | 'columnsMobile' | 'itemsPerPage' | 'itemsPerPageMobile' | 'gap'
>> & EventCardDisplay = {
    source: 'data',
    binding: DEFAULT_EVENTS_BINDING,
    layout: 'grid',
    columns: 3,
    columnsMobile: 1,
    itemsPerPage: 3,
    itemsPerPageMobile: 1,
    gap: '16px',
    ...DEFAULT_EVENT_CARD_DISPLAY,
};

/** Fully-resolved block settings (every knob has a value). */
export type ResolvedEventsBlockSettings = typeof DEFAULT_EVENTS_BLOCK_SETTINGS & Pick<EventsBlockSettings, 'slotId' | 'itemMaxWidth' | 'heading' | 'emptyText'> & { headingAlign: EventsHeadingAlign; };

const LAYOUTS: readonly EventsBlockLayout[] = ['grid', 'row', 'column',];

function posInt(v: unknown, fallback: number, max = 12,): number {
    const n = Math.round(Number(v,),);
    return Number.isFinite(n,) && n >= 1 ? Math.min(max, n,) : fallback;
}

function cssLen(v: unknown,): string | undefined {
    const s = typeof v === 'string' || typeof v === 'number' ? String(v,).trim() : '';
    if (!s || /[;{}<>"'\\]/.test(s,)) return undefined;
    return /^\d+(\.\d+)?$/.test(s,) ? `${s}px` : s;
}

/**
 * Settings of an `events` block — or of a legacy `event` block (`eventId` /
 * `eventSlug` → a one-event `list` binding) — with every default filled in.
 * Shared by the web renderer, the admin editor, SSR and email so all four read
 * a block the same way.
 */
export function normalizeEventsBlockSettings(raw: unknown,): ResolvedEventsBlockSettings {
    const s = (raw && typeof raw === 'object' ? raw : {}) as EventsBlockSettings & { eventId?: unknown; eventSlug?: unknown; };
    const d = DEFAULT_EVENTS_BLOCK_SETTINGS;
    let binding = s.binding;
    if (!binding) {
        const legacy = [s.eventId, s.eventSlug,].map((v,) => (typeof v === 'string' ? v.trim() : '')).find(Boolean,);
        binding = legacy ? { mode: 'list', refs: [legacy,], } : d.binding;
    }
    const bool = (v: unknown, def: boolean,) => (typeof v === 'boolean' ? v : def);
    const source = s.source === 'slot' || s.source === 'template' ? s.source : 'data';
    const descLen = Math.round(Number(s.descriptionLength,),);
    return {
        source,
        binding,
        slotId: typeof s.slotId === 'string' ? s.slotId : undefined,
        layout: LAYOUTS.includes(s.layout as EventsBlockLayout,) ? s.layout as EventsBlockLayout : d.layout,
        columns: posInt(s.columns, d.columns, 6,),
        columnsMobile: posInt(s.columnsMobile, d.columnsMobile, 4,),
        itemsPerPage: posInt(s.itemsPerPage, d.itemsPerPage, 6,),
        itemsPerPageMobile: posInt(s.itemsPerPageMobile, d.itemsPerPageMobile, 4,),
        gap: cssLen(s.gap,) ?? d.gap,
        itemMaxWidth: cssLen(s.itemMaxWidth,) ?? cssLen(s.itemWidth,),
        heading: typeof s.heading === 'string' && s.heading.trim() ? s.heading : undefined,
        headingAlign: s.headingAlign === 'left' || s.headingAlign === 'right' ? s.headingAlign : 'center',
        emptyText: typeof s.emptyText === 'string' && s.emptyText.trim() ? s.emptyText : undefined,
        showImage: bool(s.showImage, d.showImage,),
        showDate: bool(s.showDate, d.showDate,),
        showTime: bool(s.showTime, d.showTime,),
        showLocation: bool(s.showLocation, d.showLocation,),
        showDescription: bool(s.showDescription, d.showDescription,),
        descriptionLength: Number.isFinite(descLen,) && descLen >= 0 ? Math.min(5000, descLen,) : d.descriptionLength,
        showTickets: bool(s.showTickets, d.showTickets,),
        showAccessBadge: bool(s.showAccessBadge, d.showAccessBadge,),
        showButton: bool(s.showButton, d.showButton,),
        buttonLabel: typeof s.buttonLabel === 'string' && s.buttonLabel.trim() ? s.buttonLabel : d.buttonLabel,
    };
}

/** Block types rendered as the Events block (`event` = the legacy name, read as an alias). */
export function isEventsBlockType(type: unknown,): type is 'events' | 'event' {
    return type === 'events' || type === 'event';
}

/**
 * Cut plain text to `max` characters at a word boundary, adding `…`. `0` or a
 * negative max = no cut. Shared so the web card, SSR and email cut alike.
 */
export function truncateEventText(text: string | null | undefined, max: number,): string {
    const t = String(text ?? '',).replace(/\s+/g, ' ',).trim();
    if (!max || max <= 0 || t.length <= max) return t;
    const cut = t.slice(0, max,);
    const space = cut.lastIndexOf(' ',);
    return `${(space > max * 0.6 ? cut.slice(0, space,) : cut).replace(/[\s.,;:!?-]+$/, '',)}…`;
}

/** "3 left" / "Sold out" / '' (unlimited) for a tier. */
export function eventTierAvailabilityLabel(t: Pick<EventRecordTier, 'remaining' | 'soldOut'>,): string {
    if (t.soldOut) return 'Sold out';
    return t.remaining === null || t.remaining === undefined ? '' : `${t.remaining} left`;
}
