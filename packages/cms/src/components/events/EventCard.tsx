/**
 * The default event card — used by the Events content block (grid / row /
 * column) and anywhere an enriched `event` entity record is shown.
 *
 *   title (linked) · image · date + time (event time zone) · location ·
 *   description (plain text, cut at `descriptionLength`) · ticket tiers
 *   (name · price · "N left" / "Sold out" — only when the event sells tickets)
 *   · View event button · access badge floating top-right (globe "Public", or
 *   a lock "Members" / "Subscribers (<tier>)"). A public event whose
 *   registration needs a sign-in adds a "Sign in to register" line.
 *
 * The whole card is one link to the event page (the title link's `::after`
 * covers the card; the button is the same link, kept out of the tab order).
 *
 * Reads the record the events entity provider enriches (`EventCardRecord`);
 * every part has its own display toggle (`EventCardDisplay`). Colours,
 * radius and fonts come from the site tokens.
 */
import { DEFAULT_EVENT_CARD_DISPLAY, type EventCardDisplay, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, For, Show, } from 'solid-js';
import { useAuth, } from '../../stores/auth';
import {
    eventAccessBadge, eventDateTime, eventExcerpt, eventRecordHref, tierAvailability, tierPrice, visibleTiers, type EventCardRecord,
} from './eventsLayout';
import './EventCard.scss';

export interface EventCardProps {
    event: EventCardRecord;
    /** Display toggles; omitted keys use the defaults. */
    display?: Partial<EventCardDisplay>;
    class?: string;
}

const GlobeIcon = () => (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
);

const LockIcon = () => (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
);

const EventCard: Component<EventCardProps> = (props,) => {
    const auth = useAuth();
    const d = (): EventCardDisplay => ({ ...DEFAULT_EVENT_CARD_DISPLAY, ...(props.display ?? {}), });
    const href = () => eventRecordHref(props.event,);
    const image = () => {
        if (!d().showImage) return null;
        return props.event.featuredMedia?.url || props.event.featuredMedia?.path || props.event.featuredImage || null;
    };
    const alt = () => props.event.featuredMedia?.alt || props.event.title || '';
    const when = () => eventDateTime(props.event,);
    const dateLine = () => {
        const w = when();
        const parts = [d().showDate ? w.date : '', d().showTime ? w.time : '',].filter(Boolean,);
        return parts.join(' · ',);
    };
    const excerpt = () => (d().showDescription ? eventExcerpt(props.event, d().descriptionLength,) : '');
    const tiers = () => (d().showTickets ? visibleTiers(props.event,) : []);
    const badge = () => eventAccessBadge(props.event,);
    const signInLine = () => badge().signInToRegister && !auth.user;

    return (
        <article class={`event-card${image() ? ' event-card--with-image' : ''}${props.class ? ` ${props.class}` : ''}`}>
            <Show when={d().showAccessBadge}>
                <span
                    class={`event-card__badge event-card__badge--${badge().kind}`}
                    title={badge().kind === 'public' ? 'Open to everyone' : `${badge().label} only`}
                >
                    {badge().kind === 'public' ? <GlobeIcon /> : <LockIcon />}
                    <span>{badge().label}</span>
                </span>
            </Show>
            <Show when={image()}>
                <div class="event-card__media">
                    <img class="event-card__image" src={image()!} alt={alt()} loading="lazy" />
                </div>
            </Show>
            <div class="event-card__body">
                <h3 class="event-card__title">
                    {/* Its ::after covers the card, so the whole card opens the event. */}
                    <A href={href()} class="event-card__link">{props.event.title || 'Untitled event'}</A>
                </h3>
                <Show when={dateLine()}>
                    <p class="event-card__when">{dateLine()}</p>
                </Show>
                <Show when={d().showDate && props.event.recurrenceLabel}>
                    <p class="event-card__meta">{props.event.recurrenceLabel}</p>
                </Show>
                <Show when={d().showLocation && props.event.location}>
                    <p class="event-card__meta event-card__location">{props.event.location}</p>
                </Show>
                <Show when={excerpt()}>
                    <p class="event-card__excerpt">{excerpt()}</p>
                </Show>
                <Show when={tiers().length > 0}>
                    <ul class="event-card__tiers">
                        <For each={tiers()}>
                            {(t,) => (
                                <li class="event-card__tier" classList={{ 'is-sold-out': tierAvailability(t,) === 'Sold out', }}>
                                    <span class="event-card__tier-name">{t.name}</span>
                                    <span class="event-card__tier-price">{tierPrice(t,)}</span>
                                    <Show when={tierAvailability(t,)}>
                                        <span class="event-card__tier-left">{tierAvailability(t,)}</span>
                                    </Show>
                                </li>
                            )}
                        </For>
                    </ul>
                </Show>
                <Show when={signInLine()}>
                    <p class="event-card__signin">Sign in to register</p>
                </Show>
                <Show when={d().showButton}>
                    <div class="event-card__actions">
                        <A href={href()} class="event-card__button" tabIndex={-1} aria-hidden="true">{d().buttonLabel}</A>
                    </div>
                </Show>
            </div>
        </article>
    );
};

export default EventCard;
