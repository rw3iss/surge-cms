/**
 * The events feature's data layer for the `event` ENTITY type.
 *
 * Reads event COLUMNS through the generic repo (so admin schema extensions to
 * `events` appear automatically, and the generic filter/search/sort work) and
 * ENRICHES every record into an `EventRecord` (`@sitesurge/types`): the event
 * page URL, the next occurrence of a series, dates formatted in the event's
 * zone, the resolved access rules + badge, and the ticket tiers with live
 * availability for that occurrence. Templates, the Events block, SSR and email
 * all read the same record, so none of them does date maths or sums capacities.
 *
 * VIEWER GATING (the same rule as `access.ts`): a non-staff read returns only
 * `published` events the viewer may SEE — anonymous → view rule `public`;
 * members → `members` too; subscribers → tier rules up to their rank; staff →
 * everything. The rule is applied IN SQL (`viewFloorCondition`), so `total`
 * and pagination stay right. The `email` audience reads as anonymous (an inbox
 * is public). Records themselves are viewer-independent.
 *
 * Virtual filters: `upcoming` (true = not over yet; a series counts while it
 * still repeats) and `access` (the effective view rule: public | members |
 * tier). Sorting by `startsAt` orders by the NEXT occurrence (a weekly series
 * started last year sorts by next week's date).
 *
 * Registered at boot (lib.ts), whatever the feature state — the type itself
 * only exists while the events feature is on.
 */
import {
    describeRecurrence, mapLinkFor, parseRecurrenceRule, renderMarkdown, stripMarkdown, toOccurrenceDate, truncateEventText,
    type CalendarEvent, type EntityQuery, type EntityRecord, type EventAccess, type EventOccurrenceOverride,
    type EventRecord, type EventRecordAccess, type EventRecordTier, type EventsSettings, type EventTicketTier,
} from '@sitesurge/types';
import { config, } from '../../config';
import * as entityManager from '../../entities/entityManager';
import type { EntityDataProvider, ProviderReadOpts, } from '../../entities/dataProviders';
import { registerEntityDataProvider, } from '../../entities/dataProviders';
import { registerVirtualFilter, splitVirtualFilters, type SqlCondition, } from '../../entities/virtualFilters';
import { ValidationError, } from '../../core/errors';
import * as genericRepo from '../../repositories/genericEntity.repo';
import * as repo from '../../repositories/events.repo';
import { viewerLevel, } from '../access/level';
import { tiersById, } from '../postGate';
import { getPublicSettings as getSitePublicSettings, } from '../settings';
import { eventFloors, } from './access';
import { escapeHtml, FALLBACK_TIME_ZONE, formatWhen, validZone, } from './format';
import { expandEvent, } from './occurrences';
import { getSettings, } from './settings';

const DAY_MS = 86_400_000;
/** How many rows a next-occurrence sort scans (the generic repo pages at 200). */
const SORT_SCAN_PAGES = 5;
const SORT_SCAN_PAGE_SIZE = 200;
/** Excerpt length (characters) of the plain-text description. */
export const EVENT_EXCERPT_LENGTH = 200;

type TierInfo = { id: string; name: string; sortOrder: number; };

// ─── Occurrences + labels (pure) ───────────────────────────────────────────

export interface NextOccurrence {
    start: Date;
    end: Date | null;
    /** `YYYY-MM-DD` occurrence key. */
    date: string;
    /** Still ahead or running at `now`. */
    upcoming: boolean;
}

/** When an occurrence is over: its end, else (all-day) the end of its day, else its start. */
function occurrenceEnd(start: Date, end: Date | null, allDay: boolean, date: string,): Date {
    if (end) return end;
    if (allDay) return new Date(new Date(`${date}T00:00:00.000Z`,).getTime() + DAY_MS,);
    return start;
}

type OccurrenceSource = Pick<CalendarEvent, 'id' | 'startsAt' | 'endsAt' | 'allDay' | 'recurrenceRule' | 'recurrenceUntil'>;

/**
 * The occurrence a card should show: the first one that has not ended
 * (cancelled dates skipped); for a finished event, its last occurrence (a
 * one-off: itself). Looks ~13 months ahead.
 */
export function nextOccurrenceOf(event: OccurrenceSource, overrides: EventOccurrenceOverride[], now: Date = new Date(),): NextOccurrence {
    const start = new Date(event.startsAt,);
    const end = event.endsAt ? new Date(event.endsAt,) : null;
    const seriesDate = toOccurrenceDate(start,);
    if (!parseRecurrenceRule(event.recurrenceRule,)) {
        return { start, end, date: seriesDate, upcoming: occurrenceEnd(start, end, event.allDay, seriesDate,).getTime() >= now.getTime(), };
    }
    const occs = expandEvent(
        event as CalendarEvent, overrides,
        { from: new Date(now.getTime() - 7 * DAY_MS,), to: new Date(now.getTime() + 400 * DAY_MS,), },
        { maxPerEvent: 450, },
    );
    const asNext = (o: (typeof occs)[number], upcoming: boolean,): NextOccurrence => ({
        start: new Date(o.startsAt,), end: o.endsAt ? new Date(o.endsAt,) : null, date: o.occurrenceDate, upcoming,
    });
    const open = occs.find((o,) => occurrenceEnd(new Date(o.startsAt,), o.endsAt ? new Date(o.endsAt,) : null, event.allDay, o.occurrenceDate,).getTime() >= now.getTime());
    if (open) return asNext(open, true,);
    if (occs.length) return asNext(occs[occs.length - 1]!, false,);
    // The series has not started inside the window (far future) or is long over.
    return { start, end, date: seriesDate, upcoming: start.getTime() >= now.getTime(), };
}

function zonePart(d: Date, timeZone: string,): string {
    return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short', },).formatToParts(d,).find((p,) => p.type === 'timeZoneName',)?.value ?? '';
}

/**
 * `when` / `dateLabel` / `timeLabel` for one occurrence in `timeZone`. An
 * all-day event's date is its UTC key and is never shifted a day.
 */
export function occurrenceLabels(
    occ: Pick<NextOccurrence, 'start' | 'end'>, allDay: boolean, timeZone: string,
): { when: string; dateLabel: string; timeLabel: string; shortDate: string; startTime: string; } {
    const tz = allDay ? 'UTC' : timeZone;
    const dateOf = (d: Date,) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: tz, },);
    const timeOf = (d: Date,) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz, },);
    const startDate = dateOf(occ.start,);
    // An all-day end is exclusive-ish (midnight after); show the last day it covers.
    const endShown = occ.end && allDay ? new Date(occ.end.getTime() - 1,) : occ.end;
    const endDate = endShown ? dateOf(endShown,) : startDate;
    const multiDay = endDate !== startDate;
    const dateLabel = multiDay ? `${startDate} – ${endDate}` : startDate;
    let timeLabel = 'All day';
    if (!allDay) {
        const zone = zonePart(occ.start, timeZone,);
        const range = occ.end && !multiDay ? `${timeOf(occ.start,)} – ${timeOf(occ.end,)}` : timeOf(occ.start,);
        timeLabel = zone ? `${range} ${zone}` : range;
    }
    const when = formatWhen(
        { startsAt: occ.start.toISOString(), allDay, timezone: timeZone, } as CalendarEvent,
        { timeZone, },
    );
    // Compact forms for cards / strips: "Oct 24" and "7:00 PM EDT" (start only).
    const shortDate = occ.start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz, },);
    const startTime = allDay ? 'All day' : [timeOf(occ.start,), zonePart(occ.start, timeZone,),].filter(Boolean,).join(' ',);
    return { when, dateLabel, timeLabel, shortDate, startTime, };
}

/** "Every week" · "Every 2 weeks" · "Every month" … ('' for a one-off). */
export function recurrenceLabelOf(rule: string | null | undefined, until?: string | null,): string {
    const parsed = parseRecurrenceRule(rule,);
    if (!parsed) return '';
    const words: Record<string, string> = {
        daily: 'Every day', weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month', yearly: 'Every year',
    };
    const base = words[parsed.frequency] ?? describeRecurrence(parsed,);
    if (!until) return base;
    return `${base} until ${new Date(until,).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC', },)}`;
}

// ─── Access ────────────────────────────────────────────────────────────────

function ruleOf(own: string | null | undefined, ownTier: string | null | undefined, globalRule: EventAccess, globalTier: string | null,) {
    return !own || own === 'inherit'
        ? { rule: globalRule, tierId: globalRule === 'tier' ? globalTier : null, }
        : { rule: own as EventAccess, tierId: own === 'tier' ? (ownTier ?? null) : null, };
}

/** The resolved rules + badge of one event (inherit → Settings → Events). */
export function accessOf(
    e: Pick<CalendarEvent, 'viewAccess' | 'viewMinTierId' | 'registerAccess' | 'registerMinTierId'>,
    s: Pick<EventsSettings, 'viewAccess' | 'viewMinTierId' | 'registerAccess' | 'registerMinTierId'>,
    tiers: Map<string, TierInfo>,
): EventRecordAccess {
    const v = ruleOf(e.viewAccess, e.viewMinTierId, s.viewAccess ?? 'public', s.viewMinTierId ?? null,);
    const r = ruleOf(e.registerAccess, e.registerMinTierId, s.registerAccess ?? 'public', s.registerMinTierId ?? null,);
    const viewTierName = v.tierId ? tiers.get(v.tierId,)?.name ?? null : null;
    const registerTierName = r.tierId ? tiers.get(r.tierId,)?.name ?? null : null;
    const tierName = viewTierName ?? registerTierName;
    const badgeLabel = v.rule === 'public' ? 'Public' : v.rule === 'members' ? 'Members' : viewTierName ? `Subscribers (${viewTierName})` : 'Subscribers';
    return { view: v.rule, register: r.rule, viewTierName, registerTierName, tierName, badge: v.rule, badgeLabel, };
}

/**
 * SQL: the event's VIEW floor (a level — public -1, members 0, tier = its
 * rank; an unknown tier counts as members), against the unaliased `events`
 * table. Mirrors `eventFloors(...).view`.
 */
export function viewFloorSql(s: Pick<EventsSettings, 'viewAccess' | 'viewMinTierId'>, params: unknown[],): string {
    params.push(s.viewAccess ?? 'public',);
    const g = params.length;
    params.push(s.viewAccess === 'tier' ? (s.viewMinTierId ?? null) : null,);
    const gt = params.length;
    return `(CASE COALESCE(NULLIF("view_access", 'inherit'), $${g}::text)
        WHEN 'public' THEN -1
        WHEN 'members' THEN 0
        ELSE COALESCE((SELECT sp.sort_order FROM subscription_plans sp
                        WHERE sp.id = (CASE WHEN "view_access" = 'inherit' THEN $${gt}::uuid ELSE "view_min_tier_id" END)), 0)
    END)`;
}

/** SQL condition: events a viewer at `level` may see. */
export function viewFloorCondition(s: Pick<EventsSettings, 'viewAccess' | 'viewMinTierId'>, level: number,): SqlCondition {
    return (params,) => {
        const floor = viewFloorSql(s, params,);
        params.push(level,);
        return `${floor} <= $${params.length}::int`;
    };
}

/** The read level of a provider caller: staff/admin ∞, email/anonymous -1. */
async function levelOf(opts: ProviderReadOpts | undefined,): Promise<number> {
    if (opts?.admin) return Infinity;
    if (opts?.audience === 'email') return -1;
    return viewerLevel(opts?.viewer ?? null,);
}

// ─── Enrichment ────────────────────────────────────────────────────────────

async function siteTimeZone(): Promise<string> {
    try {
        const tz = (await getSitePublicSettings())?.defaults?.timezone;
        if (validZone(tz,)) return tz;
    } catch { /* fall through */ }
    return FALLBACK_TIME_ZONE;
}

function basePathOf(s: Pick<EventsSettings, 'eventsUrl'>,): string {
    return `/${(s.eventsUrl || '/events').replace(/^\/+|\/+$/g, '',)}`;
}

function tierRecord(t: EventTicketTier, sold: number, tiers: Map<string, TierInfo>,): EventRecordTier {
    const remaining = t.quantityAvailable === null || t.quantityAvailable === undefined ? null : Math.max(0, t.quantityAvailable - sold,);
    return {
        id: t.id,
        name: t.name,
        // Escaped here: `description` is a TRUSTED template field (printed
        // without escaping), and a tier blurb is plain text.
        description: t.description ? escapeHtml(t.description,) : null,
        price: t.priceCents / 100,
        priceCents: t.priceCents,
        currency: t.currency || 'USD',
        capacity: t.quantityAvailable ?? null,
        sold,
        remaining,
        soldOut: remaining === 0,
        maxPerOrder: t.maxPerOrder ?? null,
        requiredTierName: t.requiredTierId ? tiers.get(t.requiredTierId,)?.name ?? null : null,
        isFree: t.priceCents === 0,
    };
}

/** Build the `EventRecord` of one event (pure given its loaded parts). */
export function buildEventRecord(input: {
    base: EntityRecord;
    event: CalendarEvent;
    overrides: EventOccurrenceOverride[];
    tiers: EventTicketTier[];
    sold: Record<string, number>;
    settings: EventsSettings;
    tierInfo: Map<string, TierInfo>;
    siteZone: string;
    origin: string;
    now?: Date;
},): EventRecord {
    const { base, event: e, settings: s, } = input;
    const timeZone = validZone(e.timezone,) ? e.timezone : input.siteZone;
    const next = nextOccurrenceOf(e, input.overrides, input.now,);
    const labels = occurrenceLabels(next, e.allDay, timeZone,);
    const path = `${basePathOf(s,)}/${encodeURIComponent(e.slug,)}`;
    const markdown = e.description ?? '';
    const descriptionText = stripMarkdown(markdown,).replace(/\s+/g, ' ',).trim();

    const ticketsEnabled = Boolean(e.ticketingEnabled && s.allowTicketing && input.tiers.length,);
    const tiers = ticketsEnabled ? input.tiers.map((t,) => tierRecord(t, input.sold[t.id] ?? 0, input.tierInfo,),) : [];
    const capped = tiers.length > 0 && tiers.every((t,) => t.capacity !== null);
    const prices = tiers.map((t,) => t.priceCents,);
    const priceFromCents = prices.length ? Math.min(...prices,) : null;
    const registrationEnabled = Boolean(e.registrationEnabled && s.allowRegistration,);
    const access = accessOf(e, s, input.tierInfo,);

    return {
        // Stored columns first (admin-added fields included); derived keys win.
        ...(base as Record<string, unknown>),
        id: e.id,
        slug: e.slug,
        status: e.status,
        title: e.title,
        url: `${input.origin}${path}`,
        path,
        externalUrl: e.url ?? null,
        description: renderMarkdown(markdown,),
        descriptionText,
        descriptionMarkdown: markdown,
        excerpt: truncateEventText(descriptionText, EVENT_EXCERPT_LENGTH,),
        featuredImage: e.featuredImage ?? null,
        startsAt: e.startsAt,
        endsAt: e.endsAt,
        allDay: e.allDay,
        timezone: timeZone,
        nextOccurrence: next.start.toISOString(),
        nextOccurrenceEnd: next.end ? next.end.toISOString() : null,
        occurrenceDate: next.date,
        when: labels.when,
        dateLabel: labels.dateLabel,
        timeLabel: labels.timeLabel,
        shortDate: labels.shortDate,
        startTime: labels.startTime,
        upcoming: next.upcoming,
        recurrence: e.recurrenceRule ?? null,
        recurrenceLabel: recurrenceLabelOf(e.recurrenceRule, e.recurrenceUntil,),
        isRecurring: Boolean(parseRecurrenceRule(e.recurrenceRule,),),
        location: e.location ?? null,
        locationLat: e.locationLat ?? null,
        locationLng: e.locationLng ?? null,
        showMap: Boolean(e.showMap,) && e.locationLat != null && e.locationLng != null,
        mapUrl: mapLinkFor({ location: e.location, lat: e.locationLat, lng: e.locationLng, },),
        ticketsEnabled,
        registrationOpen: e.status === 'published' && next.upcoming && (registrationEnabled || ticketsEnabled),
        registrationEnabled,
        isFree: !prices.some((p,) => p > 0),
        priceFrom: priceFromCents === null ? null : priceFromCents / 100,
        priceFromCents,
        currency: tiers[0]?.currency ?? 'USD',
        capacity: capped ? tiers.reduce((n, t,) => n + (t.capacity ?? 0), 0,) : null,
        remaining: capped ? tiers.reduce((n, t,) => n + (t.remaining ?? 0), 0,) : null,
        soldOut: capped && tiers.every((t,) => t.soldOut),
        access,
        isPublic: access.view === 'public',
        requiresSignIn: access.register !== 'public' || access.view !== 'public',
        requiresTier: access.view === 'tier' || access.register === 'tier',
        tiers,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
    } as EventRecord;
}

/** Enrich generic `event` records into EventRecords (one batch of queries). Order kept. */
export async function enrichEventRecords(records: EntityRecord[], now: Date = new Date(),): Promise<EventRecord[]> {
    if (records.length === 0) return [];
    const ids = records.map((r,) => String(r.id,),);
    const [events, overrides, settings, tierInfo, siteZone,] = await Promise.all([
        repo.findByIds(ids,), repo.findOverridesForEvents(ids,), getSettings(), tiersById(), siteTimeZone(),
    ],);
    const byId = new Map(events.map((e,) => [e.id, e,],),);
    const tiersByEvent = await repo.findTiersForEvents(ids,);
    // Live availability for each event's NEXT occurrence.
    const nexts = new Map<string, NextOccurrence>();
    for (const e of events) nexts.set(e.id, nextOccurrenceOf(e, overrides.get(e.id,) ?? [], now,),);
    const pairs = events
        .filter((e,) => (tiersByEvent.get(e.id,) ?? []).length > 0)
        .map((e,) => ({ eventId: e.id, occurrenceDate: nexts.get(e.id,)!.date, }));
    const sold = await repo.countSoldForOccurrences(pairs,);
    const origin = String(config.frontendUrl ?? '',).replace(/\/+$/, '',);
    const out: EventRecord[] = [];
    for (const base of records) {
        const event = byId.get(String(base.id,),);
        if (!event) continue;
        out.push(buildEventRecord({
            base, event, overrides: overrides.get(event.id,) ?? [], tiers: tiersByEvent.get(event.id,) ?? [],
            sold, settings, tierInfo, siteZone, origin, now,
        },),);
    }
    return out;
}

// ─── Listing ───────────────────────────────────────────────────────────────

const iso = (v: unknown,): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' && v ? v : null);

/** A generic row → the fields the next-occurrence sort needs. */
function occurrenceSourceOf(r: EntityRecord,): OccurrenceSource {
    return {
        id: String(r.id,),
        startsAt: iso(r.startsAt,) ?? new Date(0,).toISOString(),
        endsAt: iso(r.endsAt,),
        allDay: r.allDay === true,
        recurrenceRule: (r.recurrenceRule as string | null) ?? null,
        recurrenceUntil: iso(r.recurrenceUntil,),
    };
}

/**
 * List sorted by the NEXT occurrence: scan the matching rows (by series start,
 * capped), compute each series' next date, sort, then page in memory.
 */
async function listByNextOccurrence(
    t: ReturnType<typeof entityManager.requireType>, q: EntityQuery, conditions: SqlCondition[], now: Date,
): Promise<{ items: EntityRecord[]; total: number; }> {
    const rows: EntityRecord[] = [];
    let total = 0;
    for (let page = 1; page <= SORT_SCAN_PAGES; page++) {
        const res = await genericRepo.list(t, { ...q, sortBy: 'startsAt', sortOrder: 'asc', page, limit: SORT_SCAN_PAGE_SIZE, }, { extraWhere: conditions, },);
        total = res.total;
        rows.push(...res.items,);
        if (rows.length >= total || res.items.length < SORT_SCAN_PAGE_SIZE) break;
    }
    const recurringIds = rows.filter((r,) => parseRecurrenceRule(r.recurrenceRule as string | null,)).map((r,) => String(r.id,));
    const overrides = await repo.findOverridesForEvents(recurringIds,);
    const keyed = rows.map((r,) => {
        const src = occurrenceSourceOf(r,);
        return { r, at: nextOccurrenceOf(src, overrides.get(src.id,) ?? [], now,).start.getTime(), title: String(r.title ?? '',), };
    },);
    keyed.sort((a, b,) => a.at - b.at || a.title.localeCompare(b.title,));
    if (q.sortOrder === 'desc') keyed.reverse();
    const limit = Math.min(200, Math.max(1, q.limit ?? 20,),);
    const page = Math.max(1, q.page ?? 1,);
    return { items: keyed.slice((page - 1) * limit, page * limit,).map((k,) => k.r,), total, };
}

export const eventEntityProvider: EntityDataProvider = {
    async list(q, opts,) {
        const t = entityManager.requireType('event',);
        const [settings, level,] = await Promise.all([getSettings(), levelOf(opts,),],);
        const { query: plain, conditions, } = await splitVirtualFilters('event', q,);
        // Non-staff: published events the viewer may see (in SQL → totals stay right).
        const query: EntityQuery = opts?.admin ? plain : { ...plain, status: 'published', };
        if (level !== Infinity) conditions.push(viewFloorCondition(settings, level,),);
        const now = new Date();
        const res = query.sortBy === 'startsAt'
            ? await listByNextOccurrence(t, query, conditions, now,)
            : await genericRepo.list(t, query, { extraWhere: conditions, },);
        return { items: await enrichEventRecords(res.items, now,) as unknown as EntityRecord[], total: res.total, };
    },
    async getById(id,) {
        const t = entityManager.requireType('event',);
        const rec = await genericRepo.getById(t, id,);
        return rec ? ((await enrichEventRecords([rec,],))[0] as unknown as EntityRecord ?? null) : null;
    },
    async getBySlug(slug,) {
        const t = entityManager.requireType('event',);
        const rec = await genericRepo.getBySlug(t, slug,);
        return rec ? ((await enrichEventRecords([rec,],))[0] as unknown as EntityRecord ?? null) : null;
    },
    async allows(rec, opts,) {
        if (opts?.admin) return true;
        const r = rec as unknown as EventRecord;
        if (r.status !== 'published') return false;
        const level = await levelOf(opts,);
        if (level === Infinity) return true;
        const event = await repo.findById(String(r.id,),);
        if (!event) return false;
        return level >= (await eventFloors(event,)).view;
    },
    async create() {
        throw new ValidationError('Create events on the Events page (Admin → Events).',);
    },
    // update/remove omitted → the generic path (admin-added columns; DELETE cascades).
};

// ─── Virtual filters ───────────────────────────────────────────────────────

/** SQL: the event is not over yet (a series counts while it still repeats). */
export const UPCOMING_SQL = `(COALESCE("ends_at", CASE WHEN "all_day" THEN "starts_at" + INTERVAL '1 day' ELSE "starts_at" END) >= NOW()
    OR ("recurrence_rule" IS NOT NULL AND "recurrence_rule" <> '' AND ("recurrence_until" IS NULL OR "recurrence_until" >= NOW())))`;

function truthyFilterValue(v: unknown,): boolean | null {
    if (v === true || v === 'true' || v === 1 || v === '1' || v === 'yes') return true;
    if (v === false || v === 'false' || v === 0 || v === '0' || v === 'no') return false;
    return null;
}

registerVirtualFilter('event', {
    key: 'upcoming',
    label: 'Upcoming',
    description: 'true = events not over yet (a recurring series counts while it still repeats); false = past events.',
    async options() {
        return [{ label: 'Upcoming', value: 'true', }, { label: 'Past', value: 'false', },];
    },
    async resolve(op, value,) {
        const want = truthyFilterValue(value,);
        if (want === null || (op !== 'eq' && op !== 'ne')) return () => 'FALSE';
        const upcoming = op === 'eq' ? want : !want;
        return () => (upcoming ? UPCOMING_SQL : `NOT ${UPCOMING_SQL}`);
    },
},);

registerVirtualFilter('event', {
    key: 'access',
    label: 'Who can see',
    description: 'The effective view rule (an event set to inherit uses Settings → Events): public, members or tier.',
    async options() {
        return [{ label: 'Public', value: 'public', }, { label: 'Members', value: 'members', }, { label: 'Subscription tier', value: 'tier', },];
    },
    async resolve(op, value,) {
        const allowed = ['public', 'members', 'tier',];
        const list = (Array.isArray(value,) ? value : String(value ?? '',).split(',',)).map((v,) => String(v,).trim().toLowerCase()).filter((v,) => allowed.includes(v,));
        if (!list.length || !['eq', 'ne', 'in',].includes(op,)) return () => 'FALSE';
        const s = await getSettings();
        return (params,) => {
            params.push(s.viewAccess ?? 'public',);
            const g = params.length;
            params.push(op === 'eq' ? [list[0],] : list,);
            const expr = `COALESCE(NULLIF("view_access", 'inherit'), $${g}::text)`;
            return op === 'ne' ? `${expr} <> ALL($${params.length}::text[])` : `${expr} = ANY($${params.length}::text[])`;
        };
    },
},);

registerEntityDataProvider('event', eventEntityProvider,);
