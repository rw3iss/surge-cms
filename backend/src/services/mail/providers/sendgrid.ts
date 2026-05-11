import type { OutboundMessage, } from '@rw/shared';
import { MailProvider, NotImplementedError, } from './types';

/** Native SendGrid REST adapter. V1: stub. */
export class SendgridMailProvider implements MailProvider {
    async send(_msg: OutboundMessage,): Promise<{ providerId?: string; }> {
        throw new NotImplementedError('SendGrid',);
    }
    async verify(): Promise<boolean> { return false; }
}
