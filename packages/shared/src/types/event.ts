/**
 * Events & calendar module types.
 *
 * Dates cross the wire as ISO strings. `allDay` is a display flag, not a
 * separate storage shape: an all-day event still has a real `startsAt`, pinned
 * to midnight, so every range query stays a plain timestamp comparison.
 */

export type EventStatus = 'draft' | 'published' | 'cancelled';

export interface CalendarEvent {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    /** ISO timestamp. */
    startsAt: string;
    /** ISO timestamp, or null for an event with no defined end. */
    endsAt: string | null;
    allDay: boolean;
    location: string | null;
    /** External link (tickets, venue page, …). */
    url: string | null;
    featuredImage: string | null;
    status: EventStatus;
    /** IANA zone the event's wall-clock time is expressed in. */
    timezone: string | null;
    /** null = does not repeat. See `utils/recurrence.ts`. */
    recurrenceRule: string | null;
    /** null WITH a rule = repeats indefinitely (expansion is window-bounded). */
    recurrenceUntil: string | null;
    registrationEnabled: boolean;
    registrationFields: string[];
    showRegistrantCount: boolean;
    ticketingEnabled: boolean;
    metadata: Record<string, unknown>;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
    /** Attached by the admin detail endpoint. */
    tiers?: EventTicketTier[];
}

/** Fields an admin may set when creating/updating an event. */
export interface CalendarEventInput {
    title: string;
    slug?: string;
    description?: string | null;
    startsAt: string;
    endsAt?: string | null;
    allDay?: boolean;
    location?: string | null;
    url?: string | null;
    featuredImage?: string | null;
    status?: EventStatus;
    timezone?: string | null;
    recurrenceRule?: string | null;
    recurrenceUntil?: string | null;
    registrationEnabled?: boolean;
    registrationFields?: string[];
    showRegistrantCount?: boolean;
    ticketingEnabled?: boolean;
    metadata?: Record<string, unknown>;
    tiers?: EventTicketTierInput[];
}

/** How a subscriber wants to be told about events. */
export interface EventSubscriberChannels {
    email: boolean;
    push: boolean;
}

export interface EventSubscriber {
    id: string;
    /** null = subscribed to every event. */
    eventId: string | null;
    userId: string | null;
    email: string;
    notifyEmail: boolean;
    notifyPush: boolean;
    createdAt: string;
}

/** A browser Web Push endpoint (desktop/mobile notifications). */
export interface EventPushSubscriptionInput {
    endpoint: string;
    keys: { p256dh: string; auth: string; };
    /** Optional — lets a signed-out visitor still receive email as well. */
    email?: string;
}

/** Operator settings for the module (the `events` site_settings row). */
export interface EventsSettings {
    /** Send an email when an event is first published. */
    notifyOnPublish: boolean;
    /** Send a reminder this many hours before an event starts. 0 disables. */
    reminderHoursBefore: number;
    /** Public VAPID key, handed to the browser to create a push subscription. */
    vapidPublicKey?: string;
}

export const DEFAULT_EVENTS_SETTINGS: EventsSettings = {
    notifyOnPublish: true,
    reminderHoursBefore: 24,
};

// ─── Recurrence, registration & ticketing ─────────────────────────

/** A per-date exception to a recurring series. */
export interface EventOccurrenceOverride {
    id: string;
    eventId: string;
    /** `YYYY-MM-DD`. */
    occurrenceDate: string;
    status: 'cancelled' | 'moved' | null;
    startsAtOverride: string | null;
    endsAtOverride: string | null;
    titleOverride: string | null;
}

/** A purchasable ticket tier. `priceCents` 0 is legitimate — a free tier with a
 *  quantity cap is how a limited free event is run. */
export interface EventTicketTier {
    id: string;
    eventId: string;
    name: string;
    priceCents: number;
    currency: string;
    /** null = unlimited. */
    quantityAvailable: number | null;
    position: number;
    /** Derived, not stored: tickets already issued for the occurrence. */
    sold?: number;
    remaining?: number | null;
}

export type EventTicketTierInput = Omit<
    EventTicketTier, 'id' | 'eventId' | 'sold' | 'remaining'
> & { id?: string; };

export type EventRegistrationStatus = 'registered' | 'cancelled' | 'waitlist';

export interface EventRegistration {
    id: string;
    eventId: string;
    occurrenceDate: string;
    userId: string | null;
    email: string;
    name: string | null;
    phone: string | null;
    fields: Record<string, unknown>;
    status: EventRegistrationStatus;
    orderId: string | null;
    createdAt: string;
    /** Attached when listing for the admin table. */
    tickets?: EventTicket[];
}

export interface EventTicket {
    id: string;
    registrationId: string;
    tierId: string | null;
    tierName?: string;
    eventId: string;
    occurrenceDate: string;
    code: string;
    status: 'valid' | 'refunded' | 'checked_in' | 'cancelled';
    priceCentsPaid: number;
    currency: string;
    createdAt: string;
}

/** Which fields an attendee must supply. */
export type EventRegistrationField = 'name' | 'email' | 'phone' | 'organization' | 'notes';

export const EVENT_REGISTRATION_FIELDS: Array<{ key: EventRegistrationField; label: string; }> = [
    { key: 'name', label: 'Name', },
    { key: 'email', label: 'Email', },
    { key: 'phone', label: 'Phone number', },
    { key: 'organization', label: 'Organization', },
    { key: 'notes', label: 'Notes', },
];

/**
 * One expanded instance of an event, as served to a calendar.
 * A non-recurring event yields exactly one, whose `occurrenceDate` equals its
 * own start date.
 */
export interface EventOccurrence {
    event: CalendarEvent;
    /** `YYYY-MM-DD` — the key registrations and tickets hang off. */
    occurrenceDate: string;
    startsAt: string;
    endsAt: string | null;
    /** True when this specific date was cancelled. Retained rather than removed
     *  so the admin can SEE the cancellation; public views filter it out. */
    cancelled: boolean;
    /** Per-date title override, when set. */
    title: string;
    /** Only populated when the event opts in to showing it. */
    registrantCount?: number;
}

/** A ticket line held in the shop cart. Deliberately NOT a real product row —
 *  see the module plan for why. */
export interface EventTicketCartLine {
    kind: 'event_ticket';
    eventId: string;
    occurrenceDate: string;
    tierId: string;
    /** Snapshot for display only; checkout re-resolves both server-side. */
    name: string;
    priceCents: number;
    currency: string;
    quantity: number;
}
