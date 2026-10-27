/**
 * Comment CRUD on any registered target (posts, events, forum threads, …).
 *
 * Reading: top-level comments are paginated; each comes with its whole reply
 * tree. A viewer sees visible comments, deleted ones that still have replies
 * (as "[deleted]" so the thread reads), their OWN pending ones, and — when a
 * moderator — everything.
 *
 * Counters (author activity, parent reply_count, the target's own counters)
 * change only when a comment ENTERS or LEAVES `visible`, always inside the
 * same transaction as that change (`applyVisibility`).
 */
import type { PoolClient, } from 'pg';
import type { Comment, CommentTargetRef, DiscussionsCommentCreateBody, } from '@sitesurge/types';
import { ForbiddenError, NotFoundError, ValidationError, } from '../../core/errors';
import { query, transaction, } from '../../db';
import * as permissions from '../permissions';
import { adjust as adjustActivity, } from './activity';
import { emitDiscussionEvent, } from './events';
import { AUTHOR_JOIN, COMMENT_COLUMNS, type CommentRow, mapComment, type MapOpts, } from './rows';
import { getSettings, } from './settings';
import { checkWriteRate, countLinks, } from './spam';
import { getTarget, parseTarget, type CommentTarget, type TargetAccess, } from './targets';
import { isModerator, type Viewer, } from './viewer';

export interface ListOptions {
    sort?: 'newest' | 'oldest' | 'top';
    page?: number;
    limit?: number;
    /** Only this top-level comment, with all its replies (up to ROOT_REPLIES_MAX). */
    root?: string;
}

/** Replies returned per top-level comment in a list (newest kept; the rest counted). */
export const REPLIES_PER_ROOT = 50;
/** Cap for one root's full reply set (`root` option). */
export const ROOT_REPLIES_MAX = 1000;

/** Total reactions on a comment, for `top`. */
const REACTION_TOTAL = `(SELECT COALESCE(SUM(v::int), 0) FROM jsonb_each_text(c.reaction_counts) AS j(k, v))`;

/** Statuses a viewer may see (SQL), given the params array. */
function visibilityClause(viewer: Viewer, moderator: boolean, params: unknown[],): string {
    if (moderator) return 'TRUE';
    let own = '';
    if (viewer.id) {
        params.push(viewer.id,);
        own = ` OR (c.status = 'pending' AND c.author_id = $${params.length})`;
    }
    return `c.status = 'visible' OR (c.status = 'deleted' AND c.reply_count > 0)${own}`;
}

/** Edit/delete-own permissions for a viewer, resolved once per request. */
async function ownRights(viewer: Viewer,): Promise<{ edit: boolean; del: boolean; }> {
    if (!viewer.id) return { edit: false, del: false, };
    const [edit, del,] = await Promise.all([
        permissions.can(viewer, 'discussions:edit_own',).catch(() => false),
        permissions.can(viewer, 'discussions:delete_own',).catch(() => false),
    ],);
    return { edit, del, };
}

/** Is the edit window still open for this comment? (pass `minutes` to skip the settings read) */
async function inEditWindow(createdAt: Date, minutes?: number,): Promise<boolean> {
    const editWindowMinutes = minutes ?? (await getSettings()).editWindowMinutes;
    return !editWindowMinutes || Date.now() - new Date(createdAt,).getTime() <= editWindowMinutes * 60_000;
}

async function myReactionsFor(viewerId: string | null | undefined, ids: string[],): Promise<Map<string, Set<string>>> {
    const out = new Map<string, Set<string>>();
    if (!viewerId || !ids.length) return out;
    const r = await query<{ comment_id: string; kind: string; }>(
        `SELECT comment_id, kind FROM comment_reactions WHERE user_id = $1 AND comment_id = ANY($2::uuid[])`,
        [viewerId, ids,],
    );
    for (const row of r.rows) {
        if (!out.has(row.comment_id,)) out.set(row.comment_id, new Set(),);
        out.get(row.comment_id,)!.add(row.kind,);
    }
    return out;
}

/** Map rows for a viewer (reactions, edit rights). */
export async function mapForViewer(rows: CommentRow[], viewer: Viewer, moderator?: boolean,): Promise<Comment[]> {
    const mod = moderator ?? (await isModerator(viewer,));
    const [mine, rights,] = await Promise.all([myReactionsFor(viewer.id, rows.map((r,) => r.id),), ownRights(viewer,),],);
    // Settings read ONCE per list, not once per row.
    const windowMinutes = rights.edit ? (await getSettings()).editWindowMinutes : 0;
    const out: Comment[] = [];
    for (const r of rows) {
        const opts: MapOpts = {
            viewerId: viewer.id, moderator: mod, myReactions: mine.get(r.id,),
            canEditOwn: rights.edit && (await inEditWindow(r.created_at, windowMinutes,)), canDeleteOwn: rights.del,
        };
        out.push(mapComment(r, opts,),);
    }
    return out;
}

/** Resolve a target + its access for a viewer; throws when the item cannot be read. */
export async function readableTarget(ref: string, viewer: Viewer,): Promise<{ target: CommentTarget; id: string; access: TargetAccess; }> {
    const { type, id, } = parseTarget(ref,);
    const target = await getTarget(type,);
    const access = await target.access(id, viewer,);
    if (!access) throw new NotFoundError('Comments',);
    if (!access.canRead) throw new ForbiddenError(access.reason || 'You cannot read these comments.',);
    return { target, id, access, };
}

/** Top-level comments (paged) with their reply trees. */
export async function list(ref: string, viewer: Viewer, opts: ListOptions = {},): Promise<{ items: Comment[]; total: number; page: number; limit: number; }> {
    const { target, id, } = await readableTarget(ref, viewer,);
    const moderator = await isModerator(viewer,);
    const page = Math.max(1, opts.page ?? 1,);
    const limit = Math.min(100, Math.max(1, opts.limit ?? 20,),);
    const order = opts.sort === 'oldest' ? 'c.created_at ASC'
        : opts.sort === 'top' ? `${REACTION_TOTAL} DESC, c.created_at DESC`
        : 'c.created_at DESC';

    const params: unknown[] = [target.type, id,];
    const vis = visibilityClause(viewer, moderator, params,);
    // The forum's opening post is the thread body, not a comment in the list.
    let where = `c.target_type = $1 AND c.target_id = $2 AND c.parent_id IS NULL AND NOT c.is_opening AND (${vis})`;
    const oneRoot = opts.root && /^[0-9a-f-]{36}$/i.test(opts.root,) ? opts.root : null;
    if (oneRoot) {
        params.push(oneRoot,);
        where += ` AND c.id = $${params.length}`;
    }
    const total = Number((await query<{ n: string; }>(`SELECT COUNT(*)::int AS n FROM comments c WHERE ${where}`, params,)).rows[0]?.n ?? 0,);
    const tops = (await query<CommentRow>(
        `SELECT ${COMMENT_COLUMNS} FROM comments c ${AUTHOR_JOIN} WHERE ${where} ORDER BY ${order}
          LIMIT ${oneRoot ? 1 : limit} OFFSET ${oneRoot ? 0 : (page - 1) * limit}`,
        params,
    )).rows;
    if (!tops.length) return { items: [], total, page, limit, };

    // Replies: the newest REPLIES_PER_ROOT per root (all of one root's, up to
    // ROOT_REPLIES_MAX, for `root`) — one popular thread must not return
    // thousands of rows on every poll. Returned oldest first.
    const perRoot = oneRoot ? ROOT_REPLIES_MAX : REPLIES_PER_ROOT;
    const rParams: unknown[] = [tops.map((t,) => t.id),];
    const rVis = visibilityClause(viewer, moderator, rParams,);
    const ranked = (await query<CommentRow & { rn: number; root_total: number; }>(
        `SELECT * FROM (
            SELECT ${COMMENT_COLUMNS},
                   ROW_NUMBER() OVER (PARTITION BY c.root_id ORDER BY c.created_at DESC) AS rn,
                   COUNT(*) OVER (PARTITION BY c.root_id) AS root_total
              FROM comments c ${AUTHOR_JOIN}
             WHERE c.root_id = ANY($1::uuid[]) AND (${rVis})
         ) x WHERE x.rn <= ${perRoot} ORDER BY x.created_at ASC`,
        rParams,
    )).rows;
    const hidden = new Map<string, number>();
    for (const r of ranked) {
        if (r.root_id) hidden.set(r.root_id, Math.max(0, Number(r.root_total,) - perRoot,),);
    }
    const replies: CommentRow[] = ranked;

    const mapped = await mapForViewer([...tops, ...replies,], viewer, moderator,);
    const byId = new Map(mapped.map((c,) => [c.id, c,],),);
    for (const c of mapped) {
        if (!c.parentId) continue;
        // A reply whose parent fell outside the newest-N window hangs off its
        // root instead of disappearing.
        const parent = byId.get(c.parentId,) ?? (c.rootId ? byId.get(c.rootId,) : undefined);
        if (parent) (parent.replies ??= []).push(c,);
    }
    return {
        items: tops.map((t,) => {
            const c = byId.get(t.id,)!;
            const more = hidden.get(t.id,) ?? 0;
            return more > 0 ? { ...c, hiddenReplies: more, } : c;
        },),
        total, page, limit,
    };
}

/** One comment row with its author card (null when missing). */
export async function getRow(id: string, client?: PoolClient,): Promise<CommentRow | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id,)) return null;
    const sql = `SELECT ${COMMENT_COLUMNS} FROM comments c ${AUTHOR_JOIN} WHERE c.id = $1`;
    const r = client ? await client.query<CommentRow>(sql, [id,],) : await query<CommentRow>(sql, [id,],);
    return r.rows[0] ?? null;
}

/**
 * A comment entered (+1) or left (−1) `visible`: author activity, the parent's
 * reply count and the target's counters. Call inside the write transaction.
 */
export async function applyVisibility(client: PoolClient, row: CommentRow, delta: 1 | -1,): Promise<void> {
    const target = await getTarget(row.target_type,).catch(() => null);
    if (row.author_id) {
        const kind = target?.activityKind(Boolean(row.is_opening,),)
            ?? (row.target_type === 'forum_thread' ? (row.is_opening ? 'forum_threads' : 'forum_replies') : 'comments');
        await adjustActivity(client, row.author_id, kind, delta,);
    }
    if (row.parent_id) {
        await client.query(`UPDATE comments SET reply_count = GREATEST(0, reply_count + $2) WHERE id = $1`, [row.parent_id, delta,],);
    }
    await target?.onCountChange?.(client, row.target_id, delta, { isOpening: Boolean(row.is_opening,), createdAt: row.created_at, authorId: row.author_id, },);
}

export interface CreateContext {
    ip?: string | null;
    /** Internal: the forum creating a thread's opening post. */
    isOpening?: boolean;
    /** Internal: run inside the caller's transaction. */
    client?: PoolClient;
}

export async function create(input: DiscussionsCommentCreateBody, viewer: Viewer, ctx: CreateContext = {},): Promise<Comment> {
    const { type, id, } = parseTarget(input.target,);
    const target = await getTarget(type,);
    const access = await target.access(id, viewer,);
    if (!access) throw new NotFoundError('Comments',);
    if (!access.canRead) throw new ForbiddenError(access.reason || 'You cannot comment here.',);
    if (!access.canComment && !ctx.isOpening) throw new ForbiddenError(access.reason || 'Comments are closed.',);

    const guest = !viewer.id;
    if (guest) {
        if (!access.allowAnonymous) throw new ForbiddenError('Sign in to comment.',);
        const key = target.anonymousPermission ?? 'comments:anonymous';
        if (!(await permissions.can(viewer, key,).catch(() => false))) throw new ForbiddenError('Sign in to comment.',);
    } else if (!(await permissions.can(viewer, target.writePermission as never,).catch(() => false))) {
        throw new ForbiddenError('You do not have permission to post here.',);
    }

    const settings = await getSettings();
    const body = String(input.body ?? '',).trim();
    if (!body) throw new ValidationError('Write something first.',);
    if (body.length > settings.maxLength) throw new ValidationError(`Comments are limited to ${settings.maxLength} characters.`,);
    const guestName = guest ? String(input.guestName ?? '',).trim().slice(0, 80,) || null : null;
    const guestEmail = guest ? String(input.guestEmail ?? '',).trim().slice(0, 255,) || null : null;
    if (guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail,)) throw new ValidationError('That email address does not look right.',);

    await checkWriteRate(viewer.id, ctx.ip,);

    // Honeypot: a bot filled the hidden field. Answer as if it were held for
    // review and store nothing.
    if (input.website) {
        return mapComment({
            id: crypto.randomUUID(), target_type: type, target_id: id, parent_id: input.parentId ?? null, root_id: null,
            depth: 0, author_id: null, guest_name: guestName, guest_email: null, guest_ip: null, body, status: 'pending',
            is_opening: false, edited_at: null, edit_count: 0, reaction_counts: {}, reply_count: 0,
            created_at: new Date(), updated_at: new Date(),
        },);
    }

    let pending = (await target.needsApproval?.(viewer, guest,)) ?? false;
    if (guest && countLinks(body,) > 2) pending = true;

    const run = async (client: PoolClient,): Promise<string> => {
        let parentId: string | null = null;
        let rootId: string | null = null;
        let depth = 0;
        if (input.parentId) {
            const p = (await client.query<CommentRow>(`SELECT * FROM comments WHERE id = $1`, [input.parentId,],)).rows[0];
            if (!p || p.target_type !== type || p.target_id !== id) throw new ValidationError('That comment is not on this item.',);
            if (p.status !== 'visible' && p.status !== 'pending') throw new ValidationError('You cannot reply to that comment.',);
            parentId = p.id;
            rootId = p.root_id ?? p.id;
            depth = Number(p.depth,) + 1;
        }
        const ins = await client.query<CommentRow>(
            `INSERT INTO comments (target_type, target_id, parent_id, root_id, depth, author_id, guest_name, guest_email, guest_ip,
                                   body, status, is_opening)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
            [type, id, parentId, rootId, depth, viewer.id ?? null, guestName, guestEmail, guest ? (ctx.ip ?? null) : null,
                body, pending ? 'pending' : 'visible', Boolean(ctx.isOpening,),],
        );
        const row = ins.rows[0];
        if (row.status === 'visible') await applyVisibility(client, row, 1,);
        return row.id;
    };
    const newId = ctx.client ? await run(ctx.client,) : await transaction(run,);
    const row = (await getRow(newId, ctx.client,))!;
    if (!ctx.client) emitDiscussionEvent({ type: 'created', comment: row, actor: viewer, },);
    return (await mapForViewer([row,], viewer,))[0];
}

/** Load a comment the viewer may act on, or throw. */
async function loadForAction(id: string, viewer: Viewer,): Promise<{ row: CommentRow; moderator: boolean; }> {
    const row = await getRow(id,);
    if (!row) throw new NotFoundError('Comment',);
    const moderator = await isModerator(viewer,);
    if (!moderator) {
        const target = await getTarget(row.target_type,);
        const access = await target.access(row.target_id, viewer,);
        if (!access?.canRead) throw new NotFoundError('Comment',);
    }
    return { row, moderator, };
}

export async function update(id: string, bodyIn: string, viewer: Viewer,): Promise<Comment> {
    const { row, moderator, } = await loadForAction(id, viewer,);
    if (row.status === 'deleted') throw new ValidationError('A deleted comment cannot be edited.',);
    const own = Boolean(viewer.id,) && row.author_id === viewer.id;
    if (!moderator) {
        if (!own || !(await permissions.can(viewer, 'discussions:edit_own',).catch(() => false))) throw new ForbiddenError('You cannot edit this comment.',);
        if (!(await inEditWindow(row.created_at,))) throw new ForbiddenError('The time to edit this comment has passed.',);
    }
    const { maxLength, } = await getSettings();
    const body = String(bodyIn ?? '',).trim();
    if (!body) throw new ValidationError('Write something first.',);
    if (body.length > maxLength) throw new ValidationError(`Comments are limited to ${maxLength} characters.`,);
    if (body === row.body) return (await mapForViewer([row,], viewer, moderator,))[0];

    await transaction(async (client,) => {
        await client.query(`INSERT INTO comment_edits (comment_id, body, edited_by) VALUES ($1, $2, $3)`, [row.id, row.body, viewer.id ?? null,],);
        // Keep the last 10 versions.
        await client.query(
            `DELETE FROM comment_edits WHERE comment_id = $1 AND id NOT IN (
                SELECT id FROM comment_edits WHERE comment_id = $1 ORDER BY edited_at DESC LIMIT 10)`,
            [row.id,],
        );
        await client.query(
            `UPDATE comments SET body = $2, edited_at = NOW(), edit_count = edit_count + 1, updated_at = NOW() WHERE id = $1`,
            [row.id, body,],
        );
    },);
    const fresh = (await getRow(row.id,))!;
    emitDiscussionEvent({ type: 'edited', comment: fresh, actor: viewer, },);
    return (await mapForViewer([fresh,], viewer, moderator,))[0];
}

/**
 * Change a comment's status, keeping every counter in step. Returns the old
 * row. Pass `client` to run inside the caller's transaction (so e.g. a forum
 * thread's status and its opening comment change atomically).
 */
export async function setStatus(id: string, next: CommentRow['status'], client?: PoolClient,): Promise<{ before: CommentRow; after: CommentRow; }> {
    const run = async (client: PoolClient,) => {
        const before = (await client.query<CommentRow>(`SELECT * FROM comments WHERE id = $1 FOR UPDATE`, [id,],)).rows[0];
        if (!before) throw new NotFoundError('Comment',);
        if (before.status === next) return { before, after: before, };
        const after = (await client.query<CommentRow>(
            `UPDATE comments SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`, [id, next,],
        )).rows[0];
        if (before.status === 'visible') await applyVisibility(client, before, -1,);
        if (next === 'visible') await applyVisibility(client, after, 1,);
        return { before, after, };
    };
    return client ? run(client,) : transaction(run,);
}

export async function remove(id: string, viewer: Viewer,): Promise<void> {
    const { row, moderator, } = await loadForAction(id, viewer,);
    if (row.status === 'deleted') return;
    const own = Boolean(viewer.id,) && row.author_id === viewer.id;
    if (!moderator && (!own || !(await permissions.can(viewer, 'discussions:delete_own',).catch(() => false)))) {
        throw new ForbiddenError('You cannot delete this comment.',);
    }
    if (row.is_opening && !moderator) throw new ValidationError('Delete the thread instead.',);
    const { after, } = await setStatus(row.id, 'deleted',);
    await query(`UPDATE comment_reports SET status = 'resolved', resolved_by = $2, resolved_at = NOW() WHERE comment_id = $1 AND status = 'open'`, [row.id, viewer.id ?? null,],);
    emitDiscussionEvent({ type: 'deleted', comment: after, actor: viewer, },);
}

/**
 * A deep link's comment → its top-level comment, for the viewer. 404 unless
 * the viewer may read the item AND see the comment (visible, a deleted one
 * that still has replies, their own pending one, or any for a moderator).
 */
export async function locate(id: string, viewer: Viewer,): Promise<{ id: string; rootId: string; target: CommentTargetRef; }> {
    const row = await getRow(id,);
    if (!row) throw new NotFoundError('Comment',);
    const target = await getTarget(row.target_type,).catch(() => null);
    if (!target) throw new NotFoundError('Comment',);
    const moderator = await isModerator(viewer,);
    if (!moderator) {
        const access = await target.access(row.target_id, viewer,);
        if (!access?.canRead) throw new NotFoundError('Comment',);
        const own = Boolean(viewer.id,) && row.author_id === viewer.id;
        const seen = row.status === 'visible' || (row.status === 'deleted' && Number(row.reply_count,) > 0) || (own && row.status === 'pending');
        if (!seen) throw new NotFoundError('Comment',);
    }
    return { id: row.id, rootId: row.root_id ?? row.id, target: `${row.target_type}:${row.target_id}` as CommentTargetRef, };
}

/** Edit history, newest first (moderators). */
export async function history(id: string, viewer: Viewer,): Promise<{ body: string; editedBy: string | null; editedAt: string; }[]> {
    if (!(await isModerator(viewer,))) throw new ForbiddenError();
    const r = await query<{ body: string; edited_by: string | null; edited_at: Date; }>(
        `SELECT body, edited_by, edited_at FROM comment_edits WHERE comment_id = $1 ORDER BY edited_at DESC`, [id,],
    );
    return r.rows.map((e,) => ({ body: e.body, editedBy: e.edited_by, editedAt: new Date(e.edited_at,).toISOString(), }));
}
