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
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
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
