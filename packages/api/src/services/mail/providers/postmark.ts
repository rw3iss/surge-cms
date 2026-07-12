import type { OutboundMessage, } from '@sitesurge/types';
import { MailProvider, NotImplementedError, } from './types';

/** Native Postmark REST adapter. V1: stub. */
export class PostmarkMailProvider implements MailProvider {
    async send(_msg: OutboundMessage,): Promise<{ providerId?: string; }> {
        throw new NotImplementedError('Postmark',);
    }
    async verify(): Promise<boolean> { return false; }
}
