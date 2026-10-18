/**
 * Public ticket page — /tickets/:code.
 *
 * The page a ticket code links to (sign-up card, confirmation email, admin
 * attendee list): the event, the attendee, and every ticket on the same
 * registration with its tier, price and — when paid — the shop order that
 * paid for it. The code is the credential; the server masks the attendee's
 * contact details for anyone but the attendee or staff. Meant as the base
 * for a later "proof of registration" (QR code, check-in).
 */
import NotFoundPage from './NotFound';
import type { EventTicketView, } from '@sitesurge/types';
import { formatCurrency, } from '@sitesurge/types';
import { Title, } from '@solidjs/meta';
import { A, useParams, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../services/cmsClient';
import './EventTicket.scss';

const STATUS_LABEL: Record<EventTicketView['status'], string> = {
    valid: 'Valid',
    checked_in: 'Checked in',
    refunded: 'Refunded',
    cancelled: 'Cancelled',
};

function money(cents: number, currency: string,): string {
    return cents === 0 ? 'Free' : formatCurrency(cents, currency,);
}

const EventTicketPage: Component = () => {
    const params = useParams<{ code: string; }>();

    const [ticket, { mutate, },] = createResource(() => params.code, async (code,) => {
        try {
            return await cms.events.ticket(code,);
        } catch {
            return null;
        }
    },);

    const when = (t: EventTicketView,) => {
        // The occurrence date is the one this ticket is for (a recurring
        // event's startsAt is the FIRST date). Occurrence keys are UTC dates,
        // so the time is the series' UTC time of day on that date, shown in
        // the event's own time zone.
        const start = new Date(t.event.startsAt,);
        const day = new Date(`${t.occurrenceDate}T${start.toISOString().slice(11,)}`,);
        const at = Number.isNaN(day.getTime(),) ? start : day;
        const zone = (() => {
            if (!t.event.timezone) return undefined;
            try { new Intl.DateTimeFormat('en-US', { timeZone: t.event.timezone, },); return t.event.timezone; } catch { return undefined; }
        })();
        return t.event.allDay ?
            at.toLocaleDateString('en-US', { dateStyle: 'full', timeZone: 'UTC', },) :
            at.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', ...(zone ? { timeZone: zone, timeZoneName: 'short', } : {}), },);
    };

    // Staff at the door: check the ticket in (or undo a mistaken check-in).
    const [checking, setChecking,] = createSignal(false,);
    const [checkError, setCheckError,] = createSignal('',);
    const setCheckIn = async (t: EventTicketView, checkedIn: boolean,) => {
        setChecking(true,);
        setCheckError('',);
        try {
            const r = await cms.events.checkIn(t.code, checkedIn,);
            mutate({
                ...t,
                status: r.status as EventTicketView['status'],
                checkedInAt: r.checkedInAt,
                tickets: t.tickets.map((x,) => (x.code === t.code ? { ...x, status: r.status as EventTicketView['status'], } : x)),
            },);
        } catch (err) {
            setCheckError(err instanceof Error ? err.message : 'Could not update the check-in.',);
        } finally {
            setChecking(false,);
        }
    };

    /** Tickets grouped by how they were obtained: free, or per order. */
    const groups = (t: EventTicketView,) => {
        const out = new Map<string, EventTicketView['tickets']>();
        for (const tk of t.tickets) {
            const key = tk.orderNumber ?? '';
            out.set(key, [...(out.get(key,) ?? []), tk,],);
        }
        return [...out.entries(),].map(([order, items,],) => ({ order, items, }));
    };

    return (
        <div class="event-ticket page-wrapper">
            <Show when={!ticket.loading} fallback={<p>Loading…</p>}>
                <Show
                    when={ticket()}
                    fallback={
                        <NotFoundPage title="Ticket not found" message="Check the ticket code from your email — this one doesn't match a ticket." link={{ href: "/events", label: "Browse events", }} />
                    }
                >
                    {(t,) => (
                        <>
                            <Title>{`Ticket ${t().code} — ${t().event.title}`}</Title>

                            <section class="event-ticket__card">
                                <header class="event-ticket__head">
                                    <div>
                                        <p class="event-ticket__eyebrow">{t().tierName}</p>
                                        <h1>
                                            <A href={`/events/${t().event.slug}`}>{t().event.title}</A>
                                        </h1>
                                        <p class="event-ticket__when">{when(t(),)}</p>
                                        <Show when={t().event.location}>
                                            <p class="event-ticket__where">{t().event.location}</p>
                                        </Show>
                                    </div>
                                    <div class="event-ticket__code">
                                        <span class="event-ticket__code-label">Ticket</span>
                                        <code>{t().code}</code>
                                        <span class={`event-ticket__status event-ticket__status--${t().status}`}>
                                            {STATUS_LABEL[t().status]}
                                        </span>
                                        <Show when={t().checkedInAt}>
                                            <span class="event-ticket__checked-at">
                                                {new Date(t().checkedInAt!,).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', },)}
                                            </span>
                                        </Show>
                                        <Show when={t().canCheckIn && (t().status === 'valid' || t().status === 'checked_in')}>
                                            <button
                                                type="button"
                                                class="btn btn--secondary event-ticket__checkin"
                                                disabled={checking()}
                                                onClick={() => void setCheckIn(t(), t().status === 'valid',)}
                                            >
                                                {checking() ? 'Saving…' : t().status === 'valid' ? 'Check in' : 'Undo check-in'}
                                            </button>
                                        </Show>
                                        <Show when={checkError()}>
                                            <span class="event-ticket__checkin-error" role="alert">{checkError()}</span>
                                        </Show>
                                    </div>
                                </header>

                                <div class="event-ticket__section">
                                    <h2>Attendee</h2>
                                    <dl class="event-ticket__details">
                                        <Show when={t().attendee.name}>
                                            <dt>Name</dt>
                                            <dd>{t().attendee.name}</dd>
                                        </Show>
                                        <dt>Email</dt>
                                        <dd>{t().attendee.email}</dd>
                                        <Show when={t().attendee.phone}>
                                            <dt>Phone</dt>
                                            <dd>{t().attendee.phone}</dd>
                                        </Show>
                                        <dt>Registered</dt>
                                        <dd>
                                            {new Date(t().registeredAt,).toLocaleString('en-US', {
                                                dateStyle: 'medium',
                                                timeStyle: 'short',
                                            },)}
                                        </dd>
                                    </dl>
                                </div>

                                <div class="event-ticket__section">
                                    <h2>{t().tickets.length === 1 ? 'Ticket' : `Tickets (${t().tickets.length})`}</h2>
                                    <For each={groups(t(),)}>
                                        {(g,) => (
                                            <div class="event-ticket__group">
                                                <p class="event-ticket__group-title">
                                                    {g.order ? `Paid — order ${g.order}` : 'Registration'}
                                                </p>
                                                <table class="event-ticket__table">
                                                    <thead>
                                                        <tr>
                                                            <th>Type</th>
                                                            <th>Code</th>
                                                            <th>Status</th>
                                                            <th class="num">Price</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        <For each={g.items}>
                                                            {(tk,) => (
                                                                <tr classList={{ 'is-current': tk.code === t().code, }}>
                                                                    <td>{tk.tierName}</td>
                                                                    <td>
                                                                        <A href={`/tickets/${tk.code}`}>
                                                                            <code>{tk.code}</code>
                                                                        </A>
                                                                    </td>
                                                                    <td>{STATUS_LABEL[tk.status]}</td>
                                                                    <td class="num">
                                                                        {money(tk.priceCents, tk.currency,)}
                                                                    </td>
                                                                </tr>
                                                            )}
                                                        </For>
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </For>
                                    <p class="event-ticket__total">
                                        Total <strong>{money(t().totalCents, t().currency,)}</strong>
                                    </p>
                                </div>

                                <Show when={!t().isOwner}>
                                    <p class="event-ticket__note">
                                        Some details are hidden. Sign in as the attendee to see them in full.
                                    </p>
                                </Show>
                            </section>
                        </>
                    )}
                </Show>
            </Show>
        </div>
    );
};

export default EventTicketPage;
