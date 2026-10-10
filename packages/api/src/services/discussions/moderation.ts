/**
 * Reactions, reports and the moderation queue (pending + reported), shared by
 * Comments and the Forum.
 */
import type {
    DiscussionsModerationAction, DiscussionsModerationQuery, ModerationItem,
} from '@sitesurge/types';
import { ForbiddenError, NotFoundError, ValidationError, } from '../../core/errors';
import { query, } from '../../db';
import * as permissions from '../permissions';
import { getRow, mapForViewer, setStatus, } from './comments';
import { emitDiscussionEvent, } from './events';
import { AUTHOR_JOIN, COMMENT_COLUMNS, type CommentRow, excerptOf, } from './rows';
import { getSettings, } from './settings';
import { findTarget, getTarget, parseTarget, } from './targets';
import { isModerator, type Viewer, } from './viewer';

// ─── Reactions ──────────────────────────────────────────────────────

/** Toggle one reaction kind for the viewer. */
export async function react(id: string, kind: string, viewer: Viewer,): Promise<{ reactions: Record<string, number>; myReactions: string[]; }> {
    if (!viewer.id) throw new ForbiddenError('Sign in to react.',);
    const s = await getSettings();
    if (!s.reactionsEnabled || !s.reactions.includes(kind,)) throw new ValidationError('That reaction is not available.',);
    if (!(await permissions.can(viewer, 'discussions:react',).catch(() => false))) throw new ForbiddenError();
    const row = await getRow(id,);
    if (!row || row.status !== 'visible') throw new NotFoundError('Comment',);
    const target = await getTarget(row.target_type,);
    if (!(await target.access(row.target_id, viewer,))?.canRead) throw new NotFoundError('Comment',);

    const del = await query(`DELETE FROM comment_reactions WHERE comment_id = $1 AND user_id = $2 AND kind = $3`, [id, viewer.id, kind,],);
    if (!del.rowCount) {
        await query(`INSERT INTO comment_reactions (comment_id, user_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [id, viewer.id, kind,],);
    }
    const r = await query<{ reaction_counts: Record<string, number>; }>(
        `UPDATE comments SET reaction_counts = COALESCE(
            (SELECT jsonb_object_agg(kind, n) FROM (
                SELECT kind, COUNT(*)::int AS n FROM comment_reactions WHERE comment_id = $1 GROUP BY kind) x), '{}'::jsonb)
          WHERE id = $1 RETURNING reaction_counts`,
        [id,],
    );
    const mine = await query<{ kind: string; }>(`SELECT kind FROM comment_reactions WHERE comment_id = $1 AND user_id = $2`, [id, viewer.id,],);
    emitDiscussionEvent({ type: 'reacted', comment: row, actor: viewer, },);
    return { reactions: r.rows[0]?.reaction_counts ?? {}, myReactions: mine.rows.map((m,) => m.kind), };
}

// ─── Reports ────────────────────────────────────────────────────────

export async function report(id: string, reason: string | undefined, viewer: Viewer,): Promise<void> {
    if (!viewer.id) throw new ForbiddenError('Sign in to report.',);
    if (!(await permissions.can(viewer, 'discussions:report',).catch(() => false))) throw new ForbiddenError();
    const row = await getRow(id,);
    if (!row || row.status !== 'visible') throw new NotFoundError('Comment',);
    const target = await getTarget(row.target_type,);
    if (!(await target.access(row.target_id, viewer,))?.canRead) throw new NotFoundError('Comment',);
    const text = (reason ?? '').trim().slice(0, 1000,) || null;
    await query(
        `INSERT INTO comment_reports (comment_id, reporter_id, reason) VALUES ($1, $2, $3)
         ON CONFLICT (comment_id, reporter_id) WHERE status = 'open' DO UPDATE SET reason = EXCLUDED.reason`,
        [id, viewer.id, text,],
    );
    emitDiscussionEvent({ type: 'reported', comment: row, actor: viewer, reason: text, },);
}

// ─── Moderation queue ───────────────────────────────────────────────

async function requireModerator(viewer: Viewer,): Promise<void> {
    if (!(await isModerator(viewer,))) throw new ForbiddenError();
}

export async function list(q: DiscussionsModerationQuery, viewer: Viewer,): Promise<{ items: ModerationItem[]; total: number; page: number; limit: number; }> {
    await requireModerator(viewer,);
    const page = Math.max(1, Number(q.page ?? 1,),);
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 25,),),);
    const params: unknown[] = [];
    const where: string[] = [];
    const status = q.status ?? 'queue';
    const reported = `EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = c.id AND r.status = 'open')`;
    if (status === 'queue') where.push(`(c.status = 'pending' OR (${reported} AND c.status = 'visible'))`,);
    else if (status === 'reported') where.push(reported,);
    else if (status !== 'all') { params.push(status,); where.push(`c.status = $${params.length}`,); }
    if (q.scope === 'forum') where.push(`c.target_type = 'forum_thread'`,);
    else if (q.scope === 'comments') where.push(`c.target_type <> 'forum_thread'`,);
    if (q.target) {
        const t = parseTarget(q.target,);
        params.push(t.type, t.id,);
        where.push(`c.target_type = $${params.length - 1} AND c.target_id = $${params.length}`,);
    }
    if (q.authorId) { params.push(q.authorId,); where.push(`c.author_id = $${params.length}`,); }
    if (q.search) {
        params.push(`%${q.search}%`,);
        where.push(`(c.body ILIKE $${params.length} OR u.display_name ILIKE $${params.length} OR c.guest_name ILIKE $${params.length})`,);
    }
    const w = where.length ? `WHERE ${where.join(' AND ',)}` : '';
    const total = Number((await query<{ n: number; }>(`SELECT COUNT(*)::int AS n FROM comments c ${AUTHOR_JOIN} ${w}`, params,)).rows[0]?.n ?? 0,);
    const rows = (await query<CommentRow>(
        `SELECT ${COMMENT_COLUMNS} FROM comments c ${AUTHOR_JOIN} ${w} ORDER BY c.created_at DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        params,
    )).rows;
    return { items: await toModerationItems(rows, viewer,), total, page, limit, };
}

async function toModerationItems(rows: CommentRow[], viewer: Viewer,): Promise<ModerationItem[]> {
    if (!rows.length) return [];
    const ids = rows.map((r,) => r.id);
    const reports = await query<{ id: string; comment_id: string; reason: string | null; created_at: Date; reporter: string | null; }>(
        `SELECT r.id, r.comment_id, r.reason, r.created_at, u.display_name AS reporter
           FROM comment_reports r LEFT JOIN users u ON u.id = r.reporter_id
          WHERE r.comment_id = ANY($1::uuid[]) AND r.status = 'open' ORDER BY r.created_at`,
        [ids,],
    );
    const summaries = await targetSummaries(rows,);
    const mapped = await mapForViewer(rows, viewer, true,);
    return mapped.map((c, i,) => {
        const row = rows[i];
        const rs = reports.rows.filter((r,) => r.comment_id === c.id);
        return {
            ...c,
            target: summaries.get(`${row.target_type}:${row.target_id}`,) ?? null,
            excerpt: excerptOf(row.body,),
            reportCount: rs.length,
            reports: rs.map((r,) => ({ id: r.id, reason: r.reason, reporterName: r.reporter, createdAt: new Date(r.created_at,).toISOString(), })),
            guestEmail: row.guest_email,
            guestIp: row.guest_ip,
        };
    },);
}

/** Batch titles + URLs, grouped by target type. Key `type:id`. */
export async function targetSummaries(rows: Pick<CommentRow, 'target_type' | 'target_id'>[],): Promise<Map<string, { type: string; id: string; title: string; url: string; }>> {
    const out = new Map<string, { type: string; id: string; title: string; url: string; }>();
    const byType = new Map<string, Set<string>>();
    for (const r of rows) {
        if (!byType.has(r.target_type,)) byType.set(r.target_type, new Set(),);
        byType.get(r.target_type,)!.add(r.target_id,);
    }
    for (const [type, ids,] of byType) {
        const t = await findTarget(type,);
        if (!t) continue;
        const m = await t.summaries([...ids,],).catch(() => new Map());
        for (const [id, s,] of m) out.set(`${type}:${id}`, { type, id, ...s, },);
    }
    return out;
}

const NEXT: Record<DiscussionsModerationAction, CommentRow['status'] | null> = {
    approve: 'visible', restore: 'visible', hide: 'hidden', delete: 'deleted', dismiss_reports: null,
};

export async function act(id: string, action: DiscussionsModerationAction, viewer: Viewer,): Promise<{ id: string; status: CommentRow['status']; }> {
    await requireModerator(viewer,);
    if (!(action in NEXT)) throw new ValidationError('Unknown action',);
    const row = await getRow(id,);
    if (!row) throw new NotFoundError('Comment',);
    const next = NEXT[action];
    let status = row.status;
    if (next) {
        const { after, } = await setStatus(id, next,);
        status = after.status;
        const ev = action === 'approve' ? 'approved' : action === 'restore' ? 'restored' : action === 'hide' ? 'hidden' : 'deleted';
        emitDiscussionEvent({ type: ev, comment: after, actor: viewer, },);
    }
    // Any decision closes the open reports (approve = "it's fine").
    await query(
        `UPDATE comment_reports SET status = $2, resolved_by = $3, resolved_at = NOW() WHERE comment_id = $1 AND status = 'open'`,
        [id, action === 'approve' || action === 'dismiss_reports' ? 'dismissed' : 'resolved', viewer.id ?? null,],
    );
    return { id, status, };
}

export async function bulk(ids: string[], action: DiscussionsModerationAction, viewer: Viewer,): Promise<{ updated: number; }> {
    await requireModerator(viewer,);
    let updated = 0;
    for (const id of ids.slice(0, 200,)) {
        try {
            await act(id, action, viewer,);
            updated++;
        } catch { /* skip missing */ }
    }
    return { updated, };
}

export async function counts(viewer: Viewer, scope: 'all' | 'comments' | 'forum' = 'all',): Promise<{ pending: number; reported: number; }> {
    await requireModerator(viewer,);
    const s = scope === 'forum' ? `AND c.target_type = 'forum_thread'` : scope === 'comments' ? `AND c.target_type <> 'forum_thread'` : '';
    const r = await query<{ pending: number; reported: number; }>(
        `SELECT (SELECT COUNT(*)::int FROM comments c WHERE c.status = 'pending' ${s}) AS pending,
                (SELECT COUNT(DISTINCT r.comment_id)::int FROM comment_reports r JOIN comments c ON c.id = r.comment_id
                  WHERE r.status = 'open' ${s}) AS reported`,
    );
    return r.rows[0] ?? { pending: 0, reported: 0, };
}
