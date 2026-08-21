import type {
    CalendarEvent, CalendarEventInput, EventOccurrence,
    EventsSettings, EventTicketTier,
} from '@sitesurge/types';
import type { Paginated, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * events namespace (feature-gated behind `events`). Reads are role-shaped: an
 * anonymous caller only ever sees published events, and never a cancelled
 * occurrence of a recurring series.
 */
export class EventsModule extends ModuleBase {
    protected readonly module = 'events';

    /** GET /events — flat list (no recurrence expansion). */
    list(query: Record<string, unknown> = {},): Promise<Paginated<CalendarEvent>> {
        return this.getPaged<CalendarEvent>('/events', { query, },);
    }

    /**
     * GET /events/calendar — occurrences in a window, recurring series expanded.
     * This is what both calendar surfaces render.
     */
    calendar(query: { from: string; to: string; search?: string; },): Promise<EventOccurrence[]> {
        return this.get<EventOccurrence[]>('/events/calendar', {
            query, options: { cache: false, },
        },);
    }

    /** GET /events/:idOrSlug — by slug or uuid. */
    getOne(idOrSlug: string,): Promise<CalendarEvent> {
        return this.get<CalendarEvent>('/events/:idOrSlug', {
            params: { idOrSlug, }, options: { cache: false, },
        },);
    }

    create(body: CalendarEventInput,): Promise<CalendarEvent> {
        return this.mutate<CalendarEvent>('POST', '/events', { body, invalidates: ['events',], },);
    }

    update(id: string, body: Partial<CalendarEventInput>,): Promise<CalendarEvent> {
        return this.mutate<CalendarEvent>('PUT', '/events/:id', {
            params: { id, }, body, invalidates: ['events',],
        },);
    }

    remove(id: string,): Promise<{ deleted: boolean; }> {
        return this.mutate<{ deleted: boolean; }>('DELETE', '/events/:id', {
            params: { id, }, invalidates: ['events',],
        },);
    }

    /** GET /events/:id/tiers — with live sold/remaining for that occurrence. */
    tiers(id: string, occurrenceDate: string,): Promise<EventTicketTier[]> {
        return this.get<EventTicketTier[]>('/events/:id/tiers', {
            params: { id, }, query: { occurrenceDate, }, options: { cache: false, },
        },);
    }

    replaceTiers(id: string, tiers: unknown[],): Promise<EventTicketTier[]> {
        return this.mutate<EventTicketTier[]>('PUT', '/events/:id/tiers', {
            params: { id, }, body: { tiers, }, invalidates: ['events',],
        },);
    }

    /** Cancel (or restore, with null) ONE date of a recurring series. */
    setOccurrenceStatus(
        id: string, date: string, status: 'cancelled' | null,
    ): Promise<{ ok: boolean; }> {
        return this.mutate<{ ok: boolean; }>('PUT', '/events/:id/occurrences/:date', {
            params: { id, date, }, body: { status, }, invalidates: ['events',],
        },);
    }

    /** POST /events/:id/register — attendee registration (NOT the notification
     *  subscribe; this is what tells the organiser who is coming). */
    register(id: string, body: {
        email: string; name?: string; phone?: string;
        occurrenceDate?: string; fields?: Record<string, unknown>;
    },): Promise<{ registration: unknown; }> {
        return this.mutate('POST', '/events/:id/register', { params: { id, }, body, },);
    }

    /** GET /events/:id/registrations — paged attendee list (staff). */
    registrations(id: string, query: { occurrenceDate: string; page?: number; limit?: number; },) {
        return this.getPaged('/events/:id/registrations', { params: { id, }, query, },);
    }

    /** POST /events/tickets/purchase — free orders confirm immediately; paid
     *  ones come back with a total for the payment step. Price and inventory
     *  are re-resolved server-side, so the cart's figures are display-only. */
    purchaseTickets(body: {
        email: string; name?: string; phone?: string;
        lines: Array<{
            eventId: string; occurrenceDate: string; tierId: string; quantity: number;
        }>;
    },): Promise<{
        status: 'confirmed' | 'payment_required';
        totalCents: number; currency: string;
        registrationId?: string;
        tickets?: Array<{ code: string; tierName: string; }>;
    }> {
        return this.mutate('POST', '/events/tickets/purchase', { body, },);
    }

    settings(): Promise<EventsSettings> {
        return this.get<EventsSettings>('/events/settings',);
    }

    updateSettings(body: Partial<EventsSettings>,): Promise<EventsSettings> {
        return this.mutate<EventsSettings>('PUT', '/events/settings', { body, },);
    }

    subscribe(body: { email: string; eventId?: string; notifyEmail?: boolean; notifyPush?: boolean; },) {
        return this.mutate('POST', '/events/subscribe', { body, },);
    }
}
