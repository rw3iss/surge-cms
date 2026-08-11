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
import type { NotificationChannelId, NotificationSettings, } from '@sitesurge/types';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { CHANNELS, type NotificationMessage, } from './channels';

export type { NotificationMessage, } from './channels';

const CHANNEL_IDS: NotificationChannelId[] = ['email', 'sms', 'push',];

// Light in-process cache — settings change rarely and every event would
// otherwise re-read the row. Invalidated on settings update.
let cached: NotificationSettings | null = null;

/** Drop the cached notification settings (called after a settings write). */
export function invalidateNotificationSettings(): void {
    cached = null;
}

/** Read the stored notification settings. Returns `{}` on miss / parse error. */
export async function getNotificationSettings(): Promise<NotificationSettings> {
    if (cached) return cached;
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

        for (const channel of CHANNEL_IDS) {
            const channelConfig = typeConfig[channel];
            if (!channelConfig?.enabled) continue;
            const addresses = (channelConfig.addresses ?? []).map((a,) => a.trim()).filter(Boolean,);
            if (addresses.length === 0) continue;
            try {
                await CHANNELS[channel].send(addresses, msg,);
            } catch (err) {
                logger.error('Notification channel dispatch failed', {
                    error: err,
                    type: typeKey,
                    channel,
                },);
            }
        }
    } catch (err) {
        logger.error('notify() failed', { error: err, type: typeKey, },);
    }
}
