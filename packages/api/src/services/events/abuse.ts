/**
 * Abuse limits for the public event writes that SEND EMAIL to an address the
 * caller types: register ("You're registered"), subscribe (the opt-in link),
 * free ticket claims. Without them the site was a free mail cannon from its
 * own sending domain. Redis counters shared across workers (the discussions
 * limiter); fail OPEN when Redis is down — a safety net, not access control.
 */
import { rateLimit, } from '../discussions/spam';

export type PublicEventWrite = 'register' | 'subscribe' | 'tickets';

/** Per IP and per target address; signed-in callers get a looser IP budget. */
export async function checkPublicWriteRate(
    kind: PublicEventWrite,
    opts: { ip?: string | null; email?: string | null; signedIn?: boolean; },
): Promise<void> {
    const ip = opts.ip || 'unknown';
    const perIp = opts.signedIn ? 30 : 8;
    await rateLimit(`events:${kind}:ip:${ip}`, perIp, 600,);
    if (opts.email) {
        // The same address can't be mailed over and over by anyone.
        await rateLimit(`events:${kind}:to:${opts.email.trim().toLowerCase()}`, 5, 3600,);
    }
}
