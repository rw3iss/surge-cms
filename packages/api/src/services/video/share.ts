/**
 * Share tokens: a time-limited link to a video's plain file that skips the
 * access check — for an admin who wants to send a private video to someone
 * without an account. Stateless: `<expiresUnix>.<HMAC(video-share:id:exp)>`,
 * so a token cannot be moved to another video or extended, and nothing is
 * stored. Revoking every share at once = rotating JWT_SECRET.
 */
import crypto from 'crypto';
import { config, } from '../../config';

const MAX_DAYS = 365;

function secret(): string {
    const s = config.jwt.secret;
    if (!s) throw new Error('JWT_SECRET is not set — share links need it',);
    return s;
}

const sign = (mediaId: string, exp: number,): string =>
    crypto.createHmac('sha256', secret(),).update(`video-share:${mediaId}:${exp}`,).digest('base64url',).slice(0, 32,);

export function createShareToken(mediaId: string, days: number,): { token: string; expiresAt: string; } {
    const d = Math.min(MAX_DAYS, Math.max(1, Math.round(days,),),);
    const exp = Math.floor(Date.now() / 1000,) + d * 86400;
    return { token: `${exp}.${sign(mediaId, exp,)}`, expiresAt: new Date(exp * 1000,).toISOString(), };
}

export function verifyShareToken(mediaId: string, token: string | undefined | null,): boolean {
    if (!token) return false;
    const m = /^(\d{9,11})\.([\w-]{32})$/.exec(token,);
    if (!m) return false;
    const exp = Number(m[1],);
    if (exp * 1000 < Date.now()) return false;
    const want = Buffer.from(sign(mediaId, exp,),);
    const got = Buffer.from(m[2],);
    return want.length === got.length && crypto.timingSafeEqual(want, got,);
}
