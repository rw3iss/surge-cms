/**
 * DESKTOP notifications (Web Push) for admin users. A user turns them on per
 * browser (their Notifications panel → browser permission → subscription);
 * a notification type's `push` switch sends to its IN-APP recipients' browsers.
 * VAPID keys: options.vapidKeys(). Gone subscriptions (404/410) are pruned.
 */
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { loadWebPush, vapidKeys, } from './options';

export async function publicKey(): Promise<string | null> {
    return (await vapidKeys().catch(() => null))?.publicKey ?? null;
}

export async function subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string; }; }, userAgent: string | null,): Promise<void> {
    if (!/^https:\/\//.test(sub.endpoint,)) throw new ValidationError('Invalid push endpoint.',);
    await query(
        `INSERT INTO user_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
        [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent?.slice(0, 300,) ?? null,],
    );
}

export async function unsubscribe(userId: string, endpoint: string,): Promise<void> {
    await query(`DELETE FROM user_push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [userId, endpoint,],);
}

export async function subscriptionCount(userId: string,): Promise<number> {
    const r = await query<{ n: string; }>(`SELECT COUNT(*) AS n FROM user_push_subscriptions WHERE user_id = $1`, [userId,],);
    return Number(r.rows[0]?.n ?? 0,);
}

/** Send to every browser of these users. Never throws. */
export async function sendTo(userIds: string[], payload: { title: string; body?: string | null; url?: string | null; tag?: string; },): Promise<number> {
    if (!userIds.length) return 0;
    try {
        const [wp, keys,] = await Promise.all([loadWebPush(), vapidKeys(),],);
        if (!wp || !keys) { logger.warn('desktop notifications skipped: web-push or VAPID keys missing',); return 0; }
        wp.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey,);
        const subs = await query<{ endpoint: string; p256dh: string; auth: string; }>(
            `SELECT endpoint, p256dh, auth FROM user_push_subscriptions WHERE user_id = ANY($1::uuid[])`, [userIds,],
        );
        const body = JSON.stringify({ title: payload.title, body: payload.body ?? '', url: payload.url ?? '/admin/notifications', tag: payload.tag, },);
        let sent = 0;
        for (const s of subs.rows) {
            try {
                await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth, }, }, body, { TTL: 86_400, },);
                sent++;
            } catch (e) {
                const status = (e as { statusCode?: number; }).statusCode;
                if (status === 404 || status === 410) await query(`DELETE FROM user_push_subscriptions WHERE endpoint = $1`, [s.endpoint,],);
                else logger.warn('desktop notification failed', { status, },);
            }
        }
        return sent;
    } catch (e) {
        logger.warn('desktop notifications failed', { error: (e as Error).message, },);
        return 0;
    }
}
