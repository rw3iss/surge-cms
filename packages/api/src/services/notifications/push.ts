/**
 * DESKTOP notifications (Web Push) for admin users. A user turns them on per
 * browser (their Notifications panel → browser permission → subscription);
 * a notification type's `push` switch sends to its IN-APP recipients' browsers.
 * VAPID keys: options.vapidKeys(). Gone subscriptions (404/410) are pruned.
 *
 * The server POSTs to the endpoint a browser hands us, so an endpoint must be
 * an https URL on a public host name (no IP literal, no localhost / internal
 * name) — otherwise a signed-in user could point our server at an internal
 * service. Each user keeps at most MAX_SUBSCRIPTIONS_PER_USER browsers (the
 * oldest is dropped), so one account cannot make every alert fan out without end.
 */
import { isIP, } from 'node:net';
import { ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import { logger, } from '../../utils/logger';
import { loadWebPush, vapidKeys, } from './options';

export const MAX_SUBSCRIPTIONS_PER_USER = 10;
/** Browsers sent to at once (a push service answers in ~100 ms; a few hundred subs stay quick). */
const SEND_CONCURRENCY = 8;

export async function publicKey(): Promise<string | null> {
    return (await vapidKeys().catch(() => null))?.publicKey ?? null;
}

/** Null when the endpoint is acceptable, else why not. Pure — unit-tested. */
export function pushEndpointProblem(endpoint: string,): string | null {
    let u: URL;
    try {
        u = new URL(endpoint,);
    } catch {
        return 'Invalid push endpoint.';
    }
    if (u.protocol !== 'https:') return 'Invalid push endpoint.';
    if (u.username || u.password) return 'Invalid push endpoint.';
    const host = u.hostname.replace(/^\[|\]$/g, '',).toLowerCase();
    if (isIP(host,) || !host.includes('.',)) return 'Invalid push endpoint.';
    if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(host,)) return 'Invalid push endpoint.';
    if (u.port && u.port !== '443') return 'Invalid push endpoint.';
    return null;
}

export async function subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string; }; }, userAgent: string | null,): Promise<void> {
    const problem = pushEndpointProblem(sub.endpoint,);
    if (problem) throw new ValidationError(problem,);
    // The same browser signing in as another user takes the endpoint over (one owner per browser).
    await query(
        `INSERT INTO user_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
        [userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, userAgent?.slice(0, 300,) ?? null,],
    );
    // Keep the newest N browsers of this user.
    await query(
        `DELETE FROM user_push_subscriptions
          WHERE user_id = $1 AND id NOT IN (
                SELECT id FROM user_push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2)`,
        [userId, MAX_SUBSCRIPTIONS_PER_USER,],
    );
}

export async function unsubscribe(userId: string, endpoint: string,): Promise<void> {
    await query(`DELETE FROM user_push_subscriptions WHERE user_id = $1 AND endpoint = $2`, [userId, endpoint,],);
}

export async function subscriptionCount(userId: string,): Promise<number> {
    const r = await query<{ n: string; }>(`SELECT COUNT(*) AS n FROM user_push_subscriptions WHERE user_id = $1`, [userId,],);
    return Number(r.rows[0]?.n ?? 0,);
}

/** Run `fn` over `items`, at most `limit` at a time. */
async function eachLimited<T,>(items: T[], limit: number, fn: (item: T,) => Promise<void>,): Promise<void> {
    let next = 0;
    const worker = async () => {
        while (next < items.length) await fn(items[next++],);
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length,), }, worker,),);
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
        const gone: string[] = [];
        await eachLimited(subs.rows, SEND_CONCURRENCY, async (s,) => {
            try {
                await wp.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth, }, }, body, { TTL: 86_400, },);
                sent++;
            } catch (e) {
                const status = (e as { statusCode?: number; }).statusCode;
                // 404/410 = the browser dropped the subscription; it never comes back.
                if (status === 404 || status === 410) gone.push(s.endpoint,);
                // 401/403 = the push service refuses our VAPID key (keys changed): the
                // browser must subscribe again — it does on its next admin visit.
                else logger.warn('desktop notification failed', { status, host: safeHost(s.endpoint,), },);
            }
        },);
        if (gone.length) await query(`DELETE FROM user_push_subscriptions WHERE endpoint = ANY($1::text[])`, [gone,],);
        return sent;
    } catch (e) {
        logger.warn('desktop notifications failed', { error: (e as Error).message, },);
        return 0;
    }
}

const safeHost = (endpoint: string,): string | null => {
    try {
        return new URL(endpoint,).host;
    } catch {
        return null;
    }
};
