/**
 * `{{ event(...) }}` / `{{ events(...) }}` — ONE mapping from a call to what
 * to fetch + how to display it, shared by the site, SSR and email runtimes
 * (each fetches through its own path: the SDK on the site, the entity service
 * on the server) and the same display knobs as the Events block.
 *
 *   {{event('summer-gala')}}                      the default event card
 *   {{event('summer-gala').when}}                 one property (any EventRecord key)
 *   {{event('summer-gala', image=false, tickets=true, buttonLabel='Get tickets')}}
 *   {{events()}}                                  6 upcoming events, soonest first, as a grid
 *   {{events(3, layout='column')}}                the next 3, stacked
 *   {{events(upcoming=false, sort='title', order='asc', limit=12)}}
 *   {{events(access='public')}}                   only events anyone can see
 *   {{events(ids='summer-gala,winter-ball')}}     these events, in this order (ids or slugs)
 *   {{for events(4) as e}} <a href="{{e.url}}">{{e.title}}</a> — {{e.dateLabel}} {{endfor}}
 *
 * Results: `event(...)` → `entityRef(EVENT_KIND, record, ref)`; `events(...)`
 * → `entityRef(EVENT_LIST_KIND, records[])` (loopable: `for` iterates
 * `.data`). The call's named args ride on the ref's `options` (evaluator);
 * `eventDisplayFrom(options)` turns them into card/layout settings.
 */
import type { SlotBinding, } from '../entities/entityBlock';
import type { EntityQuery, } from '../entities/types';
import {
    DEFAULT_EVENT_CARD_DISPLAY, DEFAULT_EVENTS_BLOCK_SETTINGS,
    type EventCardDisplay, type EventsBlockLayout,
} from '../types/eventsBlock';

/** Whole-entity kind of one event (data = EventRecord). */
export const EVENT_KIND = 'event';
/** Whole-entity kind of an event list (data = EventRecord[]). */
export const EVENT_LIST_KIND = 'eventList';
export const EVENT_FUNCTION_NAMES = ['event', 'events',] as const;

/** Default number of events `events()` returns. */
export const DEFAULT_EVENTS_LIMIT = 6;
/** Most events one `events()` call may return. */
export const MAX_EVENTS_LIMIT = 50;

const str = (v: unknown,) => (v === undefined || v === null ? '' : String(v,).trim());
const num = (v: unknown,): number | undefined => {
    const n = Number(v,);
    return Number.isFinite(n,) && str(v,) !== '' ? n : undefined;
};
const bool = (v: unknown,): boolean | undefined => {
    if (v === undefined || v === null || v === '') return undefined;
    if (v === false || v === 'false' || v === 0 || v === '0') return false;
    return v === true || v === 'true' || v === 1 || v === '1' ? true : undefined;
};

const SORTS: Record<string, string> = {
    startsat: 'startsAt', start: 'startsAt', date: 'startsAt', next: 'startsAt',
    title: 'title', name: 'title',
    createdat: 'createdAt', created: 'createdAt', newest: 'createdAt',
};

export interface EventsCall {
    /** `event(ref)` = one record; `events(...)` = a list. */
    single: boolean;
    /** What to read: `single` (one id/slug), `list` (ids/slugs in order) or a live `query`. */
    binding: SlotBinding;
}

/**
 * The call → what to fetch. Null when `name` is neither `event` nor `events`
 * (or `event()` has no reference).
 */
export function eventsCallFor(name: string, args: unknown[], named: Record<string, unknown> = {},): EventsCall | null {
    if (name === 'event') {
        const ref = str(args[0],) || str(named.id ?? named.slug,);
        return ref ? { single: true, binding: { mode: 'single', ref, }, } : null;
    }
    if (name !== 'events') return null;

    let limit: number | undefined;
    for (const a of args) if (num(a,) !== undefined) limit = num(a,);
    if (num(named.limit,) !== undefined) limit = num(named.limit,);
    const cap = Math.max(1, Math.min(MAX_EVENTS_LIMIT, Math.round(limit ?? DEFAULT_EVENTS_LIMIT,),),);

    const ids = str(named.ids ?? named.refs,).split(',',).map((x,) => x.trim()).filter(Boolean,);
    if (ids.length) return { single: false, binding: { mode: 'list', refs: ids.slice(0, cap,), }, };

    const filter: NonNullable<EntityQuery['filter']> = {};
    // Upcoming unless asked otherwise (`upcoming=false` = past ones too).
    if (bool(named.upcoming,) !== false) filter.upcoming = true;
    const access = str(named.access,).toLowerCase();
    if (access === 'public' || access === 'members' || access === 'tier') filter.access = access;
    const query: EntityQuery = {
        filter,
        sortBy: SORTS[str(named.sort,).toLowerCase()] ?? 'startsAt',
        sortOrder: str(named.order ?? named.dir,).toLowerCase() === 'desc' ? 'desc' : 'asc',
        limit: cap,
    };
    if (str(named.search,)) query.search = str(named.search,);
    return { single: false, binding: { mode: 'query', query, }, };
}

export interface EventDisplayOptions extends EventCardDisplay {
    layout: EventsBlockLayout;
    columns: number;
    gap: string;
}

/**
 * Render options of a call (`{{event('x', image=false, tickets=true)}}`,
 * `{{events(layout='column', columns=2)}}`) → card + layout settings, on top
 * of the block defaults. A `row` layout is not offered to templates (no
 * carousel in a template) and reads as `grid`.
 */
export function eventDisplayFrom(options: Record<string, unknown> = {},): EventDisplayOptions {
    const d = DEFAULT_EVENT_CARD_DISPLAY;
    const layout = str(options.layout,) === 'column' ? 'column' : 'grid';
    const cols = num(options.columns,);
    const gap = str(options.gap,);
    const descLen = num(options.descriptionLength ?? options.length,);
    return {
        layout,
        columns: cols !== undefined ? Math.max(1, Math.min(6, Math.round(cols,),),) : DEFAULT_EVENTS_BLOCK_SETTINGS.columns,
        gap: gap && !/[;{}<>"'\\]/.test(gap,) ? (/^\d+(\.\d+)?$/.test(gap,) ? `${gap}px` : gap) : DEFAULT_EVENTS_BLOCK_SETTINGS.gap,
        showImage: bool(options.image ?? options.showImage,) ?? d.showImage,
        showDate: bool(options.date ?? options.showDate,) ?? d.showDate,
        showTime: bool(options.time ?? options.showTime,) ?? d.showTime,
        showLocation: bool(options.location ?? options.showLocation,) ?? d.showLocation,
        showDescription: bool(options.description ?? options.showDescription,) ?? d.showDescription,
        descriptionLength: descLen !== undefined && descLen >= 0 ? Math.round(descLen,) : d.descriptionLength,
        showTickets: bool(options.tickets ?? options.showTickets,) ?? d.showTickets,
        showAccessBadge: bool(options.badge ?? options.showAccessBadge,) ?? d.showAccessBadge,
        showButton: bool(options.button ?? options.showButton,) ?? d.showButton,
        buttonLabel: str(options.buttonLabel,) || d.buttonLabel,
    };
}
