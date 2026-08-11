/**
 * Notification delivery channels.
 *
 * Each channel knows how to deliver a `NotificationMessage` to a list of
 * addresses. Only `email` is implemented today (via the transactional
 * `sendEmail` helper); `sms`/`push` are stubs that log and no-op so the
 * config surface can already offer them.
 *
 * A channel `send()` must NEVER throw — a delivery failure is logged and
 * swallowed so one bad recipient/channel can't break an event handler.
 */
import type { NotificationChannelId, } from '@sitesurge/types';
import { sendEmail, } from '../email';
import { logger, } from '../../utils/logger';

export interface NotificationMessage {
    subject: string;
    html?: string;
    text?: string;
}

export interface NotificationChannel {
    id: NotificationChannelId;
    send(addresses: string[], msg: NotificationMessage,): Promise<void>;
}

/** Email channel — one message per recipient via the transactional mailer. */
const emailChannel: NotificationChannel = {
    id: 'email',
    async send(addresses, msg,) {
        for (const to of addresses) {
            const address = to.trim();
            if (!address) continue;
            try {
                await sendEmail({
                    to: address,
                    subject: msg.subject,
                    html: msg.html ?? msg.text ?? '',
                    text: msg.text,
                },);
            } catch (err) {
                logger.error('Notification email failed', { error: err, to: address, },);
            }
        }
    },
};

/** SMS channel — not yet wired to a provider. */
const smsChannel: NotificationChannel = {
    id: 'sms',
    async send() {
        logger.info('SMS channel not configured',);
    },
};

/** Push channel — not yet wired to a provider. */
const pushChannel: NotificationChannel = {
    id: 'push',
    async send() {
        logger.info('push channel not configured',);
    },
};

export const CHANNELS: Record<NotificationChannelId, NotificationChannel> = {
    email: emailChannel,
    sms: smsChannel,
    push: pushChannel,
};
