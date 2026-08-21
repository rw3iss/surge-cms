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
import {
    describeRecurrence, formatCurrency, parseRecurrenceRule, renderMarkdown, stripMarkdown,
} from '@sitesurge/types';
import SeoHead from '../components/common/seo/SeoHead';
import { cms, } from '../services/cmsClient';
import './EventDetail.scss';

/**
 * Minor units → display, e.g. 1500 → "$15.00". Free reads as "Free".
 *
 * Delegates to the shared `formatCurrency` (Intl) rather than hand-rolling
 * symbol + toFixed(2): that got zero-decimal currencies wrong (2500 JPY is ¥25,
 * not ¥25.00) and dropped thousands separators. The site's Default Currency
 * picker offers JPY, so both were reachable.
 */
function money(cents: number, currency: string,): string {
    if (cents === 0) return 'Free';
    return formatCurrency(cents, currency,);
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
    /** tierId -> how many the visitor wants. */
    const [qty, setQty,] = createSignal<Record<string, number>>({},);
    const [ticketCodes, setTicketCodes,] = createSignal<Array<{ code: string; tierName: string; }>>([],);
    const [payDue, setPayDue,] = createSignal<{ totalCents: number; currency: string; } | null>(null,);
    const [regError, setRegError,] = createSignal('',);
    const [submitting, setSubmitting,] = createSignal(false,);

    const needs = (field: string,) => event()?.registrationFields?.includes(field,) ?? false;

    const setQ = (tierId: string, n: number,) =>
        setQty((p,) => ({ ...p, [tierId]: Math.max(0, n,), }));

    const selected = () => Object.entries(qty(),).filter(([, n,],) => n > 0);

    /** Display total. The SERVER re-prices from the database at purchase — this
     *  is only what the visitor sees before submitting. */
    const totalCents = () => (tiers() ?? []).reduce(
        (sum, t,) => sum + t.priceCents * (qty()[t.id] ?? 0), 0,
    );

    const buy = async (e: Event,) => {
        e.preventDefault();
        const ev = event();
        if (!ev || submitting()) return;
        if (selected().length === 0) { setRegError('Choose at least one ticket.',); return; }
        setSubmitting(true,); setRegError('',);
        try {
            const res = await cms.events.purchaseTickets({
                email: email().trim(),
                name: name().trim() || undefined,
                phone: phone().trim() || undefined,
                lines: selected().map(([tierId, quantity,],) => ({
                    eventId: ev.id,
                    occurrenceDate: ev.startsAt.slice(0, 10,),
                    tierId,
                    quantity,
                }),),
            },);
            if (res.status === 'confirmed') {
                // Free tickets skip payment entirely — sending someone through a
                // card flow to charge nothing is pure friction.
                setTicketCodes(res.tickets ?? [],);
                setRegistered(true,);
            } else {
                setPayDue({ totalCents: res.totalCents, currency: res.currency, },);
            }
        } catch (err) {
            setRegError(err instanceof Error ? err.message : 'Could not complete the purchase.',);
        } finally {
            setSubmitting(false,);
        }
    };

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
                                // A meta description is plain text: Markdown
                                // syntax in a search result reads as noise.
                                description={stripMarkdown(ev().description,)
                                    || `${ev().title} — ${when()}`}
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
                                    {/* renderMarkdown escapes before it formats, so its
                                        output is safe to inject as-is. */}
                                    <div
                                        class="event-detail__body rich-text"
                                        innerHTML={renderMarkdown(ev().description,)}
                                    />
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
                                                                    {t.remaining === 0 ? 'Sold out' : `${t.remaining} left`}
                                                                </span>
                                                            </Show>
                                                        </div>
                                                        <span class="event-detail__tier-price">
                                                            {money(t.priceCents, t.currency,)}
                                                        </span>
                                                        <input
                                                            class="event-detail__tier-qty"
                                                            type="number" min="0"
                                                            max={t.remaining ?? undefined}
                                                            disabled={t.remaining === 0}
                                                            value={qty()[t.id] ?? 0}
                                                            onInput={(e,) => setQ(t.id, Number(e.currentTarget.value,) || 0,)}
                                                            aria-label={`Quantity for ${t.name}`}
                                                        />
                                                    </li>
                                                )}
                                            </For>
                                        </ul>

                                        <Show when={selected().length > 0}>
                                            <p class="event-detail__total">
                                                Total: <strong>{money(totalCents(), (tiers() ?? [])[0]?.currency ?? 'USD',)}</strong>
                                            </p>
                                        </Show>

                                        <Show
                                            when={!registered()}
                                            fallback={
                                                <div class="event-detail__ok">
                                                    <p>Your tickets are confirmed.</p>
                                                    <ul class="event-detail__codes">
                                                        <For each={ticketCodes()}>
                                                            {(t,) => <li><strong>{t.tierName}</strong> <code>{t.code}</code></li>}
                                                        </For>
                                                    </ul>
                                                    <p>We've emailed these to you.</p>
                                                </div>
                                            }
                                        >
                                            <form onSubmit={buy} class="event-detail__form">
                                                <label>
                                                    <span>Name</span>
                                                    <input type="text" value={name()} onInput={(e,) => setName(e.currentTarget.value,)} />
                                                </label>
                                                <label>
                                                    <span>Email</span>
                                                    <input type="email" value={email()} onInput={(e,) => setEmail(e.currentTarget.value,)} required />
                                                </label>
                                                <Show when={payDue()}>
                                                    <p class="event-detail__paynote">
                                                        {money(payDue()!.totalCents, payDue()!.currency,)} due.
                                                        Card payment is handled at checkout — this build confirms the
                                                        order and reserves nothing until payment completes.
                                                    </p>
                                                </Show>
                                                <Show when={regError()}>
                                                    <p class="event-detail__error">{regError()}</p>
                                                </Show>
                                                <button type="submit" class="btn btn--primary" disabled={submitting()}>
                                                    {submitting() ? 'Working…'
                                                        : totalCents() > 0 ? 'Get tickets' : 'Claim free tickets'}
                                                </button>
                                            </form>
                                        </Show>
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
