/**
 * Per-item comment switches + counters (`comment_threads`): Enable commenting,
 * Allow anonymous comments, Lock comments. A row exists only once an item's
 * settings were saved or it was commented on; otherwise the defaults apply.
 */
import type { PoolClient, } from 'pg';
import type { CommentsThreadUpdateBody, CommentThreadSettings, } from '@sitesurge/types';
import { query, } from '../../db';

interface ThreadRow {
    target_type: string; target_id: string; enabled: boolean; allow_anonymous: boolean; locked: boolean;
    comment_count: number; last_comment_at: Date | null;
}

const map = (type: string, id: string, r?: ThreadRow,): CommentThreadSettings => ({
    targetType: type,
    targetId: id,
    enabled: Boolean(r?.enabled,),
    allowAnonymous: Boolean(r?.allow_anonymous,),
    locked: Boolean(r?.locked,),
    commentCount: Number(r?.comment_count ?? 0,),
    lastCommentAt: r?.last_comment_at ? new Date(r.last_comment_at,).toISOString() : null,
});

export async function get(type: string, id: string,): Promise<CommentThreadSettings> {
    const r = await query<ThreadRow>(`SELECT * FROM comment_threads WHERE target_type = $1 AND target_id = $2`, [type, id,],);
    return map(type, id, r.rows[0],);
}

/** Batch, for lists (comment counts on /posts cards etc.). */
export async function getMany(type: string, ids: string[],): Promise<Map<string, CommentThreadSettings>> {
    const out = new Map<string, CommentThreadSettings>();
    if (!ids.length) return out;
    const r = await query<ThreadRow>(`SELECT * FROM comment_threads WHERE target_type = $1 AND target_id = ANY($2::uuid[])`, [type, ids,],);
    for (const id of ids) out.set(id, map(type, id, r.rows.find((x,) => x.target_id === id),),);
    return out;
}

export async function update(type: string, id: string, patch: CommentsThreadUpdateBody,): Promise<CommentThreadSettings> {
    const r = await query<ThreadRow>(
        `INSERT INTO comment_threads (target_type, target_id, enabled, allow_anonymous, locked)
         VALUES ($1, $2, COALESCE($3, false), COALESCE($4, false), COALESCE($5, false))
         ON CONFLICT (target_type, target_id) DO UPDATE SET
            enabled = COALESCE($3, comment_threads.enabled),
            allow_anonymous = COALESCE($4, comment_threads.allow_anonymous),
            locked = COALESCE($5, comment_threads.locked),
            updated_at = NOW()
         RETURNING *`,
        [type, id, patch.enabled ?? null, patch.allowAnonymous ?? null, patch.locked ?? null,],
    );
    return map(type, id, r.rows[0],);
}

/** Visible-comment counter, inside the comment write transaction. */
export async function bump(client: PoolClient, type: string, id: string, delta: number,): Promise<void> {
    await client.query(
        `INSERT INTO comment_threads (target_type, target_id, comment_count, last_comment_at)
         VALUES ($1, $2, GREATEST(0, $3::int), CASE WHEN $3::int > 0 THEN NOW() END)
         ON CONFLICT (target_type, target_id) DO UPDATE SET
            comment_count = GREATEST(0, comment_threads.comment_count + $3::int),
            last_comment_at = CASE WHEN $3::int > 0 THEN NOW() ELSE comment_threads.last_comment_at END`,
        [type, id, delta,],
    );
}

/** Nightly: recount from the rows. */
export async function reconcile(type: string,): Promise<void> {
    await query(
        `UPDATE comment_threads t SET comment_count = COALESCE(x.n, 0), last_comment_at = x.last
           FROM comment_threads t2
           LEFT JOIN (SELECT target_id, COUNT(*)::int AS n, MAX(created_at) AS last FROM comments
                       WHERE target_type = $1 AND status = 'visible' GROUP BY target_id) x ON x.target_id = t2.target_id
          WHERE t.target_type = $1 AND t2.target_type = $1 AND t.target_id = t2.target_id
            AND t.comment_count IS DISTINCT FROM COALESCE(x.n, 0)`,
        [type,],
    );
}

/** Remove an item's switches (the item was deleted permanently). */
export async function removeFor(type: string, id: string,): Promise<void> {
    await query(`DELETE FROM comment_threads WHERE target_type = $1 AND target_id = $2`, [type, id,],).catch(() => {},);
}
