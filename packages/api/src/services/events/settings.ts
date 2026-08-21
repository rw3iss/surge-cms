/**
 * Events feature settings.
 *
 * Kept separate from the event records themselves because these are SITE-level
 * switches (is registration allowed at all, where does the calendar live) that
 * every other events module reads but none of them owns.
 */
import type { EventsSettings, } from '@sitesurge/types';
import { DEFAULT_EVENTS_SETTINGS, RESERVED_EVENT_PATHS, } from '@sitesurge/types';
import { config, } from '../../config';
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import * as settingsService from '../settings';
import { isFeatureEnabledServer, } from '../settings';
import type { AuditContext, } from '../types';

export const SETTINGS_KEY = 'events';

export async function getSettings(): Promise<EventsSettings> {
    const raw = await settingsService.get<Partial<EventsSettings>>(SETTINGS_KEY,);
    return { ...DEFAULT_EVENTS_SETTINGS, ...(raw ?? {}), };
}

export async function updateSettings(
    patch: Partial<EventsSettings>,
    ctx: AuditContext,
): Promise<EventsSettings> {
    const next = { ...(await getSettings()), ...patch, };

    // Selling a ticket to an anonymous buyer is meaningless — you need to know
    // who is coming. Rather than let the two settings contradict, ticketing
    // forces registration on.
    if (next.allowTicketing) next.allowRegistration = true;

    if (patch.eventsUrl !== undefined) {
        next.eventsUrl = await validateEventsUrl(patch.eventsUrl,);
    }
    if (patch.allowTicketing && !(await isFeatureEnabledServer('shop',))) {
        throw new ValidationError(
            'Paid tickets are checked out through the Shop. Enable the Shop feature '
            + '(and configure payments) before turning on event ticketing.',
        );
    }
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
        eventsUrl: s.eventsUrl,
        allowRegistration: s.allowRegistration,
        allowTicketing: s.allowTicketing,
        vapidPublicKey: config.webPush.publicKey || s.vapidPublicKey,
    };
}

/**
 * Normalise and validate the public calendar path.
 *
 * Rejects anything that would shadow a real page or a built-in route — a
 * calendar mounted at `/shop` would silently break the storefront, and that
 * failure is very hard to diagnose after the fact.
 */
async function validateEventsUrl(raw: string,): Promise<string> {
    const url = `/${(raw || '').trim().replace(/^\/+|\/+$/g, '',)}`;
    if (url === '/') throw new ValidationError('The events URL cannot be the site root.',);
    if (!/^\/[a-z0-9-]+$/i.test(url,)) {
        throw new ValidationError('The events URL must be a single path segment, e.g. /events.',);
    }
    if (RESERVED_EVENT_PATHS.includes(url.toLowerCase(),) && url.toLowerCase() !== '/events') {
        throw new ValidationError(`${url} is a reserved route and cannot be used.`,);
    }
    const slug = url.slice(1,);
    const clash = await query<{ id: string; }>(
        `SELECT id FROM pages WHERE slug = $1 AND status <> 'deleted' LIMIT 1`, [slug,],
    ).catch(() => null,);
    if (clash?.rowCount) {
        throw new ValidationError(`A page already exists at ${url}. Choose another path.`,);
    }
    return url;
}
