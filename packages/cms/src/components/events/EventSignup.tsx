/**
 * An event's sign-up card: tickets OR registration, never both.
 *
 * An event that sells tickets shows ONLY the ticket form — a ticket buyer is
 * an attendee, and a second "Register" card beside it offered two ways to do
 * one thing. An event with registration but no tickets shows the register
 * form. Both collect the same attendee details through `AttendeeDetails`.
 *
 * For a signed-in visitor, every detail the site already knows (their name,
 * account email, and — with the Contacts module — phone) shows as a label
 * instead of an input, and is submitted on their behalf. The server records a
 * signed-in attendee under their own account email regardless of what the
 * client sends. A signed-out visitor gets inputs and a "Log in" link that
 * opens the login modal in place; signing in there turns the inputs into
 * labels without leaving the page.
 *
 * Tickets that cost money go into the SHOP CART — one line per tier — and are
 * paid at the ordinary checkout; they are issued when that payment succeeds.
 * An all-free selection skips the cart entirely and is claimed straight
 * through `cms.events.purchaseTickets`, which registers the attendee and
 * issues the codes (reducing what is left) in one call.
 */
import type { CalendarEvent, EventRegistrationField, EventTicketTier, } from '@sitesurge/types';
import { formatCurrency, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { Component, createMemo, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { useAuth, } from '../../stores/auth';
import { addToCart, ticketLineKey, } from '../../stores/shopCart';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import LoginModal from '../auth/LoginModal';
import { useToast, } from '../common/toast/Toast';
import './EventSignup.scss';

/** Minor units → display; zero reads as "Free". */
function money(cents: number, currency: string,): string {
    return cents === 0 ? 'Free' : formatCurrency(cents, currency,);
}

/** Field → label and input type, in the order they are asked. */
const FIELD_META: Record<EventRegistrationField, { label: string; type: string; }> = {
    name: { label: 'Name', type: 'text', },
    email: { label: 'Email', type: 'email', },
    phone: { label: 'Phone', type: 'tel', },
    organization: { label: 'Organization', type: 'text', },
    notes: { label: 'Notes', type: 'textarea', },
};
const FIELD_ORDER: EventRegistrationField[] = ['name', 'email', 'phone', 'organization', 'notes',];

export interface EventSignupProps {
    event: CalendarEvent;
    tiers: EventTicketTier[];
    /** Tickets were issued — the host re-reads what is left. */
    onClaimed?: () => void;
}

const EventSignup: Component<EventSignupProps> = (props,) => {
    const auth = useAuth();
    const toast = useToast();

    /** Tickets win when both are on and any tier exists. */
    const mode = (): 'tickets' | 'register' | null => {
        if (props.event.ticketingEnabled && props.tiers.length > 0) return 'tickets';
        if (props.event.registrationEnabled) return 'register';
        return null;
    };

    // ── What we already know about a signed-in visitor ──
    const [contact,] = createResource(
        () => (auth.user && isFeatureEnabled('contacts',) ? auth.user.id : null),
        async () => {
            try {
                return (await cms.contacts.mine()).contact;
            } catch {
                return null;
            }
        },
    );
    const known = createMemo((): Partial<Record<EventRegistrationField, string>> => {
        const u = auth.user;
        if (!u) return {};
        const full = [u.firstName, u.lastName,].filter(Boolean,).join(' ',).trim();
        const c = contact();
        return {
            name: full || u.displayName || undefined,
            email: u.email,
            phone: c?.mobilePhone || c?.primaryPhone || undefined,
        };
    },);

    /**
     * The details to collect: email always (a registration is keyed on it),
     * plus whatever the event asks for. A ticket buyer is always asked for a
     * name too — tickets are issued to a person.
     */
    const fields = (): EventRegistrationField[] => {
        const asked = new Set<EventRegistrationField>(
            (props.event.registrationFields ?? ['name', 'email',]) as EventRegistrationField[],
        );
        asked.add('email',);
        if (mode() === 'tickets') asked.add('name',);
        return FIELD_ORDER.filter(f => asked.has(f,));
    };

    const [values, setValues,] = createSignal<Partial<Record<EventRegistrationField, string>>>({},);
    const setValue = (f: EventRegistrationField, v: string,) => setValues(p => ({ ...p, [f]: v, }));
    /** Known value for a signed-in visitor, else what they typed. */
    const valueOf = (f: EventRegistrationField,) => (known()[f] ?? values()[f] ?? '').trim();

    // ── Tickets ──
    const [qty, setQty,] = createSignal<Record<string, number>>({},);
    const setQ = (tierId: string, n: number,) => setQty(p => ({ ...p, [tierId]: Math.max(0, n,), }));
    const selected = () => Object.entries(qty(),).filter(([, n,],) => n > 0);
    /** Display only — the server re-prices from the database. */
    const totalCents = () => props.tiers.reduce((sum, t,) => sum + t.priceCents * (qty()[t.id] ?? 0), 0,);
    const currency = () => props.tiers[0]?.currency ?? 'USD';

    // ── Submission ──
    const [done, setDone,] = createSignal(false,);
    const [ticketCodes, setTicketCodes,] = createSignal<Array<{ code: string; tierName: string; }>>([],);
    /** Tickets just put in the cart (count), shown in place of the form. */
    const [inCart, setInCart,] = createSignal(0,);
    const [error, setError,] = createSignal('',);
    const [submitting, setSubmitting,] = createSignal(false,);
    const [loginOpen, setLoginOpen,] = createSignal(false,);

    const occurrenceDate = () => props.event.startsAt.slice(0, 10,);
    /** Organization / notes travel in `fields`; name, email and phone have columns. */
    const extraFields = () => {
        const out: Record<string, string> = {};
        for (const f of ['organization', 'notes',] as const) {
            if (fields().includes(f,) && valueOf(f,)) out[f] = valueOf(f,);
        }
        return Object.keys(out,).length ? out : undefined;
    };
    const identity = () => ({
        email: valueOf('email',),
        name: valueOf('name',) || undefined,
        phone: valueOf('phone',) || undefined,
        fields: extraFields(),
    });

    const submit = async (e: Event,) => {
        e.preventDefault();
        if (submitting()) return;
        setError('',);
        if (mode() === 'tickets' && selected().length === 0) {
            setError('Choose at least one ticket.',);
            return;
        }
        setSubmitting(true,);
        try {
            if (mode() === 'tickets' && totalCents() > 0) {
                addTicketsToCart();
            } else if (mode() === 'tickets') {
                const res = await cms.events.purchaseTickets({
                    ...identity(),
                    lines: selected().map(([tierId, quantity,],) => ({
                        eventId: props.event.id,
                        occurrenceDate: occurrenceDate(),
                        tierId,
                        quantity,
                    })),
                },);
                if (res.status === 'confirmed') {
                    setTicketCodes(res.tickets ?? [],);
                    setDone(true,);
                    props.onClaimed?.();
                } else {
                    // The server priced it above zero (a tier changed since
                    // the page loaded) — take the paid route instead.
                    addTicketsToCart();
                }
            } else {
                await cms.events.register(props.event.id, { ...identity(), occurrenceDate: occurrenceDate(), },);
                setDone(true,);
            }
        } catch (err) {
            setError(
                err instanceof Error ?
                    err.message :
                    mode() === 'tickets' ?
                    'Could not complete the purchase.' :
                    'Could not complete your registration.',
            );
        } finally {
            setSubmitting(false,);
        }
    };

    /**
     * Put the selection in the shop cart, one line per tier. Price and
     * availability are only a snapshot here: checkout re-prices every line
     * from the event and refuses one that has sold out since.
     */
    const addTicketsToCart = () => {
        if (!isFeatureEnabled('shop',)) {
            throw new Error('Paid tickets are not available on this site yet.',);
        }
        const who = identity();
        let count = 0;
        for (const [tierId, quantity,] of selected()) {
            const tier = props.tiers.find((t,) => t.id === tierId);
            if (!tier) continue;
            addToCart({
                kind: 'event_ticket',
                variantId: ticketLineKey(props.event.id, occurrenceDate(), tierId,),
                productId: '',
                slug: props.event.slug,
                title: props.event.title,
                variantTitle: `${tier.name} · ${occurrenceDate()}`,
                priceCents: tier.priceCents,
                image: props.event.featuredImage ?? null,
                qty: quantity,
                eventId: props.event.id,
                occurrenceDate: occurrenceDate(),
                tierId,
                attendee: { email: who.email, name: who.name, phone: who.phone, fields: who.fields, },
            },);
            count += quantity;
        }
        setQty({},);
        setInCart(count,);
        toast.success(`${count} ${count === 1 ? 'ticket' : 'tickets'} added to your cart`,);
    };

    const buttonText = () => {
        if (submitting()) return mode() === 'tickets' ? 'Working…' : 'Registering…';
        if (mode() === 'tickets') return totalCents() > 0 ? 'Add tickets to cart' : 'Claim free tickets';
        return 'Register';
    };

    return (
        <Show when={mode()}>
            <section class="event-detail__card event-signup">
                <h2>{mode() === 'tickets' ? 'Tickets' : 'Register'}</h2>

                <Show when={props.event.showRegistrantCount && props.event.metadata?.registrantCount}>
                    <p class="event-detail__count">
                        {String(props.event.metadata.registrantCount,)} people have registered so far.
                    </p>
                </Show>

                <Show when={mode() === 'tickets'}>
                    <ul class="event-detail__tiers">
                        <For each={props.tiers}>
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
                                    <span class="event-detail__tier-price">{money(t.priceCents, t.currency,)}</span>
                                    <input
                                        class="event-detail__tier-qty"
                                        type="number"
                                        min="0"
                                        max={t.remaining ?? undefined}
                                        disabled={done() || t.remaining === 0}
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
                            Total: <strong>{money(totalCents(), currency(),)}</strong>
                        </p>
                    </Show>
                </Show>

                <Show when={inCart() > 0 && !done()}>
                    <div class="event-detail__ok event-signup__cart">
                        <p>
                            {inCart()} {inCart() === 1 ? 'ticket was' : 'tickets were'}{' '}
                            added to your cart. Complete checkout to confirm them — they are issued and emailed once
                            payment goes through.
                        </p>
                        <div class="event-signup__cart-actions">
                            <A href="/shop/cart" class="btn btn--primary">Go to cart</A>
                            <button type="button" class="event-signup__login-link" onClick={() => setInCart(0,)}>
                                Add more tickets
                            </button>
                        </div>
                    </div>
                </Show>

                <Show
                    when={!done() && inCart() === 0}
                    fallback={
                        <Show when={done()}>
                            <div class="event-detail__ok">
                                <Show
                                    when={mode() === 'tickets'}
                                    fallback={<p>You're registered. We've sent the details to your email.</p>}
                                >
                                    <p>Your tickets are confirmed.</p>
                                    <ul class="event-detail__codes">
                                        <For each={ticketCodes()}>
                                            {(t,) => (
                                                <li>
                                                    <strong>{t.tierName}</strong> <code>{t.code}</code>
                                                </li>
                                            )}
                                        </For>
                                    </ul>
                                    <p>We've emailed these to you.</p>
                                </Show>
                            </div>
                        </Show>
                    }
                >
                    <form onSubmit={submit} class="event-detail__form">
                        <Show when={auth.user}>
                            <p class="event-signup__as">Signing up as:</p>
                        </Show>
                        <For each={fields()}>
                            {(f,) => (
                                <Show
                                    when={known()[f]}
                                    fallback={
                                        <label>
                                            <span>{FIELD_META[f].label}</span>
                                            <Show
                                                when={FIELD_META[f].type === 'textarea'}
                                                fallback={
                                                    <input
                                                        type={FIELD_META[f].type}
                                                        value={values()[f] ?? ''}
                                                        onInput={(e,) => setValue(f, e.currentTarget.value,)}
                                                        // Email is the key; a register form also needs
                                                        // whatever the event asked for.
                                                        required={f === 'email' ||
                                                            (mode() === 'register' && f !== 'notes')}
                                                        autocomplete={f === 'email' ?
                                                            'email' :
                                                            f === 'name' ?
                                                            'name' :
                                                            f === 'phone' ?
                                                            'tel' :
                                                            f === 'organization' ?
                                                            'organization' :
                                                            undefined}
                                                    />
                                                }
                                            >
                                                <textarea
                                                    rows={3}
                                                    value={values()[f] ?? ''}
                                                    onInput={(e,) => setValue(f, e.currentTarget.value,)}
                                                />
                                            </Show>
                                        </label>
                                    }
                                >
                                    <div class="event-signup__known">
                                        <span class="event-signup__known-label">{FIELD_META[f].label}</span>
                                        <span class="event-signup__known-value">{known()[f]}</span>
                                    </div>
                                </Show>
                            )}
                        </For>

                        <Show when={error()}>
                            <p class="event-detail__error">{error()}</p>
                        </Show>
                        <button type="submit" class="btn btn--primary" disabled={submitting()}>
                            {buttonText()}
                        </button>
                    </form>

                    <Show when={!auth.user}>
                        <p class="event-signup__login">
                            Have an account?{' '}
                            <button type="button" class="event-signup__login-link" onClick={() => setLoginOpen(true,)}>
                                Log in
                            </button>{' '}
                            to use your details.
                        </p>
                    </Show>
                </Show>
            </section>

            <Show when={loginOpen()}>
                <LoginModal onClose={() => setLoginOpen(false,)} />
            </Show>
        </Show>
    );
};

export default EventSignup;
