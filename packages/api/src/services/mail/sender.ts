/**
 * Who an email is from.
 *
 * Three layers, most specific first:
 *   1. the feature's own sender (events settings, a mailing list, a caller);
 *   2. the site default — Settings → General → E-mail and Contact
 *      (`email_defaults`);
 *   3. the server's `EMAIL_FROM`, which may be a bare address or
 *      `Name <address>`.
 *
 * Name and address resolve INDEPENDENTLY: a feature that sets only a name
 * still sends from the site's address, since an address the mail provider
 * is not allowed to send from would bounce every message.
 */
import type { EmailDefaults, } from '@sitesurge/types';
import { config, } from '../../config';
import { logger, } from '../../utils/logger';
import * as settings from '../settings';

export const EMAIL_DEFAULTS_KEY = 'email_defaults';

export interface Sender {
    fromName?: string;
    fromEmail: string;
}

/** `"Name" <a@b>` / `Name <a@b>` / `a@b` → parts. */
export function parseAddress(raw: string | undefined,): { name?: string; email?: string; } {
    const s = (raw ?? '').trim();
    if (!s) return {};
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s,);
    if (m) return { name: m[1].trim() || undefined, email: m[2].trim(), };
    return { email: s, };
}

const clean = (v: unknown,) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export async function siteEmailDefaults(): Promise<EmailDefaults> {
    try {
        return (await settings.get<EmailDefaults>(EMAIL_DEFAULTS_KEY,)) ?? {};
    } catch (err) {
        // A settings read must never stop an email going out.
        logger.warn('email defaults unavailable; using EMAIL_FROM', { error: (err as Error).message, },);
        return {};
    }
}

export async function resolveSender(override: { fromName?: string; fromEmail?: string; } = {},): Promise<Sender> {
    const site = await siteEmailDefaults();
    const env = parseAddress(config.email.from,);
    return {
        fromName: clean(override.fromName,) ?? clean(site.fromName,) ?? env.name,
        fromEmail: clean(override.fromEmail,) ?? clean(site.fromAddress,) ?? env.email ?? 'no-reply@example.com',
    };
}
