/**
 * Public event detail — /events/:slugOrId.
 *
 * Registration and ticketing render only when the event opts in AND the module
 * allows it, so turning the master switch off hides the form everywhere without
 * touching individual events.
 */
import { Title, } from '@solidjs/meta';
import { A, useParams, } from '@solidjs/router';
import { Component, For, Show, createResource, createSignal, } from 'solid-js';
import type { CalendarEvent, EventTicketTier, } from '@sitesurge/types';
import { currencySymbol, describeRecurrence, parseRecurrenceRule, } from '@sitesurge/types';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import './EventDetail.scss';

/** Minor units → display, e.g. 1500 → "$15.00". Free reads as "Free". */
function money(cents: number, currency: string,): string {
    if (cents === 0) return 'Free';
    return `${currencySymbol(currency,)}${(cents / 100).toFixed(2,)}`;
}

const EventDetailPage: Component = () => {
    const params = useParams<{ slug: string; }>();

    const [event] = createResource(() => params.slug, async (slug,) => {
        try { return await cms.events.getOne(slug,) as CalendarEvent; }
        catch { return null; }
    },);

    const [tiers] = createResource(
        () => event()?.id,
        async (id,) => {
            const e = event();
            if (!e || !e.ticketingEnabled) return [] as EventTicketTier[];
            try {
                return await cms.events.tiers(id, e.startsAt.slice(0, 10,),);
            } catch { return [] as EventTicketTier[]; }
        },
    );

    const [email, setEmail,] = createSignal('',);
    const [name, setName,] = createSignal('',);
    const [phone, setPhone,] = createSignal('',);
    const [registered, setRegistered,] = createSignal(false,);
    const [regError, setRegError,] = createSignal('',);
    const [submitting, setSubmitting,] = createSignal(false,);

    const needs = (field: string,) => event()?.registrationFields?.includes(field,) ?? false;

    const register = async (e: Event,) => {
        e.preventDefault();
        const ev = event();
        if (!ev || submitting()) return;
        setSubmitting(true,); setRegError('',);
        try {
            await cms.events.register(ev.id, {
                email: email().trim(),
                name: name().trim() || undefined,
                phone: phone().trim() || undefined,
            },);
            setRegistered(true,);
        } catch (err) {
            setRegError(err instanceof Error ? err.message : 'Could not complete your registration.',);
        } finally {
            setSubmitting(false,);
        }
    };

    const when = () => {
        const ev = event();
        if (!ev) return '';
        const d = new Date(ev.startsAt,);
        return ev.allDay
            ? d.toLocaleDateString('en-US', { dateStyle: 'full', },)
            : d.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', },);
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
                                description={ev().description ?? `${ev().title} — ${when()}`}
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
                                    <div class="event-detail__body">{ev().description}</div>
                                </Show>

                                <Show when={ev().url}>
                                    <p><a class="btn btn--secondary" href={ev().url!} rel="noopener">More information</a></p>
                                </Show>
                            </article>

                            <aside class="event-detail__aside">
                                {/* Tickets */}
                                <Show when={ev().ticketingEnabled && (tiers() ?? []).length > 0}>
                                    <section class="event-detail__card">
                                        <h2>Tickets</h2>
                                        <ul class="event-detail__tiers">
                                            <For each={tiers() ?? []}>
                                                {(t,) => (
                                                    <li class="event-detail__tier">
                                                        <div>
                                                            <span class="event-detail__tier-name">{t.name}</span>
                                                            <Show when={t.remaining !== null && t.remaining !== undefined}>
                                                                <span class="event-detail__tier-left">
                                                                    {t.remaining} left
                                                                </span>
                                                            </Show>
                                                        </div>
                                                        <span class="event-detail__tier-price">
                                                            {money(t.priceCents, t.currency,)}
                                                        </span>
                                                    </li>
                                                )}
                                            </For>
                                        </ul>
                                    </section>
                                </Show>

                                {/* Registration */}
                                <Show when={ev().registrationEnabled}>
                                    <section class="event-detail__card">
                                        <h2>Register</h2>
                                        <Show when={ev().showRegistrantCount && ev().metadata?.registrantCount}>
                                            <p class="event-detail__count">
                                                {String(ev().metadata.registrantCount,)} people have registered so far.
                                            </p>
                                        </Show>

                                        <Show
                                            when={!registered()}
                                            fallback={
                                                <p class="event-detail__ok">
                                                    You're registered. We've sent the details to your email.
                                                </p>
                                            }
                                        >
                                            <form onSubmit={register} class="event-detail__form">
                                                <Show when={needs('name',)}>
                                                    <label>
                                                        <span>Name</span>
                                                        <input type="text" value={name()} onInput={(e,) => setName(e.currentTarget.value,)} required />
                                                    </label>
                                                </Show>
                                                <label>
                                                    <span>Email</span>
                                                    <input type="email" value={email()} onInput={(e,) => setEmail(e.currentTarget.value,)} required />
                                                </label>
                                                <Show when={needs('phone',)}>
                                                    <label>
                                                        <span>Phone</span>
                                                        <input type="tel" value={phone()} onInput={(e,) => setPhone(e.currentTarget.value,)} />
                                                    </label>
                                                </Show>
                                                <Show when={regError()}>
                                                    <p class="event-detail__error">{regError()}</p>
                                                </Show>
                                                <button type="submit" class="btn btn--primary" disabled={submitting()}>
                                                    {submitting() ? 'Registering…' : 'Register'}
                                                </button>
                                            </form>
                                        </Show>
                                    </section>
                                </Show>
                            </aside>
                        </>
                    )}
                </Show>
            </Show>
        </div>
    );
};

export default EventDetailPage;
