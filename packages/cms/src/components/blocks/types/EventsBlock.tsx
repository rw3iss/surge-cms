/**
 * Events block (`events`; legacy `event` is an alias) — a list of event
 * cards (`EventCard`) laid out as a grid, a column, or a row (horizontal
 * carousel with arrows / dots / swipe, `PagedRow`).
 *
 * Data, like the Gallery block:
 *   source 'data'      `binding` — specific events in order, or a live query
 *                      (default: the next 6 upcoming, soonest first), read
 *                      through `resolveRecords` on entity type `event`;
 *   source 'slot'      the enclosing template's slot (type `event`);
 *   source 'template'  the event record(s) the enclosing `event` template is
 *                      rendering (`templateDataFor`).
 * Records are read for THIS viewer (the server drops events they may not see),
 * keyed on the binding + user only, so layout edits never refetch.
 *
 * Mobile (≤768px, `useIsMobile`): grid → `columnsMobile` (1), row →
 * `itemsPerPageMobile` (1). Settings via `normalizeEventsBlockSettings`.
 * Nothing resolved → `emptyText` on the site (if set), a placeholder in the
 * admin preview.
 */
import type { Block, EntityRecord, SlotBinding, TemplateDataLookup, } from '@sitesurge/types';
import { normalizeEventsBlockSettings, slotFor, templateDataFor, } from '@sitesurge/types';
import { Component, createResource, Show, } from 'solid-js';
import { resolveRecords, } from '../../../services/entityBinding';
import { useUser, } from '../../../stores/auth';
import EventCardList from '../../events/EventCardList';
import type { EventCardRecord, } from '../../events/eventsLayout';
import { isAdminView, SlotPlaceholder, slotRecordsFor, TemplateDataPlaceholder, useSlotContext, } from '../slotContext';
import './EventsBlock.scss';

type Resolved = { ok: true; records: EntityRecord[]; } | { ok: false; reason: 'missing' | 'unfilled' | 'incompatible'; };

export const EventsBlock: Component<{ block: Block; preview?: boolean; }> = (props,) => {
    const user = useUser();
    const display = () => normalizeEventsBlockSettings(props.block.settings,);
    const source = () => display().source;
    const slotCtx = useSlotContext();

    const templateData = (): TemplateDataLookup | null =>
        source() === 'template' ? templateDataFor(slotCtx()?.templateData, 'event',) : null;

    // The key is a primitive (JSON) of just what decides the records.
    const [resolved,] = createResource(
        () => {
            const viewer = user.user?.id ?? 'anon';
            if (source() === 'template') return null; // read synchronously below
            if (source() === 'slot') {
                const slotId = display().slotId;
                const found = slotFor(slotCtx(), slotId, 'event',);
                return JSON.stringify(['slot', slotId ?? null, found.ok ? found.binding : null, found.ok ? null : found.reason, viewer,],);
            }
            return JSON.stringify(['data', display().binding, viewer,],);
        },
        async (key: string,): Promise<Resolved> => {
            const parsed = JSON.parse(key,) as [string, ...unknown[],];
            if (parsed[0] === 'slot') {
                const slotId = (parsed[1] as string | null) ?? undefined;
                return slotRecordsFor(slotCtx(), slotId, 'event',);
            }
            const binding = parsed[1] as SlotBinding;
            return { ok: true, records: await resolveRecords('event', binding, null, undefined,), };
        },
    );

    const records = (): EventCardRecord[] => {
        if (source() === 'template') {
            const t = templateData();
            return t?.ok ? (t.records as EventCardRecord[]) : [];
        }
        const r = resolved();
        return r?.ok ? (r.records as EventCardRecord[]).filter((e,) => e && (e.id || e.title),) : [];
    };
    const loading = () => source() !== 'template' && resolved.loading;
    const failedSlot = () => {
        const r = resolved();
        return source() === 'slot' && r && !r.ok ? r : null;
    };
    const failedTemplate = () => {
        const t = templateData();
        return t && !t.ok ? t : null;
    };

    return (
        <div class={`events-block events-block--${display().layout}`}>
            <Show when={display().heading}>
                <h2 class="events-block__heading">{display().heading}</h2>
            </Show>
            <Show when={failedSlot()}>
                {(r,) => <SlotPlaceholder slotId={display().slotId} reason={r().reason} />}
            </Show>
            <Show when={failedTemplate()}>
                {(t,) => <TemplateDataPlaceholder label="Events" lookup={t()} />}
            </Show>
            <Show
                when={records().length > 0}
                fallback={
                    <Show when={!loading() && !failedSlot() && !failedTemplate()}>
                        <Show
                            when={display().emptyText}
                            fallback={
                                <Show when={props.preview || isAdminView()}>
                                    <p class="block-message">No events to show — check the block's data (Set data…) or publish an event.</p>
                                </Show>
                            }
                        >
                            <p class="events-block__empty">{display().emptyText}</p>
                        </Show>
                    </Show>
                }
            >
                <EventCardList
                    events={records()}
                    layout={display().layout}
                    display={display()}
                    columns={display().columns}
                    columnsMobile={display().columnsMobile}
                    itemsPerPage={display().itemsPerPage}
                    itemsPerPageMobile={display().itemsPerPageMobile}
                    gap={display().gap}
                    itemWidth={display().itemWidth}
                />
            </Show>
        </div>
    );
};
