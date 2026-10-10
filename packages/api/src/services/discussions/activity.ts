/**
 * Per-user activity counters: VISIBLE comments, forum threads and forum
 * replies. Adjusted in the same transaction as the write that changes them;
 * `reconcile()` (nightly) recomputes everything from the rows, so a missed
 * update heals itself.
 */
import type { PoolClient, } from 'pg';
import type { UserActivity, } from '@sitesurge/types';
import { query, } from '../../db';
import type { ActivityKind, } from './targets';

const COLUMN: Record<ActivityKind, string> = {
    comments: 'comments', forum_threads: 'forum_threads', forum_replies: 'forum_replies',
};

export async function adjust(client: PoolClient, userId: string, kind: ActivityKind, delta: number,): Promise<void> {
    if (!delta) return;
    const col = COLUMN[kind];
    await client.query(
        `INSERT INTO user_activity (user_id, ${col}, last_active_at)
         VALUES ($1, GREATEST(0, $2::int), CASE WHEN $2::int > 0 THEN NOW() END)
         ON CONFLICT (user_id) DO UPDATE
            SET ${col} = GREATEST(0, user_activity.${col} + $2::int),
                last_active_at = CASE WHEN $2::int > 0 THEN NOW() ELSE user_activity.last_active_at END`,
        [userId, delta,],
    );
}

export async function getActivity(userId: string,): Promise<UserActivity> {
    const r = await query<Record<string, unknown>>(`SELECT * FROM user_activity WHERE user_id = $1`, [userId,],).catch(() => ({ rows: [], }));
    const a = r.rows[0];
    return {
        comments: Number(a?.comments ?? 0,),
        forumThreads: Number(a?.forum_threads ?? 0,),
        forumReplies: Number(a?.forum_replies ?? 0,),
        total: Number(a?.total ?? 0,),
        lastActiveAt: a?.last_active_at ? new Date(a.last_active_at as string,).toISOString() : null,
    };
}

/** Recompute user counters + per-comment reply counts from the rows. */
export async function reconcile(): Promise<void> {
    await query(
        `INSERT INTO user_activity (user_id, comments, forum_threads, forum_replies, last_active_at)
         SELECT author_id,
                COUNT(*) FILTER (WHERE target_type <> 'forum_thread'),
                COUNT(*) FILTER (WHERE target_type = 'forum_thread' AND is_opening),
                COUNT(*) FILTER (WHERE target_type = 'forum_thread' AND NOT is_opening),
                MAX(created_at)
           FROM comments
          WHERE status = 'visible' AND author_id IS NOT NULL
          GROUP BY author_id
         ON CONFLICT (user_id) DO UPDATE
            SET comments = EXCLUDED.comments, forum_threads = EXCLUDED.forum_threads,
                forum_replies = EXCLUDED.forum_replies,
                last_active_at = GREATEST(user_activity.last_active_at, EXCLUDED.last_active_at)`,
    );
    await query(
        `UPDATE user_activity SET comments = 0, forum_threads = 0, forum_replies = 0
          WHERE total > 0 AND user_id NOT IN (
                SELECT DISTINCT author_id FROM comments WHERE status = 'visible' AND author_id IS NOT NULL)`,
    );
    await query(
        `UPDATE comments p SET reply_count = COALESCE(x.n, 0)
           FROM comments p2
           LEFT JOIN (SELECT parent_id, COUNT(*)::int AS n FROM comments
                       WHERE status = 'visible' AND parent_id IS NOT NULL GROUP BY parent_id) x ON x.parent_id = p2.id
          WHERE p.id = p2.id AND p.reply_count IS DISTINCT FROM COALESCE(x.n, 0)`,
    );
}
