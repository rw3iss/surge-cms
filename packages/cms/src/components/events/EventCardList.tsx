/**
 * A list of event cards in a layout — `grid` (columns; `columnsMobile` at
 * ≤768px), `column` (stacked) or `row` (horizontal carousel: arrows, dots,
 * swipe via `PagedRow`; `itemsPerPageMobile` at ≤768px). Presentational: the
 * Events block and `{{events(...)}}` (TemplateEntity) both pass records in.
 */
import type { EventCardDisplay, EventsBlockLayout, } from '@sitesurge/types';
import { Component, For, Match, Switch, } from 'solid-js';
import { PagedRow, } from '../common/PagedRow';
import { useIsMobile, } from '../gallery/useIsMobile';
import EventCard from './EventCard';
import { eventsGridColumns, eventsGridTemplate, eventsPerPage, type EventCardRecord, } from './eventsLayout';
import './EventCardList.scss';

export interface EventCardListProps {
    events: EventCardRecord[];
    layout: EventsBlockLayout;
    display: Partial<EventCardDisplay>;
    columns?: number;
    columnsMobile?: number;
    itemsPerPage?: number;
    itemsPerPageMobile?: number;
    gap?: string;
    /** Max card width (desktop); unset = cards fill. */
    itemMaxWidth?: string | null;
}

const EventCardList: Component<EventCardListProps> = (props,) => {
    let root: HTMLDivElement | undefined;
    const isMobile = useIsMobile(() => root,);
    const columns = () => eventsGridColumns(props.columns ?? 3, props.columnsMobile ?? 1, isMobile(), props.events.length,);
    const perPage = () => eventsPerPage(props.itemsPerPage ?? 3, props.itemsPerPageMobile ?? 1, isMobile(), props.events.length,);
    // Mobile always fills; the max width is a desktop cap.
    const maxWidth = () => (isMobile() ? null : props.itemMaxWidth || null);
    const card = (e: EventCardRecord,) => <EventCard event={e} display={props.display} />;

    return (
        <div ref={root} class={`event-card-list event-card-list--${props.layout}`} style={{ '--events-gap': props.gap || '16px', }}>
            <Switch>
                <Match when={props.layout === 'row'}>
                    <PagedRow items={props.events} perPage={perPage()} gap={props.gap} itemMaxWidth={maxWidth()}>
                        {(e,) => card(e,)}
                    </PagedRow>
                </Match>
                <Match when={props.layout === 'column'}>
                    <div class="event-card-list__column" style={maxWidth() ? { '--events-item-max-width': maxWidth()!, } : undefined}>
                        <For each={props.events}>{(e,) => card(e,)}</For>
                    </div>
                </Match>
                <Match when={true}>
                    <div class="event-card-list__grid" style={{ 'grid-template-columns': eventsGridTemplate(columns(), maxWidth(),), }}>
                        <For each={props.events}>{(e,) => card(e,)}</For>
                    </div>
                </Match>
            </Switch>
        </div>
    );
};

export default EventCardList;
