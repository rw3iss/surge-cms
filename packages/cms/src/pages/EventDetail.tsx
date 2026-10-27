import { featuredImagePath, } from '@sitesurge/types';
/**
 * Public event detail — /events/:slugOrId.
 *
 * Registration and ticketing render only when the event opts in AND the module
 * allows it, so turning the master switch off hides the form everywhere without
 * touching individual events.
 */
import NotFoundPage from './NotFound';
import type { CalendarEvent, EventTicketTier, } from '@sitesurge/types';
import { describeRecurrence, parseRecurrenceRule, renderMarkdown, stripMarkdown, } from '@sitesurge/types';
import { Title, } from '@solidjs/meta';
import { A, useParams, useSearchParams, } from '@solidjs/router';
import { Component, createMemo, createResource, lazy, Show, } from 'solid-js';
import UpgradeTout from '../components/content/UpgradeTout';
import { useAuth, } from '../stores/auth';
import { accessErrorOf, tierRequirement, upgradeHref, type AccessRequired, } from '../utils/accessRequired';
import SeoHead from '../components/common/seo/SeoHead';
import EventSignup from '../components/events/EventSignup';
import CommentsSection from '../components/discussions/CommentsSection';
import { isFeatureEnabled, } from '../stores/siteSettings';
import { cms, } from '../services/cmsClient';
import { formatEventWhen, } from '../utils/eventFormat';
import './EventDetail.scss';
import { eventLocationText, mapLinkFor, } from '@sitesurge/types';
const LocationMap = lazy(() => import('../components/map/LocationMap'),);

const EventDetailPage: Component = () => {
    const params = useParams<{ slug: string; }>();
    const [search, setSearch,] = useSearchParams<{ date?: string; }>();
    const auth = useAuth();

    /**
     * Keyed on the signed-in user too: the event's access (and a members-only
     * event itself) depends on who is looking, so signing in re-reads it and
     * the gate / sign-up card update in place.
     */
    const [loaded, { refetch: refetchEvent, },] = createResource(
        () => ({ slug: params.slug, user: auth.user?.id ?? '', }),
        async ({ slug, },): Promise<{ event: CalendarEvent | null; gate: AccessRequired | null; }> => {
            try {
                return { event: await cms.events.getOne(slug,) as CalendarEvent, gate: null, };
            } catch (err) {
                return { event: null, gate: accessErrorOf(err,), };
            }
        },
    );
    const event = () => loaded()?.event ?? null;
    const gate = () => loaded()?.gate ?? null;

    /**
     * The upcoming dates of a recurring series (cancelled ones already dropped
     * by the server), so a visitor signs up for the date they picked — not the
     * series' first date, which for a weekly event is usually long past.
     */
    const [upcoming,] = createResource(
        () => (event()?.recurrenceRule ? event()!.id : null),
        async (id,) => {
            const from = new Date(Date.now() - 86_400_000,);
            const to = new Date(Date.now() + 180 * 86_400_000,);
            try {
                const occ = await cms.events.calendar({ from: from.toISOString(), to: to.toISOString(), },);
                return occ.filter((o,) => o.event.id === id && new Date(o.endsAt ?? o.startsAt,).getTime() >= Date.now(),);
            } catch {
                return [];
            }
        },
    );

    /** `YYYY-MM-DD` (UTC — the occurrence key) of a start instant. */
    const keyOf = (iso: string | Date,) => (iso instanceof Date ? iso.toISOString() : String(iso,)).slice(0, 10,);

    /** The occurrence being viewed: `?date=` when it is a real upcoming date,
     *  else the next upcoming one, else the event's own date. */
    const occurrenceDate = createMemo(() => {
        const ev = event();
        if (!ev) return '';
        const list = upcoming() ?? [];
        if (search.date && (list.some((o,) => o.occurrenceDate === search.date,) || !ev.recurrenceRule)) {
            return search.date;
        }
        return list[0]?.occurrenceDate ?? keyOf(ev.startsAt,);
    },);

    const [tiers, { refetch: refetchTiers, },] = createResource(
        () => (event() && occurrenceDate() ? `${event()!.id}|${occurrenceDate()}|${auth.user?.id ?? ''}` : null),
        async () => {
            const e = event();
            if (!e || !e.ticketingEnabled) return [] as EventTicketTier[];
            try {
                return await cms.events.tiers(e.id, occurrenceDate(),);
            } catch {
                return [] as EventTicketTier[];
            }
        },
    );

    /** The chosen occurrence's start: the series' UTC time of day on that date. */
    const occurrenceStart = () => {
        const ev = event();
        if (!ev) return null;
        const start = new Date(ev.startsAt,);
        const date = occurrenceDate();
        if (!date || date === keyOf(ev.startsAt,)) return start;
        const d = new Date(`${date}T${start.toISOString().slice(11,)}`,);
        return Number.isNaN(d.getTime(),) ? start : d;
    };

    /** Shown in the EVENT's time zone (a 7 pm ET event reads 7 pm everywhere). */
    const formatOccurrence = (d: Date, allDay: boolean, tz?: string | null,) => formatEventWhen(d, allDay, tz,);

    const when = () => {
        const ev = event();
        const d = occurrenceStart();
        if (!ev || !d) return '';
        return formatOccurrence(d, ev.allDay, ev.timezone,);
    };

    /** Date choices for the sign-up card (recurring series only). */
    const dateChoices = () => {
        const ev = event();
        if (!ev?.recurrenceRule) return [];
        return (upcoming() ?? []).map((o,) => ({
            date: o.occurrenceDate,
            label: formatOccurrence(new Date(o.startsAt,), ev.allDay, ev.timezone,),
        }));
    };

    return (
        <div class="event-detail page-wrapper">
            <Show when={loaded() || !loaded.loading} fallback={<p class="event-detail__loading">Loading…</p>}>
                <Show
                    when={event()}
                    fallback={
                        <Show
                            when={gate()}
                            fallback={
                                <NotFoundPage title="Event not found" message="This event doesn't exist, or it is no longer listed." link={{ href: "/events", label: "Browse events", }} />
                            }
                        >
                            {(g,) => (
                                <>
                                    <Title>Members-only event</Title>
                                    <A href="/events" class="event-detail__back">← All events</A>
                                    <UpgradeTout
                                        class="event-detail__gate"
                                        title={g().reason === 'signin' ? 'Sign in to see this event' : `Requires ${tierRequirement(g().requiredTier,)}`}
                                        message={g().message || (g().reason === 'signin'
                                            ? 'This event is for signed-in members.'
                                            : `This event requires ${tierRequirement(g().requiredTier,)}.`)}
                                        requiredTier={g().requiredTier}
                                        upgradeHref={upgradeHref(g().requiredTier, true,)}
                                        onLoggedIn={() => void refetchEvent()}
                                    />
                                </>
                            )}
                        </Show>
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
                                image={featuredImagePath(ev()) ?? undefined}
                            />

                            <A href="/events" class="event-detail__back">← All events</A>

                            <article class="event-detail__main">
                                <header class="event-detail__head">
                                    <h1>{ev().title}</h1>
                                    <p class="event-detail__when">{when()}</p>
                                    <Show when={eventLocationText(ev(),)}>
                                        <p class="event-detail__where">
                                            {/* The label ("Set text") when set; the link still goes to the location. */}
                                            <span>{eventLocationText(ev(),)}</span>
                                            <Show when={mapLinkFor({ location: ev().location, lat: ev().locationLat, lng: ev().locationLng, },)}>
                                                {(href,) => (
                                                    <a class="event-detail__map-link" href={href()} target="_blank" rel="noopener noreferrer">View map →</a>
                                                )}
                                            </Show>
                                        </p>
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

                                <Show when={featuredImagePath(ev())}>
                                    <img class="event-detail__image" src={featuredImagePath(ev())} alt={ev().title} />
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

                                <Show when={isFeatureEnabled('comments',)}>
                                    <CommentsSection targetType="event" targetId={ev().id} />
                                </Show>
                            </article>

                            <aside class="event-detail__aside">
                                {/* The location map (when the event shows one): one link to Google Maps. */}
                                <Show when={ev().showMap && ev().locationLat != null && ev().locationLng != null}>
                                    <LocationMap
                                        class="event-detail__map"
                                        lat={ev().locationLat}
                                        lng={ev().locationLng}
                                        height="200px"
                                        label={`Map: ${eventLocationText(ev(),) ?? ev().title}`}
                                        onClick={() => {
                                            const href = mapLinkFor({ location: ev().location, lat: ev().locationLat, lng: ev().locationLng, },);
                                            if (href) window.open(href, '_blank', 'noopener',);
                                        }}
                                    />
                                </Show>
                                {/* Tickets OR registration — see EventSignup. */}
                                <EventSignup
                                    event={ev()}
                                    tiers={tiers() ?? []}
                                    occurrenceDate={occurrenceDate()}
                                    occurrenceLabel={when()}
                                    dateChoices={dateChoices()}
                                    onDateChange={(date,) => setSearch({ date, },)}
                                    onClaimed={() => void refetchTiers()}
                                    onAccessChanged={() => { void refetchEvent(); void refetchTiers(); }}
                                />
                            </aside>
                        </>
                    )}
                </Show>
            </Show>
        </div>
    );
};

export default EventDetailPage;
