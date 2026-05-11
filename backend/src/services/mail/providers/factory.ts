/**
 * Provider factory. Reads `MAIL_PROVIDER` env (default `smtp`) and
 * returns a cached singleton. `_resetProviderForTest()` exists for
 * unit tests that need to swap providers between cases.
 */
import { config, } from '../../../config';
import type { MailProvider, } from './types';
import { SmtpMailProvider, } from './smtp';
import { MailgunMailProvider, } from './mailgun';
import { SendgridMailProvider, } from './sendgrid';
import { PostmarkMailProvider, } from './postmark';

let instance: MailProvider | null = null;

export function getProvider(): MailProvider {
    if (instance) return instance;
    switch (config.mail.provider) {
        case 'mailgun':  instance = new MailgunMailProvider(); break;
        case 'sendgrid': instance = new SendgridMailProvider(); break;
        case 'postmark': instance = new PostmarkMailProvider(); break;
        case 'smtp':
        default:         instance = new SmtpMailProvider();
    }
    return instance;
}

export function _resetProviderForTest(): void { instance = null; }
