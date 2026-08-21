/**
 * Outbound event notifications: email and Web Push.
 *
 * Dispatch is deliberately best-effort and idempotent: a send is claimed in
 * `event_notifications_sent` BEFORE the message goes out, so a restart
 * mid-batch (or two workers racing) can never mail the same person the same
 * thing twice. A failed send is logged, not retried in-process — the reminder
 * sweep will not re-attempt it, which is the right trade for a notification: a
 * duplicate is worse than a miss.
 *
 * This module deliberately knows nothing about who *signs up* (see
 * `subscriptions.ts`) — keeping the two apart is what lets event CRUD announce
 * a publish without a circular import back through the sign-up path.
 */
import type { CalendarEvent, } from '@sitesurge/types';
import { config, } from '../../config';
import * as repo from '../../repositories/events.repo';
import { logger, } from '../../utils/logger';
import { sendEmail, } from '../email';
import { escapeHtml, eventUrl, formatWhen, } from './format';
import { getSettings, } from './settings';

export type NotifyKind = 'published' | 'reminder';

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
