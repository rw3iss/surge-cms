/**
 * Live-room tickets: the `token` every live command carries.
 *
 * The session cookie is httpOnly, so page JS cannot attach the JWT to a socket
 * message. Instead `POST /posts/:id/live/ticket` hands out a short-lived,
 * stateless HMAC ticket bound to ONE post and ONE user (or `anon`):
 *
 *   `<expUnix>.<userId|anon>.<HMAC(live-ticket:postId:userId:exp)>`
 *
 * A ticket cannot be moved to another post, another user, or extended — any
 * edit breaks the signature. Nothing is stored; rotating JWT_SECRET revokes
 * every ticket at once. Same pattern as services/video/share.ts.
 */
import crypto from 'crypto';
import { config, } from '../../config';

export const TICKET_TTL_SEC = 15 * 60;
const ANON = 'anon';

function secret(): string {
    const s = config.jwt.secret;
    if (!s) throw new Error('JWT_SECRET is not set — live tickets need it',);
    return s;
}

const sign = (postId: string, user: string, exp: number,): string =>
    crypto.createHmac('sha256', secret(),).update(`live-ticket:${postId}:${user}:${exp}`,).digest('base64url',);

export function createTicket(
    postId: string,
    userId: string | null,
    nowMs = Date.now(),
): { token: string; expiresAt: string; } {
    const exp = Math.floor(nowMs / 1000,) + TICKET_TTL_SEC;
    const user = userId ?? ANON;
    return { token: `${exp}.${user}.${sign(postId, user, exp,)}`, expiresAt: new Date(exp * 1000,).toISOString(), };
}

/**
 * Verify a ticket for `postId`. Returns the identity it carries
 * (`userId: null` = an anonymous viewer), or null when it is malformed,
 * tampered with, for another post, or expired.
 */
export function verifyTicket(postId: string, token: unknown, nowMs = Date.now(),): { userId: string | null; } | null {
    if (typeof token !== 'string') return null;
    const m = /^(\d{9,11})\.([0-9a-fA-F-]{36}|anon)\.([\w-]{43})$/.exec(token,);
    if (!m) return null;
    const exp = Number(m[1],);
    if (exp * 1000 < nowMs) return null;
    const want = Buffer.from(sign(postId, m[2], exp,),);
    const got = Buffer.from(m[3],);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got,)) return null;
    return { userId: m[2] === ANON ? null : m[2], };
}
