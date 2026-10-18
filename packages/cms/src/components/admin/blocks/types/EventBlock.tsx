/**
 * Edit form for the `event` block: pick an event, optional heading, and which
 * parts of the card to show. The block stores the id plus a cached title/slug
 * (the slug is the renderer's fallback; the title labels the panel and the
 * members-only notice).
 */
import { Component, } from 'solid-js';
import { cms, } from '@/services/cmsClient';
import EntitySearchSelect, { type EntitySearchItem, } from '../../common/EntitySearchSelect';
import Toggle from '../../common/Toggle';
import { FormField, } from '../../forms';
import { CommitInput, } from '../../forms/CommitInput';

interface EventBlockEditProps {
    data: Record<string, any>;
    onUpdate: (data: Record<string, any>,) => void;
}

/** Every event the editor may pick (staff see drafts too), newest first. */
async function fetchEvents(): Promise<EntitySearchItem[]> {
    const res = await cms.events.list({ limit: 500, sort: 'desc', },);
    return (res.data ?? []).map((e,) => ({
        id: e.id,
        title: e.title,
        slug: e.slug,
        status: e.status,
    }));
}

const EventBlockEdit: Component<EventBlockEditProps> = (props,) => {
    const set = (patch: Record<string, unknown>,) => props.onUpdate({ ...props.data, ...patch, },);
    const on = (key: string,) => props.data[key] !== false;

    return (
        <div class="block-event">
            <div class="form-group">
                <EntitySearchSelect
                    label="Event"
                    placeholder="Search events by name..."
                    selectedTitle={props.data.eventTitle}
                    selectedId={props.data.eventId}
                    fetchItems={fetchEvents}
                    onSelect={(ev,) => set({ eventId: ev.id, eventTitle: ev.title, eventSlug: ev.slug, },)}
                    onClear={() => {
                        const { eventId: _i, eventTitle: _t, eventSlug: _s, ...rest } = props.data;
                        props.onUpdate(rest,);
                    }}
                    emptyMessage="No events found"
                />
            </div>
            <FormField label="Heading" hint="Optional title above the card.">
                <CommitInput value={props.data.heading} onCommit={(v,) => set({ heading: v, },)} placeholder="e.g. Next event" />
            </FormField>
            <Toggle checked={on('showImage',)} onChange={(v,) => set({ showImage: v, },)} label="Show image" />
            <Toggle checked={on('showDescription',)} onChange={(v,) => set({ showDescription: v, },)} label="Show description" />
            <Toggle checked={on('showLocation',)} onChange={(v,) => set({ showLocation: v, },)} label="Show location" />
            <p class="form-help-muted">A repeating event shows its next upcoming date. Members-only events show a sign-in notice to visitors who cannot see them.</p>
        </div>
    );
};

export default EventBlockEdit;
