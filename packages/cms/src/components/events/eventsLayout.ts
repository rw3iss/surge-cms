/**
 * Pure web helpers for the Events block + EventCard: layout geometry (grid
 * columns / row paging per breakpoint), the access badge, the tier line, the
 * description excerpt, the card's date/time lines and the editor's "is empty"
 * rule. Settings defaults + normalising live in `@sitesurge/types`
 * (`normalizeEventsBlockSettings`) so web, SSR and email read a block alike.
 * No DOM, no Solid — unit-tested in `eventsLayout.test.ts`.
 */
import type { EventRecord, EventRecordTier, } from '@sitesurge/types';
import { eventTierAvailabilityLabel, normalizeEventsBlockSettings, truncateEventText, } from '@sitesurge/types';
import { validTimeZone, } from '../../utils/eventFormat';

/** An enriched `event` entity record as the card reads it (every key optional — template data and old payloads may lack some). */
export type EventCardRecord = Partial<EventRecord>;
export type EventCardTier = Partial<EventRecordTier> & { name: string; };

// ─── Layout ───────────────────────────────────────────────────────────────

/** Grid columns for the current breakpoint. */
export function eventsGridColumns(columns: number, columnsMobile: number, isMobile: boolean,): number {
    return Math.max(1, Math.round(isMobile ? columnsMobile : columns,) || 1,);
}

/** `grid-template-columns` — equal columns, or columns capped at `itemWidth`. */
export function eventsGridTemplate(columns: number, itemWidth?: string | null,): string {
    return itemWidth ? `repeat(${columns}, minmax(0, ${itemWidth}))` : `repeat(${columns}, minmax(0, 1fr))`;
}

/** Row cards per page for the current breakpoint; never more than there are. */
export function eventsPerPage(itemsPerPage: number, itemsPerPageMobile: number, isMobile: boolean, count: number,): number {
    const n = Math.max(1, Math.round(isMobile ? itemsPerPageMobile : itemsPerPage,) || 1,);
    return Math.max(1, Math.min(n, count || 1,),);
}

// ─── Card content ─────────────────────────────────────────────────────────

/** The access badge: globe "Public", or a lock "Members" / "Subscribers (<tier>)". */
export interface EventAccessBadge {
    kind: 'public' | 'locked';
    label: string;
    /** A public event whose REGISTRATION needs a sign-in. */
    signInToRegister: boolean;
}

export function eventAccessBadge(e: EventCardRecord,): EventAccessBadge {
    const a = e.access;
    const view = a?.badge ?? a?.view ?? (e.isPublic === false ? 'members' : 'public');
    if (view === 'tier') {
        const tier = a?.tierName?.trim();
        return { kind: 'locked', label: a?.badgeLabel || (tier ? `Subscribers (${tier})` : 'Subscribers'), signInToRegister: false, };
    }
    if (view === 'members') return { kind: 'locked', label: a?.badgeLabel || 'Members', signInToRegister: false, };
    const register = a?.register;
    const signInToRegister = e.requiresSignIn === true || register === 'members' || register === 'tier';
    return { kind: 'public', label: a?.badgeLabel || 'Public', signInToRegister, };
}

/** "Sold out" / "N left" / null (unlimited — nothing to say). */
export function tierAvailability(t: EventCardTier,): string | null {
    const soldOut = t.soldOut === true || t.remaining === 0;
    return eventTierAvailabilityLabel({ soldOut, remaining: t.remaining ?? null, },) || null;
}

/** "Free" or "$25.00". */
export function tierPrice(t: EventCardTier,): string {
    const cents = typeof t.priceCents === 'number' ? t.priceCents : typeof t.price === 'number' ? Math.round(t.price * 100,) : 0;
    if (t.isFree || cents <= 0) return 'Free';
    const currency = (t.currency || 'USD').toUpperCase();
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency, },).format(cents / 100,);
    } catch {
        return `$${(cents / 100).toFixed(2,)}`;
    }
}

/** The tier list, only when ticketing is on and there are tiers. */
export function visibleTiers(e: EventCardRecord,): EventCardTier[] {
    if (e.ticketsEnabled === false || !Array.isArray(e.tiers,)) return [];
    return e.tiers.filter((t,): t is EventRecordTier => Boolean(t?.name,),);
}

/** Plain-text description cut at `max` chars on a word boundary (0 = no cut). */
export function eventExcerpt(e: EventCardRecord, max: number,): string {
    const src = e.descriptionText || e.excerpt || stripTags(typeof e.description === 'string' ? e.description : '',);
    return truncateEventText(src, max,);
}

function stripTags(html: string,): string {
    return html.replace(/<[^>]*>/g, ' ',).replace(/&nbsp;/g, ' ',).replace(/&amp;/g, '&',);
}

/** The event page link: the site-relative `path`, else `url`, else `/events/<slug|id>`. */
export function eventRecordHref(e: EventCardRecord,): string {
    if (e.path) return e.path;
    if (e.url) return e.url;
    return `/events/${encodeURIComponent(e.slug || e.id || '',)}`;
}

/**
 * The card's date + time lines in the EVENT's time zone. Prefers the
 * provider's pre-formatted `dateLabel` / `timeLabel` (the next occurrence);
 * else formats `nextOccurrence` / `startsAt`. All-day → "All day".
 */
export function eventDateTime(e: EventCardRecord,): { date: string; time: string; } {
    if (e.dateLabel || e.timeLabel) return { date: e.dateLabel ?? '', time: e.timeLabel ?? '', };
    const iso = e.nextOccurrence || e.startsAt;
    const d = iso ? new Date(iso,) : null;
    if (!d || Number.isNaN(d.getTime(),)) return { date: '', time: '', };
    const dateOpts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', };
    if (e.allDay) return { date: d.toLocaleDateString('en-US', { ...dateOpts, timeZone: 'UTC', },), time: 'All day', };
    const zone = validTimeZone(e.timezone,);
    return {
        date: d.toLocaleDateString('en-US', { ...dateOpts, ...(zone ? { timeZone: zone, } : {}), },),
        time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(zone ? { timeZone: zone, timeZoneName: 'short', } : {}), },),
    };
}

// ─── Editor ───────────────────────────────────────────────────────────────

/**
 * "Click edit to configure" in the editor: only a data-sourced block whose
 * selection is empty. A query (incl. the default upcoming query) always has
 * something to draw; slot / template data resolve elsewhere.
 */
export function eventsBindingIsEmpty(raw: unknown,): boolean {
    const s = normalizeEventsBlockSettings(raw,);
    if (s.source !== 'data') return false;
    const b = s.binding;
    if (b.mode === 'query') return false;
    if (b.mode === 'single') return !b.ref;
    return (b.refs ?? []).filter(Boolean,).length === 0;
}
