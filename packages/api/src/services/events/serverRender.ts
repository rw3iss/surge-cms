/**
 * Server side of `{{event(...)}}` / `{{events(...)}}` and the Events block —
 * record resolution for the two backend renderers (SSR + email).
 *
 *   `resolveEventFunction` — the template functions, for
 *     `template/backendRuntime.ts`. Both audiences read as the ANONYMOUS
 *     visitor (public-view events only): a crawler and an inbox are public.
 *   `resolveEventsBlockRecords` — an Events block's own binding (specific
 *     events or a live query). Slot / template-data sources are resolved by
 *     the mail pre-pass (`mail/expandBlocks.ts`), which knows the enclosing
 *     template. The synchronous block emitters read the records from
 *     `settings[EVENTS_RESOLVED_KEY]`.
 *
 * Reads go through the generic entity service (the events data provider),
 * so records are full `EventRecord`s. Never throws: the feature off (no
 * `event` type), a bad query → no records.
 */
import {
    entityRef, EVENT_KIND, EVENT_LIST_KIND, eventsCallFor, normalizeEventsBlockSettings, UNRESOLVED,
    type EventRecord,
} from '@sitesurge/types';
import type { AsyncMemo, } from '../template/backendRuntime';
import { MAX_BINDING_RECORDS, resolveBindingRecords, } from '../templateSlots';

export type ServerEventsAudience = 'site' | 'email';

/** Settings key the pre-pass stashes an Events block's resolved records under. */
export const EVENTS_RESOLVED_KEY = '__eventRecords';

/** Resolve `event(...)` / `events(...)`, or UNRESOLVED when `name` is neither. */
export async function resolveEventFunction(
    name: string, args: unknown[], named: Record<string, unknown> | undefined, memo: AsyncMemo, audience: ServerEventsAudience,
): Promise<unknown> {
    if (name !== 'event' && name !== 'events') return UNRESOLVED;
    const call = eventsCallFor(name, args, named ?? {},);
    if (!call) return entityRef(EVENT_KIND, null,);
    const readOpts = audience === 'email' ? { audience: 'email' as const, } : {};
    const records = await memo(
        `events:${audience}:${JSON.stringify(call.binding,)}`,
        () => resolveBindingRecords('event', call.binding, MAX_BINDING_RECORDS, readOpts,),
    );
    if (call.single) {
        const ref = call.binding.mode === 'single' ? call.binding.ref : undefined;
        return entityRef(EVENT_KIND, (records[0] ?? null) as Record<string, unknown> | null, ref,);
    }
    return entityRef(EVENT_LIST_KIND, records as unknown as Record<string, unknown>,);
}

/** An Events block's records from its own binding (`source: 'data'`), for this audience. */
export async function resolveEventsBlockRecords(settings: unknown, audience: ServerEventsAudience,): Promise<EventRecord[]> {
    const s = normalizeEventsBlockSettings(settings,);
    if (s.source !== 'data') return [];
    const readOpts = audience === 'email' ? { audience: 'email' as const, } : {};
    return (await resolveBindingRecords('event', s.binding, MAX_BINDING_RECORDS, readOpts,)) as unknown as EventRecord[];
}

/** The stashed records on a block's settings. */
export function resolvedEventsOf(settings: Record<string, unknown> | null | undefined,): EventRecord[] {
    const v = settings?.[EVENTS_RESOLVED_KEY];
    return Array.isArray(v,) ? (v as EventRecord[]) : [];
}
