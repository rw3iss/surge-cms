/**
 * Token-based unsubscribe. Each subscriber gets a stable HMAC token at
 * insert time (`mailing_list_subscribers.unsubscribe_token`); outbound
 * mail includes a `{{unsubscribe_url}}` variable that resolves to
 * `/u/<token>` plus a `List-Unsubscribe` header. The public route
 * verifies the HMAC and flips the subscriber to `unsubscribed`.
 *
 * Tokens are intentionally stable (not one-shot) so old emails keep
 * working — and unsubscribing requires no session.
 */
import { createHmac, } from 'crypto';
import { config, } from '../../config';

function secret(): string {
    const s = config.mail.unsubscribeSecret;
    if (!s) {
        throw new Error(
            'MAIL_UNSUBSCRIBE_SECRET (or JWT_SECRET fallback) is required to generate unsubscribe tokens',
        );
    }
    return s;
}

export function generateUnsubscribeToken(subscriberId: string, listId: string,): string {
    const sig = createHmac('sha256', secret(),)
        .update(`${subscriberId}:${listId}`,)
        .digest('base64url',);
    return `${subscriberId}.${listId}.${sig}`;
}

export interface VerifiedToken { subscriberId: string; listId: string; }

export function verifyUnsubscribeToken(token: string,): VerifiedToken | null {
    const parts = token.split('.',);
    if (parts.length !== 3) return null;
    const [subscriberId, listId, sig,] = parts;
    const expected = createHmac('sha256', secret(),)
        .update(`${subscriberId}:${listId}`,)
        .digest('base64url',);
    // Constant-time-ish comparison via length + char-wise XOR sum;
    // bytewise equality is sufficient since base64url strings of the
    // same content always compare identically.
    if (sig.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i,) ^ expected.charCodeAt(i,);
    if (diff !== 0) return null;
    return { subscriberId, listId, };
}
