/**
 * Events data access. SQL lives here; business rules live in services/events.ts.
 */
import type {
    CalendarEvent, CalendarEventInput, EventOccurrenceOverride,
    EventSubscriber, EventTicketTier,
} from '@sitesurge/types';
import { query, } from '../db';
import { mapRow, mapRows, buildUpdateSet, camelToSnake, } from '../utils/mapRow';

/**
 * `mapRow` turns every `*_at` column into a Date, but `CalendarEvent` declares
 * these as ISO strings (they cross the wire as JSON). Left alone the type lies
 * at runtime — `event.startsAt.slice(...)` threw in the registration path.
 * Normalise once here so the repo's output actually matches its declared type.
 */
function toIsoFields(row: CalendarEvent,): CalendarEvent {
    const out = { ...row, } as unknown as Record<string, unknown>;
    for (const k of ['startsAt', 'endsAt', 'recurrenceUntil', 'createdAt', 'updatedAt',]) {
        const v = out[k];
        if (v instanceof Date) out[k] = v.toISOString();
    }
    return out as unknown as CalendarEvent;
}

const SELECT = `id, title, slug, description, starts_at, ends_at, all_day, location,
    url, featured_image, status, timezone, recurrence_rule, recurrence_until,
    registration_enabled, registration_fields, show_registrant_count,
    ticketing_enabled, view_access, view_min_tier_id, register_access, register_min_tier_id,
    metadata, created_by, created_at, updated_at`;

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
    return { data: mapRows<CalendarEvent>(res.rows,).map((r,) => toIsoFields(r,)), total, };
}

export async function findById(id: string,): Promise<CalendarEvent | null> {
    const res = await query(`SELECT ${SELECT} FROM events WHERE id = $1`, [id,],);
    return res.rows[0] ? toIsoFields(mapRow<CalendarEvent>(res.rows[0],),) : null;
}

/** Many events by id (any order; missing ids are simply absent). */
export async function findByIds(ids: string[],): Promise<CalendarEvent[]> {
    if (ids.length === 0) return [];
    const res = await query(`SELECT ${SELECT} FROM events WHERE id = ANY($1::uuid[])`, [ids,],);
    return mapRows<CalendarEvent>(res.rows,).map((r,) => toIsoFields(r,));
}

export async function findBySlug(slug: string,): Promise<CalendarEvent | null> {
    const res = await query(`SELECT ${SELECT} FROM events WHERE slug = $1`, [slug,],);
    return res.rows[0] ? toIsoFields(mapRow<CalendarEvent>(res.rows[0],),) : null;
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
                             location, url, featured_image, status, timezone,
                             recurrence_rule, recurrence_until, registration_enabled,
                             registration_fields, show_registrant_count,
                             ticketing_enabled, metadata, created_by,
                             view_access, view_min_tier_id, register_access, register_min_tier_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
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
            input.timezone ?? null,
            input.recurrenceRule ?? null,
            input.recurrenceUntil ?? null,
            input.registrationEnabled ?? false,
            JSON.stringify(input.registrationFields ?? ['name', 'email',],),
            input.showRegistrantCount ?? false,
            input.ticketingEnabled ?? false,
            JSON.stringify(input.metadata ?? {},),
            createdBy ?? null,
            input.viewAccess ?? 'inherit',
            input.viewAccess === 'tier' ? input.viewMinTierId ?? null : null,
            input.registerAccess ?? 'inherit',
            input.registerAccess === 'tier' ? input.registerMinTierId ?? null : null,
        ],
    );
    return toIsoFields(mapRow<CalendarEvent>(res.rows[0],),);
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
    return res.rows[0] ? toIsoFields(mapRow<CalendarEvent>(res.rows[0],),) : null;
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
    /** Confirmed now (a signed-in subscriber). False = awaits the opt-in link. */
    confirmed?: boolean;
},): Promise<EventSubscriber & { confirmedAt: string | null; }> {
    // The unique index is on (COALESCE(event_id, zero-uuid), LOWER(email)), so
    // the conflict target must be written the same way.
    const res = await query(
        `INSERT INTO event_subscribers
            (event_id, user_id, email, notify_email, notify_push, unsubscribe_token, confirmed_at)
         VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $7::boolean THEN NOW() END)
         ON CONFLICT (COALESCE(event_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(email))
         DO UPDATE SET notify_email = EXCLUDED.notify_email,
                       notify_push  = EXCLUDED.notify_push,
                       user_id      = COALESCE(EXCLUDED.user_id, event_subscribers.user_id),
                       -- Once confirmed, always confirmed; a signed-in re-subscribe confirms.
                       confirmed_at = COALESCE(event_subscribers.confirmed_at, EXCLUDED.confirmed_at)
         RETURNING ${SUB_SELECT}, confirmed_at`,
        [
            input.eventId ?? null,
            input.userId ?? null,
            input.email.toLowerCase(),
            input.notifyEmail,
            input.notifyPush,
            input.unsubscribeToken,
            input.confirmed === true,
        ],
    );
    return mapRow<EventSubscriber & { confirmedAt: string | null; }>(res.rows[0],);
}

/** Mark a subscription confirmed (the opt-in link). False when it is gone. */
export async function confirmSubscriber(id: string,): Promise<boolean> {
    const res = await query(
        `UPDATE event_subscribers SET confirmed_at = COALESCE(confirmed_at, NOW()) WHERE id = $1`,
        [id,],
    );
    return (res.rowCount ?? 0) > 0;
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
          WHERE (event_id = $1 OR event_id IS NULL)
            AND confirmed_at IS NOT NULL
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

// ─── Occurrence overrides ─────────────────────────────────────────

const OVERRIDE_SELECT = `id, event_id, to_char(occurrence_date, 'YYYY-MM-DD') AS occurrence_date,
    status, starts_at_override, ends_at_override, title_override`;

/** Overrides for a set of events, grouped by event id — one query for a whole
 *  calendar render rather than one per event. */
export async function findOverridesForEvents(
    eventIds: string[],
): Promise<Map<string, EventOccurrenceOverride[]>> {
    const out = new Map<string, EventOccurrenceOverride[]>();
    if (eventIds.length === 0) return out;
    const res = await query(
        `SELECT ${OVERRIDE_SELECT} FROM event_occurrence_overrides WHERE event_id = ANY($1::uuid[])`,
        [eventIds,],
    );
    for (const row of mapRows<EventOccurrenceOverride>(res.rows,)) {
        const list = out.get(row.eventId,);
        if (list) list.push(row,);
        else out.set(row.eventId, [row,],);
    }
    return out;
}

/** Upsert a per-date exception. Re-cancelling the same date updates it. */
export async function upsertOverride(input: {
    eventId: string;
    occurrenceDate: string;
    status?: 'cancelled' | 'moved' | null;
    startsAtOverride?: string | null;
    endsAtOverride?: string | null;
    titleOverride?: string | null;
},): Promise<EventOccurrenceOverride> {
    const res = await query(
        `INSERT INTO event_occurrence_overrides
            (event_id, occurrence_date, status, starts_at_override, ends_at_override, title_override)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (event_id, occurrence_date) DO UPDATE
            SET status = EXCLUDED.status,
                starts_at_override = EXCLUDED.starts_at_override,
                ends_at_override = EXCLUDED.ends_at_override,
                title_override = EXCLUDED.title_override
         RETURNING ${OVERRIDE_SELECT}`,
        [
            input.eventId, input.occurrenceDate, input.status ?? null,
            input.startsAtOverride ?? null, input.endsAtOverride ?? null,
            input.titleOverride ?? null,
        ],
    );
    return mapRow<EventOccurrenceOverride>(res.rows[0],);
}

export async function deleteOverride(eventId: string, occurrenceDate: string,): Promise<boolean> {
    const res = await query(
        `DELETE FROM event_occurrence_overrides WHERE event_id = $1 AND occurrence_date = $2`,
        [eventId, occurrenceDate,],
    );
    return (res.rowCount ?? 0) > 0;
}

// ─── Ticket tiers ─────────────────────────────────────────────────

const TIER_SELECT = `id, event_id, name, description, price_cents, currency, quantity_available, position, required_tier_id, max_per_order`;

export async function findTiers(eventId: string,): Promise<EventTicketTier[]> {
    const res = await query(
        `SELECT ${TIER_SELECT} FROM event_ticket_tiers WHERE event_id = $1 ORDER BY position, name`,
        [eventId,],
    );
    return mapRows<EventTicketTier>(res.rows,);
}

/** Tiers of many events, grouped by event id (ordered by position) — one query per list. */
export async function findTiersForEvents(eventIds: string[],): Promise<Map<string, EventTicketTier[]>> {
    const out = new Map<string, EventTicketTier[]>();
    if (eventIds.length === 0) return out;
    const res = await query(
        `SELECT ${TIER_SELECT} FROM event_ticket_tiers WHERE event_id = ANY($1::uuid[]) ORDER BY event_id, position, name`,
        [eventIds,],
    );
    for (const t of mapRows<EventTicketTier>(res.rows,)) {
        const list = out.get(t.eventId,);
        if (list) list.push(t,);
        else out.set(t.eventId, [t,],);
    }
    return out;
}

export async function findTierById(id: string,): Promise<EventTicketTier | null> {
    const res = await query(`SELECT ${TIER_SELECT} FROM event_ticket_tiers WHERE id = $1`, [id,],);
    return res.rows[0] ? mapRow<EventTicketTier>(res.rows[0],) : null;
}

/**
 * Replace an event's tiers in one transaction.
 *
 * Tiers carrying an `id` are UPDATED in place rather than deleted and
 * reinserted — an issued ticket references its tier, and recreating rows would
 * orphan those references (and lose the sold counts they're joined on).
 */
export async function replaceTiers(
    eventId: string,
    tiers: Array<{
        id?: string; name: string; priceCents: number; currency: string;
        quantityAvailable: number | null; position: number; requiredTierId?: string | null;
        maxPerOrder?: number | null;
        /** undefined = keep the stored blurb; null / '' = clear it. */
        description?: string | null;
    }>,
): Promise<EventTicketTier[]> {
    const keptIds = tiers.map((t,) => t.id).filter(Boolean,) as string[];
    await query(
        keptIds.length
            ? `DELETE FROM event_ticket_tiers WHERE event_id = $1 AND id <> ALL($2::uuid[])`
            : `DELETE FROM event_ticket_tiers WHERE event_id = $1`,
        keptIds.length ? [eventId, keptIds,] : [eventId,],
    );

    for (const [i, t,] of tiers.entries()) {
        if (t.id) {
            await query(
                `UPDATE event_ticket_tiers
                    SET name = $1, price_cents = $2, currency = $3,
                        quantity_available = $4, position = $5, required_tier_id = $8, max_per_order = $9,
                        description = CASE WHEN $11::boolean THEN $10 ELSE description END, updated_at = NOW()
                  WHERE id = $6 AND event_id = $7`,
                [
                    t.name, t.priceCents, t.currency, t.quantityAvailable, i, t.id, eventId, t.requiredTierId ?? null, t.maxPerOrder ?? null,
                    t.description?.trim() || null, t.description !== undefined,
                ],
            );
        } else {
            await query(
                `INSERT INTO event_ticket_tiers
                    (event_id, name, price_cents, currency, quantity_available, position, required_tier_id, max_per_order, description)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [eventId, t.name, t.priceCents, t.currency, t.quantityAvailable, i, t.requiredTierId ?? null, t.maxPerOrder ?? null, t.description?.trim() || null,],
            );
        }
    }
    return findTiers(eventId,);
}

/** Valid tickets of one tier for one date already held by an email address
 *  (the per-buyer cap). Matched case-insensitively. */
export async function countHeldByEmail(tierId: string, occurrenceDate: string, email: string,): Promise<number> {
    const res = await query<{ n: number; }>(
        `SELECT COUNT(*)::int AS n
           FROM event_tickets t
           JOIN event_registrations r ON r.id = t.registration_id
          WHERE t.tier_id = $1 AND t.occurrence_date = $2
            AND lower(r.email) = lower($3)
            AND t.status IN ('valid', 'checked_in')`,
        [tierId, occurrenceDate, email,],
    );
    return Number(res.rows[0]?.n ?? 0,);
}

/** Tickets already issued per tier for one occurrence. Refunded/cancelled do
 *  NOT count against inventory — that seat is available again. */
export async function countSoldByTier(
    eventId: string,
    occurrenceDate: string,
): Promise<Record<string, number>> {
    const res = await query<{ tier_id: string; sold: number; }>(
        `SELECT tier_id, COUNT(*)::int AS sold
           FROM event_tickets
          WHERE event_id = $1 AND occurrence_date = $2
            AND status IN ('valid', 'checked_in')
          GROUP BY tier_id`,
        [eventId, occurrenceDate,],
    );
    const out: Record<string, number> = {};
    for (const r of res.rows) if (r.tier_id) out[r.tier_id] = Number(r.sold,);
    return out;
}

/**
 * Tickets issued per tier for several (event, occurrence date) pairs at once —
 * `countSoldByTier` for a whole list. Keyed by tier id (a tier belongs to one
 * event, and each event is asked about one date).
 */
export async function countSoldForOccurrences(
    pairs: Array<{ eventId: string; occurrenceDate: string; }>,
): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    if (pairs.length === 0) return out;
    const res = await query<{ tier_id: string; sold: number; }>(
        `SELECT t.tier_id, COUNT(*)::int AS sold
           FROM event_tickets t
           JOIN unnest($1::uuid[], $2::date[]) AS p(event_id, occurrence_date)
             ON p.event_id = t.event_id AND p.occurrence_date = t.occurrence_date
          WHERE t.status IN ('valid', 'checked_in')
          GROUP BY t.tier_id`,
        [pairs.map((p,) => p.eventId,), pairs.map((p,) => p.occurrenceDate,),],
    );
    for (const r of res.rows) if (r.tier_id) out[r.tier_id] = Number(r.sold,);
    return out;
}

// ─── Registrations ────────────────────────────────────────────────

const REG_SELECT = `id, event_id, to_char(occurrence_date, 'YYYY-MM-DD') AS occurrence_date,
    user_id, email, name, phone, fields, status, order_id, created_at`;

export async function upsertRegistration(input: {
    eventId: string;
    occurrenceDate: string;
    userId?: string | null;
    email: string;
    name?: string | null;
    phone?: string | null;
    fields?: Record<string, unknown>;
},): Promise<import('@sitesurge/types').EventRegistration> {
    // Re-submitting the form updates rather than duplicating, and un-cancels a
    // previously cancelled registration — the person is telling us they're
    // coming after all.
    const res = await query(
        `INSERT INTO event_registrations
            (event_id, occurrence_date, user_id, email, name, phone, fields, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'registered')
         ON CONFLICT (event_id, occurrence_date, LOWER(email)) DO UPDATE
            SET name = COALESCE(EXCLUDED.name, event_registrations.name),
                phone = COALESCE(EXCLUDED.phone, event_registrations.phone),
                fields = EXCLUDED.fields,
                user_id = COALESCE(EXCLUDED.user_id, event_registrations.user_id),
                status = 'registered',
                updated_at = NOW()
         RETURNING ${REG_SELECT}`,
        [
            input.eventId, input.occurrenceDate, input.userId ?? null,
            input.email.toLowerCase(), input.name ?? null, input.phone ?? null,
            JSON.stringify(input.fields ?? {},),
        ],
    );
    return mapRow(res.rows[0],);
}

export async function countRegistrations(
    eventId: string,
    occurrenceDate: string,
): Promise<number> {
    const res = await query<{ count: number; }>(
        `SELECT COUNT(*)::int AS count FROM event_registrations
          WHERE event_id = $1 AND occurrence_date = $2 AND status = 'registered'`,
        [eventId, occurrenceDate,],
    );
    return Number(res.rows[0]?.count ?? 0,);
}

/** Paged attendee list for the admin table. */
export async function findRegistrations(
    eventId: string,
    occurrenceDate: string,
    pagination: { page?: number; limit?: number; } = {},
): Promise<{ data: import('@sitesurge/types').EventRegistration[]; total: number; }> {
    const page = Math.max(1, pagination.page ?? 1,);
    const limit = Math.min(200, Math.max(1, pagination.limit ?? 50,),);
    const countRes = await query<{ count: number; }>(
        `SELECT COUNT(*)::int AS count FROM event_registrations
          WHERE event_id = $1 AND occurrence_date = $2`,
        [eventId, occurrenceDate,],
    );
    const res = await query(
        `SELECT ${REG_SELECT} FROM event_registrations
          WHERE event_id = $1 AND occurrence_date = $2
          ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
        [eventId, occurrenceDate, limit, (page - 1) * limit,],
    );
    return {
        data: mapRows(res.rows,),
        total: Number(countRes.rows[0]?.count ?? 0,),
    };
}
