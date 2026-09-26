/**
 * Public event detail — /events/:slugOrId.
 *
 * Registration and ticketing render only when the event opts in AND the module
 * allows it, so turning the master switch off hides the form everywhere without
 * touching individual events.
 */
import type { CalendarEvent, EventTicketTier, } from '@sitesurge/types';
import { describeRecurrence, parseRecurrenceRule, renderMarkdown, stripMarkdown, } from '@sitesurge/types';
import { Title, } from '@solidjs/meta';
import { A, useParams, } from '@solidjs/router';
import { Component, createResource, Show, } from 'solid-js';
import SeoHead from '../components/common/seo/SeoHead';
import EventSignup from '../components/events/EventSignup';
import { cms, } from '../services/cmsClient';
import './EventDetail.scss';

const EventDetailPage: Component = () => {
    const params = useParams<{ slug: string; }>();

    const [event,] = createResource(() => params.slug, async (slug,) => {
        try {
            return await cms.events.getOne(slug,) as CalendarEvent;
        } catch {
            return null;
        }
    },);

    const [tiers, { refetch: refetchTiers, },] = createResource(
        () => event()?.id,
        async (id,) => {
            const e = event();
            if (!e || !e.ticketingEnabled) return [] as EventTicketTier[];
            try {
                return await cms.events.tiers(id, e.startsAt.slice(0, 10,),);
            } catch {
                return [] as EventTicketTier[];
            }
        },
    );

    const when = () => {
        const ev = event();
        if (!ev) return '';
        const d = new Date(ev.startsAt,);
        return ev.allDay ?
            d.toLocaleDateString('en-US', { dateStyle: 'full', },) :
            d.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', },);
    };

    return (
        <div class="event-detail page-wrapper">
            <Show when={!event.loading} fallback={<p class="event-detail__loading">Loading…</p>}>
                <Show
                    when={event()}
                    fallback={
                        <div class="event-detail__missing">
                            <h1>Event not found</h1>
                            <p>This event may have been removed.</p>
                            <A href="/events" class="btn btn--primary">Back to events</A>
                        </div>
                    }
                >
                    {(ev,) => (
                        <>
                            <Title>{ev().title}</Title>
                            <SeoHead
                                title={ev().title}
                                // A meta description is plain text: Markdown
                                // syntax in a search result reads as noise.
                                description={stripMarkdown(ev().description,) ||
                                    `${ev().title} — ${when()}`}
                                image={ev().featuredImage ?? undefined}
                            />

                            <A href="/events" class="event-detail__back">← All events</A>

                            <article class="event-detail__main">
                                <header class="event-detail__head">
                                    <h1>{ev().title}</h1>
                                    <p class="event-detail__when">{when()}</p>
                                    <Show when={ev().location}>
                                        <p class="event-detail__where">{ev().location}</p>
                                    </Show>
                                    <Show when={ev().recurrenceRule}>
                                        <p class="event-detail__repeat">
                                            {describeRecurrence(
                                                parseRecurrenceRule(ev().recurrenceRule,),
                                                ev().recurrenceUntil,
                                            )}
                                        </p>
                                    </Show>
                                </header>

                                <Show when={ev().featuredImage}>
                                    <img class="event-detail__image" src={ev().featuredImage!} alt={ev().title} />
                                </Show>

                                <Show when={ev().description}>
                                    {
                                        /* renderMarkdown escapes before it formats, so its
                                        output is safe to inject as-is. */
                                    }
                                    <div
                                        class="event-detail__body rich-text"
                                        innerHTML={renderMarkdown(ev().description,)}
                                    />
                                </Show>

                                <Show when={ev().url}>
                                    <p>
                                        <a class="btn btn--secondary" href={ev().url!} rel="noopener">
                                            More information
                                        </a>
                                    </p>
                                </Show>
                            </article>

                            <aside class="event-detail__aside">
                                {/* Tickets OR registration — see EventSignup. */}
                                <EventSignup event={ev()} tiers={tiers() ?? []} onClaimed={() => void refetchTiers()} />
                            </aside>
                        </>
                    )}
                </Show>
            </Show>
        </div>
    );
};

export default EventDetailPage;
