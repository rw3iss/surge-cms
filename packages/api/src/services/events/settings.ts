/**
 * Events feature settings.
 *
 * Kept separate from the event records themselves because these are SITE-level
 * switches (is registration allowed at all, where does the calendar live) that
 * every other events module reads but none of them owns.
 */
import type { EventsSettings, } from '@sitesurge/types';
import { DEFAULT_EVENTS_SETTINGS, } from '@sitesurge/types';
import { validatePublicBasePath, } from '../access/publicPath';
import { config, } from '../../config';
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { tiersById, } from '../postGate';
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
    // Access defaults: a `tier` rule needs a real tier; other rules carry none.
    const tiers = await tiersById();
    for (const [rule, tierKey, label,] of [['viewAccess', 'viewMinTierId', 'viewing events',], ['registerAccess', 'registerMinTierId', 'registering',],] as const) {
        if (!['public', 'members', 'tier',].includes(next[rule],)) throw new ValidationError(`Unknown access rule for ${label}.`,);
        if (next[rule] === 'tier') {
            if (!next[tierKey] || !tiers.has(next[tierKey]!,)) throw new ValidationError(`Choose the subscription tier required for ${label}.`,);
        } else {
            next[tierKey] = null;
        }
    }
    if (patch.allowTicketing && !(await isFeatureEnabledServer('shop',))) {
        throw new ValidationError(
            'Paid tickets are checked out through the Shop. Enable the Shop feature ' +
                '(and configure payments) before turning on event ticketing.',
        );
    }
    // settingsService.set() already audit-logs and busts the settings cache.
    await settingsService.set(SETTINGS_KEY, next, ctx,);
    return next;
}

/**
 * Sender for events emails. Empty fields are left undefined so `sendEmail`
 * falls through to the site default sender, then EMAIL_FROM.
 */
export async function eventSender(): Promise<{ fromName?: string; fromEmail?: string; }> {
    try {
        const s = await getSettings();
        return {
            fromName: s.fromName?.trim() || undefined,
            fromEmail: s.fromAddress?.trim() || undefined,
        };
    } catch {
        return {};
    }
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
        viewAccess: s.viewAccess,
        viewMinTierId: s.viewMinTierId,
        registerAccess: s.registerAccess,
        registerMinTierId: s.registerMinTierId,
    };
}

/** Normalise and validate the public calendar path (shared rule). */
function validateEventsUrl(raw: string,): Promise<string> {
    return validatePublicBasePath(raw, { label: 'events', ownDefault: '/events', },);
}
