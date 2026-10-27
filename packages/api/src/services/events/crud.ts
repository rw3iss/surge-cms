/**
 * Event records: reads, writes and the validation around them.
 *
 * Publishing side-effects (announcing a new event) are fired here but IMPLEMENTED
 * in `notifications.ts` — this module decides *when* the world should hear about
 * an event, not *how* it is told.
 */
import { withFeaturedMedia, } from '../mediaRefs';
import type { CalendarEvent, CalendarEventInput, EventStatus, } from '@sitesurge/types';
import { generateSlug, } from '@sitesurge/types';
import crypto from 'crypto';
import { NotFoundError, ValidationError, } from '../../core/errors';
import * as repo from '../../repositories/events.repo';
import { logAudit, } from '../audit';
import type { AuditContext, ListResult, } from '../types';
import { notifyForEvent, } from './notifications';
import * as geo from '../geo';
import { accessFor, assertCanView, assertRule, filterViewable, } from './access';
import type { LevelViewer, } from '../access/level';

export interface ListOpts extends repo.EventFilters {
    page?: number;
    limit?: number;
    /** Staff see drafts; anonymous callers are pinned to `published`. */
    admin?: boolean;
    /** Non-admin reads drop events this viewer may not see (Settings → Events + the event's rule). */
    viewer?: LevelViewer;
}

// ─── Reads ────────────────────────────────────────────────────────

export async function list(opts: ListOpts = {},): Promise<ListResult<CalendarEvent>> {
    const { page = 1, limit = 100, admin, viewer, ...filters } = opts;
    // A non-admin must never see drafts, whatever `status` they asked for.
    const status = admin ? filters.status : 'published';
    const { data: rows, total, } = await repo.findEvents({ ...filters, status, }, { page, limit, },);
    // Access is filtered after the page read (rules are per-event + inherit),
    // so `total` can over-count gated events by at most this page's share.
    const data = admin ? rows : await filterViewable(rows, viewer,);
    return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit,), },
    };
}

export async function getByIdOrSlug(
    idOrSlug: string,
    /** `viewer` given (public reads): gate by view access and attach `access`. Omitted = internal read. */
    opts: { admin?: boolean; viewer?: LevelViewer; } = {},
): Promise<CalendarEvent> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug,);
    const found = isUuid ? await repo.findById(idOrSlug,) : await repo.findBySlug(idOrSlug,);
    if (!found) throw new NotFoundError('Event',);
    if (!opts.admin && found.status !== 'published') throw new NotFoundError('Event',);
    if (!opts.admin && 'viewer' in opts) {
        await assertCanView(found, opts.viewer,);
        return withFeaturedMedia({ ...found, access: await accessFor(found, opts.viewer,), },);
    }
    return withFeaturedMedia(found,);
}

// ─── Validation ───────────────────────────────────────────────────

function assertValid(input: Partial<CalendarEventInput>,): void {
    if (input.title !== undefined && !input.title.trim()) {
        throw new ValidationError('Title is required',);
    }
    if (input.startsAt !== undefined && Number.isNaN(Date.parse(input.startsAt,),)) {
        throw new ValidationError('startsAt must be a valid date',);
    }
    if (input.endsAt) {
        if (Number.isNaN(Date.parse(input.endsAt,),)) {
            throw new ValidationError('endsAt must be a valid date',);
        }
        if (input.startsAt && Date.parse(input.endsAt,) < Date.parse(input.startsAt,)) {
            throw new ValidationError('endsAt cannot be before startsAt',);
        }
    }
    // The map point is a pair: both or neither.
    if ((input.locationLat === null) !== (input.locationLng === null)
        || (input.locationLat === undefined) !== (input.locationLng === undefined)) {
        throw new ValidationError('The map point needs both a latitude and a longitude.',);
    }
}

/**
 * A registration form ALWAYS collects an email, whatever the caller asked for.
 *
 * The admin UI enforces this by disabling the `email` checkbox, but a direct
 * `PUT` could omit it — and then the public form would not collect an address
 * while `register()` still requires one, leaving a form that cannot be
 * submitted. The invariant belongs on the server, not in the checkbox.
 *
 * Order is preserved and duplicates are dropped, so an admin's chosen field
 * order survives; `email` is appended only when genuinely absent.
 */
export function normalizeRegistrationFields(fields: string[],): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of fields) {
        const f = (raw || '').trim();
        if (!f || seen.has(f.toLowerCase(),)) continue;
        seen.add(f.toLowerCase(),);
        out.push(f,);
    }
    if (!seen.has('email',)) out.push('email',);
    return out;
}

/**
 * A unique slug derived from the title, suffixed only if it collides.
 *
 * The first collision becomes `-1`, then `-2`, and so on: `events` has a UNIQUE
 * index on `slug`, so without this a second "Summer Gala" would be a 500 rather
 * than a saved event.
 *
 * The probe is capped. Past the cap a random suffix ends it — an unbounded loop
 * against the database is a worse failure than a slightly ugly URL, and only a
 * pathological catalogue reaches it.
 */
const SLUG_PROBE_LIMIT = 200;

async function uniqueSlug(base: string, exceptId?: string,): Promise<string> {
    const root = generateSlug(base,) || 'event';
    if (!(await repo.slugExists(root, exceptId,))) return root;

    for (let n = 1; n <= SLUG_PROBE_LIMIT; n += 1) {
        const candidate = `${root}-${n}`;
        if (!(await repo.slugExists(candidate, exceptId,))) return candidate;
    }
    return `${root}-${crypto.randomUUID().slice(0, 8,)}`;
}

/** `events.slug` is the only UNIQUE column on the table, so a 23505 here is a
 *  slug race and nothing else. */
function isSlugCollision(e: unknown,): boolean {
    return (e as { code?: string; }).code === '23505';
}

/** Re-probe and retry a write that lost a slug race. */
async function withSlugRetry<T>(write: () => Promise<T>, attempts = 3,): Promise<T> {
    for (let i = 1; ; i += 1) {
        try {
            return await write();
        } catch (e) {
            if (i >= attempts || !isSlugCollision(e,)) throw e;
        }
    }
}

// ─── Writes ───────────────────────────────────────────────────────

async function assertAccessInput(input: Partial<CalendarEventInput>,): Promise<void> {
    await assertRule(input.viewAccess, input.viewMinTierId, 'viewing this event',);
    await assertRule(input.registerAccess, input.registerMinTierId, 'registering',);
}

/**
 * The event shows a map but has only an address: find its point now, so the
 * event page can draw the map (the editor usually did already; this covers a
 * lookup that had not finished, the API and imports). Best-effort — a failed
 * lookup saves without a point and the page shows no map.
 */
export async function mapPointFor(
    showMap: boolean | undefined, location: string | null | undefined, lat: number | null | undefined,
): Promise<{ locationLat: number; locationLng: number; } | null> {
    if (!showMap || lat != null || !location?.trim()) return null;
    try {
        const [hit,] = await geo.search(location, 1,);
        return hit ? { locationLat: hit.lat, locationLng: hit.lng, } : null;
    } catch {
        return null;
    }
}

export async function create(
    input: CalendarEventInput,
    ctx: AuditContext,
): Promise<CalendarEvent> {
    assertValid(input,);
    await assertAccessInput(input,);
    if (!input.title?.trim()) throw new ValidationError('Title is required',);
    if (!input.startsAt) throw new ValidationError('startsAt is required',);
    const point = await mapPointFor(input.showMap, input.location, input.locationLat,);
    if (point) input = { ...input, ...point, };

    // Probe-then-insert is not atomic: two simultaneous saves can both find the
    // same suffix free. `slug` is UNIQUE, so the loser gets a constraint error —
    // re-probing and retrying turns a 500 into the next free suffix.
    const event = await withSlugRetry(async () => {
        const slug = await uniqueSlug(input.slug || input.title,);
        return repo.createEvent({
            ...input,
            slug,
            // Left undefined so the repository's own default applies.
            ...(input.registrationFields
                ? { registrationFields: normalizeRegistrationFields(input.registrationFields,), }
                : {}),
        }, ctx.userId,);
    },);

    await logAudit({
        userId: ctx.userId,
        action: 'create',
        entityType: 'event',
        entityId: event.id,
        newValues: { title: event.title, startsAt: event.startsAt, status: event.status, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    // Announce only once the event is actually visible to the public.
    if (event.status === 'published') void notifyForEvent(event, 'published',);
    return event;
}

export async function update(
    id: string,
    patch: Partial<CalendarEventInput>,
    ctx: AuditContext,
): Promise<CalendarEvent> {
    const existing = await repo.findById(id,);
    if (!existing) throw new NotFoundError('Event',);
    assertValid(patch,);
    await assertAccessInput(patch,);
    // A non-tier rule carries no tier.
    for (const [rule, tier,] of [['viewAccess', 'viewMinTierId',], ['registerAccess', 'registerMinTierId',],] as const) {
        if (patch[rule] !== undefined && patch[rule] !== 'tier') (patch as Record<string, unknown>)[tier] = null;
    }

    const point = await mapPointFor(
        patch.showMap ?? existing.showMap,
        patch.location !== undefined ? patch.location : existing.location,
        patch.locationLat !== undefined ? patch.locationLat : existing.locationLat,
    );
    if (point) patch = { ...patch, ...point, };

    const dbPatch: Record<string, unknown> = {};
    const map: Record<string, string> = {
        title: 'title', description: 'description', startsAt: 'startsAt',
        endsAt: 'endsAt', allDay: 'allDay', location: 'location', url: 'url',
        locationLat: 'locationLat', locationLng: 'locationLng', showMap: 'showMap',
        featuredImage: 'featuredImage', status: 'status', timezone: 'timezone',
        recurrenceRule: 'recurrenceRule', recurrenceUntil: 'recurrenceUntil',
        registrationEnabled: 'registrationEnabled',
        registrationFields: 'registrationFields',
        showRegistrantCount: 'showRegistrantCount',
        ticketingEnabled: 'ticketingEnabled', metadata: 'metadata',
        viewAccess: 'viewAccess', viewMinTierId: 'viewMinTierId',
        registerAccess: 'registerAccess', registerMinTierId: 'registerMinTierId',
    };
    for (const [key, col,] of Object.entries(map,)) {
        let v = (patch as Record<string, unknown>)[key];
        if (v === undefined) continue;
        if (col === 'registrationFields') {
            v = normalizeRegistrationFields(v as string[],);
        }
        // jsonb columns must be sent as JSON text, not a JS object/array.
        dbPatch[col] = (col === 'registrationFields' || col === 'metadata')
            ? JSON.stringify(v,)
            : v;
    }
    // Renaming into a taken slug de-duplicates the same way a create does, and
    // re-probes if it loses the race. `exceptId` keeps an event from colliding
    // with itself.
    const updated = await withSlugRetry(async () => {
        if (patch.slug && patch.slug !== existing.slug) {
            dbPatch.slug = await uniqueSlug(patch.slug, id,);
        }
        return repo.updateEvent(id, dbPatch,);
    },);
    if (!updated) throw new NotFoundError('Event',);

    await logAudit({
        userId: ctx.userId,
        action: 'update',
        entityType: 'event',
        entityId: id,
        newValues: dbPatch,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);

    // Draft → published is the moment the event becomes announceable.
    if (existing.status !== 'published' && updated.status === 'published') {
        void notifyForEvent(updated, 'published',);
    }
    return updated;
}

export async function remove(id: string, ctx: AuditContext,): Promise<void> {
    const existing = await repo.findById(id,);
    if (!existing) throw new NotFoundError('Event',);
    await repo.deleteEvent(id,);
    await logAudit({
        userId: ctx.userId,
        action: 'delete',
        entityType: 'event',
        entityId: id,
        oldValues: { title: existing.title, },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
    },);
}

export type { CalendarEvent, EventStatus, };
