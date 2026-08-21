/**
 * Events & calendar — request/response DTOs (`/api/v1/events/*`).
 *
 * List responses are element arrays with pagination on `meta`, per the barrel's
 * conventions; entity GETs return the entity directly.
 */
import type {
    CalendarEvent,
    CalendarEventInput,
    EventPushSubscriptionInput,
    EventsSettings,
    EventStatus,
    EventSubscriber,
} from '../../types/event';

/** GET /events — the calendar/list query. */
export interface EventsListQuery {
    /** ISO date/time. Returns events whose start falls in [from, to). */
    from?: string;
    to?: string;
    /** Admin-only; anonymous callers always get `published`. */
    status?: EventStatus;
    /** Free-text over title/description/location. */
    search?: string;
    page?: number;
    limit?: number;
    /** `asc` (default, soonest first) or `desc`. */
    sort?: 'asc' | 'desc';
}

export type EventsListResponse = CalendarEvent[];

/** GET /events/:idOrSlug. */
export interface EventsGetParams {
    idOrSlug: string;
}
export type EventsGetResponse = CalendarEvent;

/** POST /events (admin). */
export type EventsCreateBody = CalendarEventInput;
export type EventsCreateResponse = CalendarEvent;

/** PUT /events/:id (admin). */
export type EventsUpdateBody = Partial<CalendarEventInput>;
export type EventsUpdateResponse = CalendarEvent;

/** DELETE /events/:id (admin). */
export interface EventsDeleteResponse {
    deleted: boolean;
}

/** POST /events/subscribe — subscribe to one event or (no eventId) to all. */
export interface EventsSubscribeBody {
    email: string;
    /** Omit for a site-wide subscription. */
    eventId?: string;
    notifyEmail?: boolean;
    notifyPush?: boolean;
}
export interface EventsSubscribeResponse {
    subscriber: EventSubscriber;
}

/** POST /events/unsubscribe — token from the email footer. */
export interface EventsUnsubscribeBody {
    token: string;
}
export interface EventsUnsubscribeResponse {
    unsubscribed: boolean;
}

/** POST /events/push/subscribe — register a browser push endpoint. */
export type EventsPushSubscribeBody = EventPushSubscriptionInput;
export interface EventsPushSubscribeResponse {
    subscribed: boolean;
    /** False when the server has no VAPID keys configured. */
    pushEnabled: boolean;
}

/** GET /events/settings — public subset (the VAPID public key + toggles). */
export type EventsSettingsResponse = EventsSettings;

/** PUT /events/settings (admin). */
export type EventsSettingsUpdateBody = Partial<EventsSettings>;
export type EventsSettingsUpdateResponse = EventsSettings;
