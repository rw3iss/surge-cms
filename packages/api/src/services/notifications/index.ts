/**
 * Notifications service — dispatch admin notifications for site events.
 *
 * An operator configures, per notification type, which channels are
 * enabled and their recipient addresses (Settings → Notifications,
 * persisted to the `notifications` `site_settings` row). Event handlers
 * call `notify(typeKey, msg)` fire-and-forget; the service loads the
 * config and fans out to every enabled channel with recipients.
 *
 * `notify()` NEVER throws — it's an additive side-channel, so a failure
 * to notify must never break the originating request.
 */
import type { NotificationSettings, } from '@sitesurge/types';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { CHANNELS, shortForm, type NotificationMessage, } from './channels';
import * as inApp from './inApp';
import * as push from './push';
import { getNotificationOptions, } from './options';

export type { NotificationMessage, } from './channels';
export {
    absoluteUrl, buildNotification, formatDay, notifyUser, personLabel, renderNotification, siteBaseUrl, subscriptionStatusLabel,
} from './format';
export type { NotificationSpec, NotifyLink, NotifyPerson, NotifyRow, NotifySection, } from './format';


// Light in-process cache — settings change rarely and every event would
// otherwise re-read the row. Invalidated on settings update on THIS process;
// the short TTL bounds how long OTHER workers (CLUSTER_WORKERS > 1) keep old
// recipients — before, a removed admin kept getting member PII until restart.
export const NOTIFICATION_SETTINGS_TTL_MS = 30_000;
let cached: NotificationSettings | null = null;
let cachedAt = 0;

/** Drop the cached notification settings (called after a settings write). */
export function invalidateNotificationSettings(): void {
    cached = null;
}

/** Read the stored notification settings. Returns `{}` on miss / parse error. */
export async function getNotificationSettings(): Promise<NotificationSettings> {
    if (cached && Date.now() - cachedAt < NOTIFICATION_SETTINGS_TTL_MS) return cached;
    cached = null;
    cachedAt = Date.now();
    try {
        const result = await query<{ value: unknown; }>(
            `SELECT value FROM site_settings WHERE key = 'notifications'`,
        );
        if (result.rows.length === 0) {
            cached = {};
            return cached;
        }
        const raw = result.rows[0].value;
        const parsed = typeof raw === 'string' ? JSON.parse(raw,) : raw;
        cached = (parsed && typeof parsed === 'object') ? parsed as NotificationSettings : {};
        return cached;
    } catch (err) {
        logger.error('Failed to load notification settings', { error: err, },);
        return {};
    }
}

/**
 * Dispatch a notification for `typeKey` to every enabled channel that has
 * recipients configured. Fire-and-forget: callers do `void notify(...)`.
 * No-op when the type has no config or every channel is disabled/empty.
 * NEVER throws.
 */
export async function notify(typeKey: string, msg: NotificationMessage,): Promise<void> {
    try {
        const settings = await getNotificationSettings();
        const typeConfig = settings[typeKey];
        if (!typeConfig) return;

        // Address channels: email, SMS.
        for (const channel of ['email', 'sms',] as const) {
            const channelConfig = typeConfig[channel];
            if (!channelConfig?.enabled) continue;
            const addresses = (channelConfig.addresses ?? []).map((a,) => a.trim()).filter(Boolean,);
            if (addresses.length === 0) continue;
            try {
                await CHANNELS[channel].send(addresses, msg,);
            } catch (err) {
                logger.error('Notification channel dispatch failed', { error: err, type: typeKey, channel, },);
            }
        }

        // User channels: in-app (+ desktop push to the same users).
        if (typeConfig.inApp?.enabled && (await getNotificationOptions()).inAppEnabled) {
            try {
                const userIds = await inApp.recipientsFor(typeConfig.inApp,);
                const f = shortForm(msg,);
                await inApp.createFor(userIds, { type: typeKey, ...f, },);
                if (typeConfig.push?.enabled) await push.sendTo(userIds, { ...f, tag: typeKey, },);
            } catch (err) {
                logger.error('In-app notification failed', { error: err, type: typeKey, },);
            }
        }
    } catch (err) {
        logger.error('notify() failed', { error: err, type: typeKey, },);
    }
}

/** True when at least one channel of `typeKey` would deliver to someone. */
export async function hasRecipients(typeKey: string,): Promise<boolean> {
    const cfg = (await getNotificationSettings())[typeKey];
    if (!cfg) return false;
    const addr = (['email', 'sms',] as const).some((c,) => cfg[c]?.enabled && (cfg[c]?.addresses ?? []).some((a,) => a.trim(),),);
    if (addr) return true;
    const ia = cfg.inApp;
    return Boolean(ia?.enabled && ((ia.userIds ?? []).length || (ia.roles ?? []).length) && (await getNotificationOptions()).inAppEnabled,);
}

/**
 * Build a message lazily, then `notify()`. The builder may load the person,
 * plans, settings… — when it throws, the error is logged and `fallback`
 * (if any) is sent instead, so a lookup failure never loses the alert.
 * NEVER throws; callers `void notifyWith(...)`.
 */
export async function notifyWith(
    typeKey: string,
    build: () => Promise<NotificationMessage>,
    fallback?: NotificationMessage,
): Promise<void> {
    let msg: NotificationMessage | undefined;
    try {
        // Skip the lookups when nobody receives this type.
        if (!await hasRecipients(typeKey,)) return;
        msg = await build();
    } catch (err) {
        logger.error('Notification build failed', { error: err, type: typeKey, },);
        msg = fallback;
    }
    if (msg) await notify(typeKey, msg,);
}
