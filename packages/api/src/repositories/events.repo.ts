/**
 * Events data access. SQL lives here; business rules live in services/events.ts.
 */
import type { CalendarEvent, CalendarEventInput, EventSubscriber, } from '@sitesurge/types';
import { query, } from '../db';
import { mapRow, mapRows, buildUpdateSet, camelToSnake, } from '../utils/mapRow';

const SELECT = `id, title, slug, description, starts_at, ends_at, all_day, location,
    url, featured_image, status, created_by, created_at, updated_at`;

export interface EventFilters {
    /** Inclusive lower bound on starts_at. */
    from?: string;
    /** Exclusive upper bound on starts_at. */
    to?: string;
    status?: string;
    search?: string;
    sort?: 'asc' | 'desc';
}

export interface EventListResult {
    data: CalendarEvent[];
    total: number;
}

/**
 * Build the shared WHERE for list/count so the two can never disagree about
 * which rows are in scope (a classic source of wrong pagination totals).
 */
function buildWhere(filters: EventFilters,): { clause: string; params: unknown[]; } {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.status) {
        params.push(filters.status,);
        clauses.push(`status = $${params.length}`,);
    }
    if (filters.from) {
        params.push(filters.from,);
        // Include events that are still RUNNING at `from` (started earlier but
        // end inside the window) — otherwise a multi-day event vanishes from the
        // calendar for every day except its first.
        clauses.push(`(starts_at >= $${params.length} OR ends_at >= $${params.length})`,);
    }
    if (filters.to) {
        params.push(filters.to,);
        clauses.push(`starts_at < $${params.length}`,);
    }
    if (filters.search) {
        params.push(`%${filters.search}%`,);
        const i = params.length;
        clauses.push(`(title ILIKE $${i} OR description ILIKE $${i} OR location ILIKE $${i})`,);
    }

    return { clause: clauses.length ? `WHERE ${clauses.join(' AND ',)}` : '', params, };
}

export async function findEvents(
    filters: EventFilters = {},
    pagination: { page?: number; limit?: number; } = {},
): Promise<EventListResult> {
    const page = Math.max(1, pagination.page ?? 1,);
    const limit = Math.min(500, Math.max(1, pagination.limit ?? 100,),);
    const { clause, params, } = buildWhere(filters,);
    const dir = filters.sort === 'desc' ? 'DESC' : 'ASC';

    const countRes = await query<{ count: string; }>(
        `SELECT COUNT(*)::int AS count FROM events ${clause}`,
        params,
    );
    const total = Number(countRes.rows[0]?.count ?? 0,);

    const res = await query(
        `SELECT ${SELECT} FROM events ${clause}
         ORDER BY starts_at ${dir}, title ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, (page - 1) * limit,],
    );
    return { data: mapRows<CalendarEvent>(res.rows,), total, };
}

export async function findById(id: string,): Promise<CalendarEvent | null> {
    const res = await query(`SELECT ${SELECT} FROM events WHERE id = $1`, [id,],);
    return res.rows[0] ? mapRow<CalendarEvent>(res.rows[0],) : null;
}

export async function findBySlug(slug: string,): Promise<CalendarEvent | null> {
    const res = await query(`SELECT ${SELECT} FROM events WHERE slug = $1`, [slug,],);
    return res.rows[0] ? mapRow<CalendarEvent>(res.rows[0],) : null;
}

/** True when `slug` is taken by a row other than `exceptId`. */
export async function slugExists(slug: string, exceptId?: string,): Promise<boolean> {
    const res = await query<{ id: string; }>(
        exceptId
            ? `SELECT id FROM events WHERE slug = $1 AND id <> $2 LIMIT 1`
            : `SELECT id FROM events WHERE slug = $1 LIMIT 1`,
        exceptId ? [slug, exceptId,] : [slug,],
    );
    return (res.rowCount ?? 0) > 0;
}

export async function createEvent(
    input: CalendarEventInput & { slug: string; },
    createdBy?: string,
): Promise<CalendarEvent> {
    const res = await query(
        `INSERT INTO events (title, slug, description, starts_at, ends_at, all_day,
                             location, url, featured_image, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING ${SELECT}`,
        [
            input.title,
            input.slug,
            input.description ?? null,
            input.startsAt,
            input.endsAt ?? null,
            input.allDay ?? false,
            input.location ?? null,
            input.url ?? null,
            input.featuredImage ?? null,
            input.status ?? 'published',
            createdBy ?? null,
        ],
    );
    return mapRow<CalendarEvent>(res.rows[0],);
}

export async function updateEvent(
    id: string,
    patch: Record<string, unknown>,
): Promise<CalendarEvent | null> {
    const { setClause, values, } = buildUpdateSet(patch,);
    if (!setClause) return findById(id,);
    const res = await query(
        `UPDATE events SET ${setClause}, updated_at = NOW()
         WHERE id = $${values.length + 1}
         RETURNING ${SELECT}`,
        [...values, id,],
    );
    return res.rows[0] ? mapRow<CalendarEvent>(res.rows[0],) : null;
}

export async function deleteEvent(id: string,): Promise<boolean> {
    const res = await query(`DELETE FROM events WHERE id = $1`, [id,],);
    return (res.rowCount ?? 0) > 0;
}

// ─── Subscribers ──────────────────────────────────────────────────

const SUB_SELECT = `id, event_id, user_id, email, notify_email, notify_push, created_at`;

export async function upsertSubscriber(input: {
    eventId?: string | null;
    userId?: string | null;
    email: string;
    notifyEmail: boolean;
    notifyPush: boolean;
    unsubscribeToken: string;
},): Promise<EventSubscriber> {
    // The unique index is on (COALESCE(event_id, zero-uuid), LOWER(email)), so
    // the conflict target must be written the same way.
    const res = await query(
        `INSERT INTO event_subscribers
            (event_id, user_id, email, notify_email, notify_push, unsubscribe_token)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (COALESCE(event_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(email))
         DO UPDATE SET notify_email = EXCLUDED.notify_email,
                       notify_push  = EXCLUDED.notify_push,
                       user_id      = COALESCE(EXCLUDED.user_id, event_subscribers.user_id)
         RETURNING ${SUB_SELECT}`,
        [
            input.eventId ?? null,
            input.userId ?? null,
            input.email.toLowerCase(),
            input.notifyEmail,
            input.notifyPush,
            input.unsubscribeToken,
        ],
    );
    return mapRow<EventSubscriber>(res.rows[0],);
}

/**
 * Everyone who should hear about `eventId`: its own subscribers PLUS the
 * site-wide ones (event_id IS NULL). De-duplicated by email so a person
 * subscribed both ways is mailed once.
 */
export async function findRecipientsForEvent(eventId: string,): Promise<EventSubscriber[]> {
    const res = await query(
        `SELECT DISTINCT ON (LOWER(email)) ${SUB_SELECT}
           FROM event_subscribers
          WHERE event_id = $1 OR event_id IS NULL
          ORDER BY LOWER(email), event_id NULLS LAST`,
        [eventId,],
    );
    return mapRows<EventSubscriber>(res.rows,);
}

export async function deleteSubscriberByToken(token: string,): Promise<boolean> {
    const res = await query(`DELETE FROM event_subscribers WHERE unsubscribe_token = $1`, [token,],);
    return (res.rowCount ?? 0) > 0;
}

// ─── Web Push endpoints ───────────────────────────────────────────

export async function upsertPushSubscription(input: {
    userId?: string | null;
    email?: string | null;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string | null;
},): Promise<void> {
    await query(
        `INSERT INTO event_push_subscriptions (user_id, email, endpoint, p256dh, auth, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (endpoint) DO UPDATE
            SET p256dh = EXCLUDED.p256dh,
                auth   = EXCLUDED.auth,
                user_id = COALESCE(EXCLUDED.user_id, event_push_subscriptions.user_id),
                email   = COALESCE(EXCLUDED.email, event_push_subscriptions.email)`,
        [
            input.userId ?? null,
            input.email?.toLowerCase() ?? null,
            input.endpoint,
            input.p256dh,
            input.auth,
            input.userAgent ?? null,
        ],
    );
}

export interface PushEndpoint {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    email: string | null;
}

/** Push endpoints belonging to the given emails (case-insensitive). */
export async function findPushEndpointsForEmails(emails: string[],): Promise<PushEndpoint[]> {
    if (emails.length === 0) return [];
    const res = await query(
        `SELECT id, endpoint, p256dh, auth, email
           FROM event_push_subscriptions
          WHERE LOWER(email) = ANY($1::text[])`,
        [emails.map((e,) => e.toLowerCase()),],
    );
    return mapRows<PushEndpoint>(res.rows,);
}

/** A dead endpoint (410/404 from the push service) must be pruned or it is
 *  retried forever. */
export async function deletePushSubscription(endpoint: string,): Promise<void> {
    await query(`DELETE FROM event_push_subscriptions WHERE endpoint = $1`, [endpoint,],);
}

// ─── Idempotency ledger ───────────────────────────────────────────

/**
 * Claim the right to send. Returns false when this (event, kind, channel,
 * recipient) was already sent — the unique index makes the check atomic, so
 * concurrent workers can't both win.
 */
export async function claimNotification(
    eventId: string,
    kind: string,
    channel: string,
    recipient: string,
): Promise<boolean> {
    const res = await query(
        `INSERT INTO event_notifications_sent (event_id, kind, channel, recipient)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [eventId, kind, channel, recipient,],
    );
    return (res.rowCount ?? 0) > 0;
}

/** Events starting inside the reminder window that are published. */
export async function findEventsNeedingReminder(hoursBefore: number,): Promise<CalendarEvent[]> {
    const res = await query(
        `SELECT ${SELECT} FROM events
          WHERE status = 'published'
            AND starts_at > NOW()
            AND starts_at <= NOW() + ($1 || ' hours')::interval
          ORDER BY starts_at ASC`,
        [String(hoursBefore,),],
    );
    return mapRows<CalendarEvent>(res.rows,);
}

export { camelToSnake, };
