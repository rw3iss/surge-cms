/**
 * Events & calendar service — business rules for the `events` feature.
 *
 * Notification dispatch is deliberately best-effort and idempotent: a send is
 * claimed in `event_notifications_sent` BEFORE the message goes out, so a
 * restart mid-batch (or two workers racing) can never mail the same person the
 * same thing twice. A failed send is logged, not retried in-process — the
 * reminder sweep will not re-attempt it, which is the right trade for a
 * notification: a duplicate is worse than a miss.
 */
import type {
    CalendarEvent,
    CalendarEventInput,
    EventsSettings,
    EventStatus,
    EventSubscriber,
} from '@sitesurge/types';
import { DEFAULT_EVENTS_SETTINGS, generateSlug, isValidEmail, } from '@sitesurge/types';
import crypto from 'crypto';
import { config, } from '../config';
import { NotFoundError, ValidationError, } from '../core/errors';
import * as repo from '../repositories/events.repo';
import { logAudit, } from './audit';
import { sendEmail, } from './email';
import * as settingsService from './settings';
import { logger, } from '../utils/logger';
import type { AuditContext, ListResult, } from './types';

const SETTINGS_KEY = 'events';

// ─── Settings ─────────────────────────────────────────────────────

export async function getSettings(): Promise<EventsSettings> {
    const raw = await settingsService.get<Partial<EventsSettings>>(SETTINGS_KEY,);
    return { ...DEFAULT_EVENTS_SETTINGS, ...(raw ?? {}), };
}

export async function updateSettings(
    patch: Partial<EventsSettings>,
    ctx: AuditContext,
): Promise<EventsSettings> {
    const next = { ...(await getSettings()), ...patch, };
    // settingsService.set() already audit-logs and busts the settings cache.
    await settingsService.set(SETTINGS_KEY, next, ctx,);
    return next;
}

/** The public subset — never leak the VAPID PRIVATE key. */
export async function getPublicSettings(): Promise<EventsSettings> {
    const s = await getSettings();
    return {
        notifyOnPublish: s.notifyOnPublish,
        reminderHoursBefore: s.reminderHoursBefore,
        vapidPublicKey: config.webPush.publicKey || s.vapidPublicKey,
    };
}

// ─── Reads ────────────────────────────────────────────────────────

export interface ListOpts extends repo.EventFilters {
    page?: number;
    limit?: number;
    /** Staff see drafts; anonymous callers are pinned to `published`. */
    admin?: boolean;
}

export async function list(opts: ListOpts = {},): Promise<ListResult<CalendarEvent>> {
    const { page = 1, limit = 100, admin, ...filters } = opts;
    // A non-admin must never see drafts, whatever `status` they asked for.
    const status = admin ? filters.status : 'published';
    const { data, total, } = await repo.findEvents({ ...filters, status, }, { page, limit, },);
    return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit,), },
    };
}

export async function getByIdOrSlug(
    idOrSlug: string,
    opts: { admin?: boolean; } = {},
): Promise<CalendarEvent> {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug,);
    const found = isUuid ? await repo.findById(idOrSlug,) : await repo.findBySlug(idOrSlug,);
    if (!found) throw new NotFoundError('Event',);
    if (!opts.admin && found.status !== 'published') throw new NotFoundError('Event',);
    return found;
}

// ─── Writes ───────────────────────────────────────────────────────

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
}

/** A unique slug derived from the title, suffixed only if it collides. */
async function uniqueSlug(base: string, exceptId?: string,): Promise<string> {
    const root = generateSlug(base,) || 'event';
    let candidate = root;
    let n = 1;
    while (await repo.slugExists(candidate, exceptId,)) {
        n += 1;
        candidate = `${root}-${n}`;
    }
    return candidate;
}

export async function create(
    input: CalendarEventInput,
    ctx: AuditContext,
): Promise<CalendarEvent> {
    assertValid(input,);
    if (!input.title?.trim()) throw new ValidationError('Title is required',);
    if (!input.startsAt) throw new ValidationError('startsAt is required',);

    const slug = await uniqueSlug(input.slug || input.title,);
    const event = await repo.createEvent({ ...input, slug, }, ctx.userId,);

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

    const dbPatch: Record<string, unknown> = {};
    const map: Record<string, string> = {
        title: 'title', description: 'description', startsAt: 'startsAt',
        endsAt: 'endsAt', allDay: 'allDay', location: 'location', url: 'url',
        featuredImage: 'featuredImage', status: 'status',
    };
    for (const [key, col,] of Object.entries(map,)) {
        const v = (patch as Record<string, unknown>)[key];
        if (v !== undefined) dbPatch[col] = v;
    }
    if (patch.slug && patch.slug !== existing.slug) {
        dbPatch.slug = await uniqueSlug(patch.slug, id,);
    }

    const updated = await repo.updateEvent(id, dbPatch,);
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

// ─── Subscriptions ────────────────────────────────────────────────

function unsubscribeToken(email: string, eventId?: string | null,): string {
    const secret = config.mail.unsubscribeSecret || 'events';
    const payload = `${email.toLowerCase()}:${eventId ?? 'all'}`;
    const sig = crypto.createHmac('sha256', secret,).update(payload,).digest('base64url',);
    return `${Buffer.from(payload,).toString('base64url',)}.${sig}`;
}

export async function subscribe(input: {
    email: string;
    eventId?: string;
    notifyEmail?: boolean;
    notifyPush?: boolean;
    userId?: string;
},): Promise<EventSubscriber> {
    const email = (input.email || '').trim();
    if (!isValidEmail(email,)) throw new ValidationError('A valid email address is required',);
    // Subscribing to a specific event requires that event to exist, or the row
    // would dangle and the person would never hear anything.
    if (input.eventId) await getByIdOrSlug(input.eventId,);

    return repo.upsertSubscriber({
        eventId: input.eventId ?? null,
        userId: input.userId ?? null,
        email,
        notifyEmail: input.notifyEmail ?? true,
        notifyPush: input.notifyPush ?? false,
        unsubscribeToken: unsubscribeToken(email, input.eventId,),
    },);
}

export async function unsubscribe(token: string,): Promise<boolean> {
    if (!token) return false;
    return repo.deleteSubscriberByToken(token,);
}

export async function registerPushEndpoint(input: {
    endpoint: string;
    p256dh: string;
    auth: string;
    email?: string;
    userId?: string;
    userAgent?: string;
},): Promise<{ subscribed: boolean; pushEnabled: boolean; }> {
    if (!input.endpoint || !input.p256dh || !input.auth) {
        throw new ValidationError('A complete push subscription is required',);
    }
    await repo.upsertPushSubscription({
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        email: input.email ?? null,
        userId: input.userId ?? null,
        userAgent: input.userAgent ?? null,
    },);
    return { subscribed: true, pushEnabled: Boolean(config.webPush.privateKey,), };
}

// ─── Notification dispatch ────────────────────────────────────────

export type NotifyKind = 'published' | 'reminder';

function formatWhen(event: CalendarEvent,): string {
    const d = new Date(event.startsAt,);
    return event.allDay
        ? d.toLocaleDateString('en-US', { dateStyle: 'full', },)
        : d.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short', },);
}

function eventUrl(event: CalendarEvent,): string {
    return `${config.frontendUrl.replace(/\/+$/, '',)}/events/${event.slug}`;
}

function buildEmail(event: CalendarEvent, kind: NotifyKind,): { subject: string; html: string; } {
    const when = formatWhen(event,);
    const url = eventUrl(event,);
    const lead = kind === 'reminder' ? 'Coming up soon' : 'New event';
    const subject = kind === 'reminder'
        ? `Reminder: ${event.title} — ${when}`
        : `New event: ${event.title}`;
    const html = `
        <h2 style="margin:0 0 8px">${lead}: ${escapeHtml(event.title,)}</h2>
        <p style="margin:0 0 4px"><strong>When:</strong> ${escapeHtml(when,)}</p>
        ${event.location ? `<p style="margin:0 0 4px"><strong>Where:</strong> ${escapeHtml(event.location,)}</p>` : ''}
        ${event.description ? `<p style="margin:12px 0">${escapeHtml(event.description,)}</p>` : ''}
        <p style="margin:16px 0"><a href="${url}">View the event</a></p>
    `.trim();
    return { subject, html, };
}

function escapeHtml(s: string,): string {
    return s.replace(/&/g, '&amp;',).replace(/</g, '&lt;',).replace(/>/g, '&gt;',)
        .replace(/"/g, '&quot;',);
}

/**
 * Notify everyone subscribed to this event (or to all events).
 *
 * Never throws — a notification failure must not fail the admin's save. Each
 * recipient/channel pair is claimed first, so this is safe to call twice.
 */
export async function notifyForEvent(event: CalendarEvent, kind: NotifyKind,): Promise<void> {
    try {
        const settings = await getSettings();
        if (kind === 'published' && !settings.notifyOnPublish) return;

        const recipients = await repo.findRecipientsForEvent(event.id,);
        if (recipients.length === 0) return;

        const { subject, html, } = buildEmail(event, kind,);

        // ── Email ──
        for (const r of recipients.filter((x,) => x.notifyEmail)) {
            if (!(await repo.claimNotification(event.id, kind, 'email', r.email,))) continue;
            try {
                await sendEmail({ to: r.email, subject, html, },);
            } catch (e) {
                logger.warn('event notification: email failed', {
                    event: event.id, to: r.email, error: (e as Error).message,
                },);
            }
        }

        // ── Web Push (desktop) ──
        const pushEmails = recipients.filter((x,) => x.notifyPush).map((x,) => x.email);
        if (pushEmails.length) await sendPush(event, kind, pushEmails, subject,);
    } catch (e) {
        logger.warn('event notification dispatch failed', {
            event: event.id, error: (e as Error).message,
        },);
    }
}

/**
 * Web Push fan-out. Requires VAPID keys (WEB_PUSH_PUBLIC_KEY /
 * WEB_PUSH_PRIVATE_KEY); without them push is simply skipped so the module
 * still works email-only. `web-push` is imported lazily so the dependency is
 * only loaded when the feature is actually used.
 */
async function sendPush(
    event: CalendarEvent,
    kind: NotifyKind,
    emails: string[],
    title: string,
): Promise<void> {
    const pub = config.webPush.publicKey;
    const priv = config.webPush.privateKey;
    if (!pub || !priv) {
        logger.debug?.('event push skipped: no VAPID keys configured',);
        return;
    }

    // `web-push` is an OPTIONAL dependency: resolved at runtime and typed
    // loosely on purpose, so the module compiles and runs email-only on installs
    // that never added it. Install it (and set the VAPID env vars) to enable
    // desktop notifications.
    interface WebPushLike {
        setVapidDetails(subject: string, pub: string, priv: string,): void;
        sendNotification(
            sub: { endpoint: string; keys: { p256dh: string; auth: string; }; },
            payload: string,
        ): Promise<unknown>;
    }
    let webpush: WebPushLike;
    try {
        // The specifier is held in a variable so TypeScript does not try to
        // resolve an optional dependency that may not be installed.
        const specifier = 'web-push';
        const mod = (await import(specifier)) as unknown as
            { default?: WebPushLike; } & WebPushLike;
        webpush = mod.default ?? mod;
    } catch {
        logger.warn('event push skipped: the optional `web-push` package is not installed',);
        return;
    }
    webpush.setVapidDetails(
        config.webPush.subject || `mailto:${config.email.from || 'admin@example.com'}`,
        pub,
        priv,
    );

    const endpoints = await repo.findPushEndpointsForEmails(emails,);
    const payload = JSON.stringify({
        title,
        body: formatWhen(event,),
        url: eventUrl(event,),
        tag: `event-${event.id}-${kind}`,
    },);

    for (const ep of endpoints) {
        if (!(await repo.claimNotification(event.id, kind, 'push', ep.endpoint,))) continue;
        try {
            await webpush.sendNotification(
                { endpoint: ep.endpoint, keys: { p256dh: ep.p256dh, auth: ep.auth, }, },
                payload,
            );
        } catch (e) {
            const status = (e as { statusCode?: number; }).statusCode;
            // 404/410 mean the browser dropped the subscription — prune it, or
            // it is retried forever.
            if (status === 404 || status === 410) {
                await repo.deletePushSubscription(ep.endpoint,);
            } else {
                logger.warn('event push failed', { endpoint: ep.endpoint, status, },);
            }
        }
    }
}

/**
 * Reminder sweep — call from the scheduler. Idempotent via the ledger, so
 * running it every 15 minutes sends each reminder exactly once.
 */
export async function runReminderSweep(): Promise<{ checked: number; }> {
    const settings = await getSettings();
    if (!settings.reminderHoursBefore || settings.reminderHoursBefore <= 0) {
        return { checked: 0, };
    }
    const due = await repo.findEventsNeedingReminder(settings.reminderHoursBefore,);
    for (const event of due) await notifyForEvent(event, 'reminder',);
    return { checked: due.length, };
}

export type { CalendarEvent, EventStatus, };
