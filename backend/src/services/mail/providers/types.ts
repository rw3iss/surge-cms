/**
 * MailProvider abstraction. Concrete impls: SMTP via Nodemailer
 * (default + the only fully-implemented one in V1) and stubbed
 * REST adapters for Mailgun / SendGrid / Postmark that throw
 * NotImplementedError until someone wants to wire up webhooks +
 * delivery-tracking features that SMTP can't expose.
 *
 * Switching providers is `MAIL_PROVIDER=<name>` in `.env` — no
 * code change.
 */
import type { OutboundMessage, } from '@rw/cms-shared';

export interface MailProvider {
    send(msg: OutboundMessage,): Promise<{ providerId?: string; }>;
    verify(): Promise<boolean>;
}

export class NotImplementedError extends Error {
    constructor(provider: string,) {
        super(`${provider}MailProvider: not implemented yet — use MAIL_PROVIDER=smtp for V1`,);
        this.name = 'NotImplementedError';
    }
}
