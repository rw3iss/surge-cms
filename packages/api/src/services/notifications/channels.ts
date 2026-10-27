/**
 * Notification delivery channels for ADDRESSES (email, SMS). The in-app and
 * desktop channels resolve USERS instead and are dispatched by `notify()`
 * (./inApp, ./push).
 *
 * A channel `send()` must NEVER throw — a delivery failure is logged and
 * swallowed so one bad recipient/channel can't break an event handler.
 */
import { sendEmail, } from '../email';
import { sendPurposeMail, } from '../mail/purposes';
import { logger, } from '../../utils/logger';

export interface NotificationMessage {
    subject: string;
    html?: string;
    text?: string;
    /** Short title for in-app / desktop / SMS (default: `subject`). */
    title?: string;
    /** One or two sentences for in-app / desktop (default: the start of `text`). */
    body?: string;
    /** Where acting on it goes — a site path or absolute URL (in-app click, desktop click, SMS link). */
    url?: string;
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
    id: 'email' | 'sms';
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

/** The short form used by in-app, desktop and SMS. */
export function shortForm(msg: NotificationMessage,): { title: string; body: string | null; url: string | null; } {
    const body = msg.body ?? (msg.text ? msg.text.replace(/\s+/g, ' ',).trim().slice(0, 280,) : null);
    return { title: msg.title ?? msg.subject, body: body || null, url: msg.url ?? null, };
}

/** SMS channel — the configured provider (Settings → Notifications → SMS). */
const smsChannel: NotificationChannel = {
    id: 'sms',
    async send(addresses, msg,) {
        const { sendSms, } = await import('./sms.js');
        const f = shortForm(msg,);
        await sendSms(addresses, f.url ? `${f.title}\n${f.url}` : f.title,);
    },
};

/** Address channels; `inApp` + `push` are user-based (see notify()). */
export const CHANNELS: Record<'email' | 'sms', NotificationChannel> = {
    email: emailChannel,
    sms: smsChannel,
};
