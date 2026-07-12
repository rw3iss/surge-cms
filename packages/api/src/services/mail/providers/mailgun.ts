import type { OutboundMessage, } from '@sitesurge/types';
import { MailProvider, NotImplementedError, } from './types';

/**
 * Native Mailgun REST adapter. V1: stub.
 *
 * When implemented, this should use Mailgun's `messages` endpoint
 * (https://documentation.mailgun.com/en/latest/api-sending.html) and
 * eventually subscribe to delivery / bounce / complaint webhooks so
 * the worker can mark recipients accordingly. SMTP via Nodemailer
 * covers Mailgun functionally today; this adapter exists for
 * webhook-driven bounce tracking later.
 */
export class MailgunMailProvider implements MailProvider {
    async send(_msg: OutboundMessage,): Promise<{ providerId?: string; }> {
        throw new NotImplementedError('Mailgun',);
    }
    async verify(): Promise<boolean> { return false; }
}
