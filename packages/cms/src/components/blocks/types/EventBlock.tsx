/**
 * Embedded event — a teaser card (`EventCard`) linking to the event page.
 *
 * Settings: `eventId` (id or slug; `eventSlug` is the cached fallback),
 * `heading`, `showImage` / `showDescription` / `showLocation` (default on).
 * A recurring series shows its NEXT upcoming date. An event the viewer may
 * not see (members-only / tier) shows a small notice linking to the event
 * page, which carries the sign-in / upgrade prompt.
 */
import type { Block, CalendarEvent, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createResource, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { useAuth, } from '../../../stores/auth';
import { accessErrorOf, type AccessRequired, } from '../../../utils/accessRequired';
import EventCard, { eventHref, } from '../../events/EventCard';

interface EventBlockSettings {
    eventId?: string;
    eventSlug?: string;
    eventTitle?: string;
    heading?: string;
    showImage?: boolean;
    showDescription?: boolean;
    showLocation?: boolean;
}

/** How far ahead to look for a recurring series' next date. */
const LOOKAHEAD_DAYS = 180;

export const EventBlock: Component<{ block: Block; preview?: boolean; }> = (props,) => {
    const auth = useAuth();
    const s = () => (props.block.settings ?? {}) as EventBlockSettings;
    const ref = () => s().eventId || s().eventSlug || '';

    // Keyed on the viewer: a members-only event appears once they sign in.
    const [loaded,] = createResource(
        () => (ref() ? { ref: ref(), user: auth.user?.id ?? '', } : null),
        async ({ ref: r, },): Promise<{ event: CalendarEvent | null; gate: AccessRequired | null; }> => {
            try {
                return { event: await cms.events.getOne(r,), gate: null, };
            } catch (err) {
                return { event: null, gate: accessErrorOf(err,), };
            }
        },
    );
    const event = () => loaded()?.event ?? null;

    const [next,] = createResource(
        () => (event()?.recurrenceRule ? event()!.id : null),
        async (id,) => {
            const from = new Date();
            const to = new Date(Date.now() + LOOKAHEAD_DAYS * 86_400_000,);
            try {
                const occ = await cms.events.calendar({ from: from.toISOString(), to: to.toISOString(), },);
                return occ
                    .filter((o,) => o.event.id === id && new Date(o.endsAt ?? o.startsAt,).getTime() >= Date.now(),)
                    .sort((a, b,) => a.startsAt.localeCompare(b.startsAt,),)[0] ?? null;
            } catch {
                return null;
            }
        },
    );

    return (
        <Show
            when={event()}
            fallback={
                <Show
                    when={loaded()?.gate}
                    fallback={
                        <Show when={props.preview && !loaded.loading}>
                            <p class="block-message">
                                {ref() ? 'This event could not be loaded (deleted or not published).' : 'No event selected.'}
                            </p>
                        </Show>
                    }
                >
                    <p class="block-message">
                        {s().eventTitle ? `“${s().eventTitle}” is a members-only event. ` : 'This is a members-only event. '}
                        <A href={eventHref({ id: s().eventId ?? '', slug: s().eventSlug ?? '', },)}>See details</A>
                    </p>
                </Show>
            }
        >
            {(ev,) => (
                <EventCard
                    event={ev()}
                    occurrence={next() ?? null}
                    heading={s().heading}
                    showImage={s().showImage}
                    showDescription={s().showDescription}
                    showLocation={s().showLocation}
                />
            )}
        </Show>
    );
};
