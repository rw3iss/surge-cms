/**
 * IN-APP notifications: one `user_notifications` row per recipient, shown in
 * the admin's Notifications widget + /admin/notifications. Recipients = the
 * type's chosen users + every active user holding one of its roles (main or
 * additional). A user only ever reads / changes their own rows.
 */
import type { NotificationInAppConfig, UserNotification, UserNotificationsResponse, } from '@sitesurge/types';
import { query, } from '../../db';
import { getNotificationOptions, } from './options';

/** Active user ids for an in-app config (users ∪ role holders). */
export async function recipientsFor(cfg: NotificationInAppConfig | undefined,): Promise<string[]> {
    if (!cfg?.enabled) return [];
    const userIds = (cfg.userIds ?? []).filter(Boolean,);
    const roles = (cfg.roles ?? []).filter(Boolean,);
    if (!userIds.length && !roles.length) return [];
    const r = await query<{ id: string; }>(
        `SELECT id FROM users
          WHERE is_active = true AND COALESCE(is_banned, false) = false
            AND (id = ANY($1::uuid[]) OR role = ANY($2::text[]) OR extra_roles && $2::text[])`,
        [userIds, roles,],
    );
    return r.rows.map((x,) => x.id,);
}

export interface InAppMessage { type: string; title: string; body?: string | null; url?: string | null; }

/** Create the rows (one per user). */
export async function createFor(userIds: string[], m: InAppMessage,): Promise<number> {
    if (!userIds.length) return 0;
    const r = await query(
        `INSERT INTO user_notifications (user_id, type, title, body, url)
         SELECT u, $2, $3, $4, $5 FROM unnest($1::uuid[]) AS u`,
        [userIds, m.type, m.title.slice(0, 300,), m.body?.slice(0, 2000,) ?? null, m.url ?? null,],
    );
    return r.rowCount ?? 0;
}

const map = (r: { id: string; type: string; title: string; body: string | null; url: string | null; read_at: Date | null; created_at: Date; },): UserNotification => ({
    id: r.id, type: r.type, title: r.title, body: r.body, url: r.url,
    readAt: r.read_at ? new Date(r.read_at,).toISOString() : null, createdAt: new Date(r.created_at,).toISOString(),
});

export async function unreadCount(userId: string,): Promise<number> {
    const r = await query<{ n: string; }>(`SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = $1 AND read_at IS NULL AND cleared_at IS NULL`, [userId,],);
    return Number(r.rows[0]?.n ?? 0,);
}

export async function listFor(userId: string, q: { unread?: boolean; type?: string; page?: number; limit?: number; } = {},): Promise<UserNotificationsResponse> {
    const { inAppEnabled, } = await getNotificationOptions();
    const params: unknown[] = [userId,];
    let where = `user_id = $1 AND cleared_at IS NULL`;
    if (q.unread) where += ` AND read_at IS NULL`;
    if (q.type) { params.push(q.type,); where += ` AND type = $${params.length}`; }
    const limit = Math.min(100, Math.max(1, q.limit ?? 20,),);
    const offset = (Math.max(1, q.page ?? 1,) - 1) * limit;
    const [rows, total, unread,] = await Promise.all([
        query<Parameters<typeof map>[0]>(`SELECT id, type, title, body, url, read_at, created_at FROM user_notifications WHERE ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params,),
        query<{ n: string; }>(`SELECT COUNT(*) AS n FROM user_notifications WHERE ${where}`, params,),
        unreadCount(userId,),
    ],);
    return { enabled: inAppEnabled, unread, items: rows.rows.map(map,), total: Number(total.rows[0]?.n ?? 0,), };
}

/** Mark read: the given ids, or all. Only the user's own rows. */
export async function markRead(userId: string, ids: string[] | 'all',): Promise<number> {
    const r = ids === 'all'
        ? await query(`UPDATE user_notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL AND cleared_at IS NULL`, [userId,],)
        : await query(`UPDATE user_notifications SET read_at = COALESCE(read_at, NOW()) WHERE user_id = $1 AND id = ANY($2::uuid[])`, [userId, ids,],);
    return r.rowCount ?? 0;
}

/** Clear (hide): the given ids, or all. Only the user's own rows. */
export async function clear(userId: string, ids: string[] | 'all',): Promise<number> {
    const r = ids === 'all'
        ? await query(`UPDATE user_notifications SET cleared_at = NOW(), read_at = COALESCE(read_at, NOW()) WHERE user_id = $1 AND cleared_at IS NULL`, [userId,],)
        : await query(`UPDATE user_notifications SET cleared_at = NOW(), read_at = COALESCE(read_at, NOW()) WHERE user_id = $1 AND id = ANY($2::uuid[])`, [userId, ids,],);
    return r.rowCount ?? 0;
}

/** Daily sweep: cleared rows after 7 days, everything after the retention period. */
export async function sweep(): Promise<number> {
    const { retentionDays, } = await getNotificationOptions();
    const r = await query(
        `DELETE FROM user_notifications
          WHERE (cleared_at IS NOT NULL AND cleared_at < NOW() - INTERVAL '7 days')
             OR created_at < NOW() - make_interval(days => $1)`,
        [retentionDays,],
    );
    return r.rowCount ?? 0;
}
