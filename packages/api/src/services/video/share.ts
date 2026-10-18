/**
 * Share tokens: a time-limited link to a video's plain file that skips the
 * access check — for an admin who wants to send a private video to someone
 * without an account. Stateless: `<expiresUnix>.<HMAC(video-share:id:epoch:exp)>`,
 * so a token cannot be moved to another video or extended, and nothing is
 * stored per link.
 *
 * Revoking: the video's `media_videos.share_epoch` is signed in. Bumping it
 * ("Revoke share links", or an access-level change) invalidates every link
 * issued for that video. Epoch 0 signs the original `video-share:id:exp`
 * string, so links issued before epochs existed keep working until the first
 * revoke. Revoking every share of every video = rotating JWT_SECRET.
 */
import crypto from 'crypto';
import type { PoolClient, } from 'pg';
import { config, } from '../../config';
import { query, } from '../../db';

const MAX_DAYS = 365;

function secret(): string {
    const s = config.jwt.secret;
    if (!s) throw new Error('JWT_SECRET is not set — share links need it',);
    return s;
}

const sign = (mediaId: string, exp: number, epoch: number,): string =>
    crypto.createHmac('sha256', secret(),)
        .update(epoch > 0 ? `video-share:${mediaId}:${epoch}:${exp}` : `video-share:${mediaId}:${exp}`,)
        .digest('base64url',).slice(0, 32,);

export function createShareToken(mediaId: string, days: number, epoch = 0,): { token: string; expiresAt: string; } {
    const d = Math.min(MAX_DAYS, Math.max(1, Math.round(days,),),);
    const exp = Math.floor(Date.now() / 1000,) + d * 86400;
    return { token: `${exp}.${sign(mediaId, exp, epoch,)}`, expiresAt: new Date(exp * 1000,).toISOString(), };
}

/** `epoch` = the video's current `share_epoch` (a token signed for an older one fails). */
export function verifyShareToken(mediaId: string, token: string | undefined | null, epoch = 0,): boolean {
    if (!token) return false;
    const m = /^(\d{9,11})\.([\w-]{32})$/.exec(token,);
    if (!m) return false;
    const exp = Number(m[1],);
    if (exp * 1000 < Date.now()) return false;
    const want = Buffer.from(sign(mediaId, exp, epoch,),);
    const got = Buffer.from(m[2],);
    return want.length === got.length && crypto.timingSafeEqual(want, got,);
}

/** The video's current share epoch (0 when unset or before migration 159). */
export async function shareEpoch(mediaId: string,): Promise<number> {
    try {
        const r = await query<{ share_epoch: number | null; }>(`SELECT share_epoch FROM media_videos WHERE media_id = $1`, [mediaId,],);
        return Number(r.rows[0]?.share_epoch ?? 0,) || 0;
    } catch (e) {
        // 42703: the column is not there yet (migration pending) — epoch 0.
        if ((e as { code?: string; }).code === '42703') return 0;
        throw e;
    }
}

/** Invalidate every share link issued so far for this video. */
export async function bumpShareEpoch(mediaId: string, client?: PoolClient,): Promise<void> {
    const sql = `UPDATE media_videos SET share_epoch = share_epoch + 1 WHERE media_id = $1`;
    if (client) await client.query(sql, [mediaId,],);
    else await query(sql, [mediaId,],);
}
