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
import { sendPurposeMail, } from '../mail/purposes';
import { logger, } from '../../utils/logger';

export interface NotificationMessage {
    subject: string;
    html?: string;
    text?: string;
    /**
     * Mail-purpose key. When set, the EMAIL channel renders through the purpose
     * pipeline instead of using `subject`/`html` directly — so the operator's
     * template and enable toggle apply, while `notify()` keeps doing what it is
     * good at: resolving WHO gets it from Settings → Notifications.
     *
     * `subject`/`html` remain the fallback body, so an alert still looks right
     * before anyone customises it.
     */
    purpose?: string;
    /** Variables for the purpose template. Ignored without `purpose`. */
    context?: Record<string, unknown>;
}

export interface NotificationChannel {
    id: NotificationChannelId;
    send(addresses: string[], msg: NotificationMessage,): Promise<void>;
}

/** Email channel — one message per recipient via the transactional mailer. */
const emailChannel: NotificationChannel = {
    id: 'email',
    async send(addresses, msg,) {
        // Purpose-backed alerts go through the shared pipeline so the operator's
        // template applies. sendPurposeMail already sends one message per
        // recipient and never throws, so the loop below isn't needed.
        if (msg.purpose) {
            await sendPurposeMail(msg.purpose, {
                to: addresses,
                context: msg.context,
                defaultSubject: msg.subject,
                defaultHtml: msg.html ?? msg.text ?? '',
            },);
            return;
        }

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
