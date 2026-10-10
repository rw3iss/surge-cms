/**
 * Forum categories + threads.
 *
 * A thread row holds the title, category, pin/lock and counters; its opening
 * post and replies are discussion comments on `forum_thread:<id>`. Creating a
 * thread writes the thread AND its opening comment in one transaction, and
 * every counter (category threads/posts, thread replies, author activity)
 * moves only when a comment enters or leaves `visible` — through the engine's
 * `applyVisibility` / `setStatus`, via this feature's `forum_thread` target.
 */
import type {
    ForumAdminThreadsQuery, ForumCategory, ForumCategoryBody, ForumThread, ForumThreadAction, ForumThreadDetail,
    ForumThreadStatus,
} from '@sitesurge/types';
import { generateSlug, } from '@sitesurge/types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, } from '../../core/errors';
import { query, transaction, } from '../../db';
import * as permissions from '../permissions';
import { getRedis, } from '../cache';
import { applyVisibility, getRow, mapForViewer, setStatus, } from '../discussions/comments';
import { emitDiscussionEvent, } from '../discussions/events';
import { type CommentRow, excerptOf, mapAuthor, } from '../discussions/rows';
import { getSettings as getEngineSettings, } from '../discussions/settings';
import { checkWriteRate, } from '../discussions/spam';
import { isModerator, isStaffViewer, type Viewer, } from '../discussions/viewer';
import { canPostCategory, canReadCategory, canReplyCategory, viewerLevel, } from './access';
import { getSettings, } from './settings';

// ─── Rows ───────────────────────────────────────────────────────────

interface CategoryRow {
    id: string; slug: string; name: string; description: string | null; sort_order: number; parent_id: string | null;
    read_min_rank: number | null; post_min_rank: number | null; locked: boolean; thread_count: number; post_count: number;
    last_thread_id: string | null; last_post_at: Date | null;
    lt_slug?: string | null; lt_title?: string | null; lt_author?: string | null;
}

interface ThreadRow {
    id: string; category_id: string; slug: string; title: string; author_id: string | null; status: ForumThreadStatus;
    pinned: boolean; locked: boolean; reply_count: number; view_count: number; last_reply_at: Date | null;
    last_reply_user_id: string | null; created_at: Date; updated_at: Date;
    c_slug: string; c_name: string; read_min_rank: number | null; post_min_rank: number | null; c_locked: boolean;
    a_name: string | null; a_handle: string | null; a_public: boolean | null; a_avatar: string | null; a_role: string | null;
    a_joined: Date | null; a_activity: number | null; a_tier: string | null;
    lr_name: string | null; lr_handle: string | null; opening_body: string | null; reactions: number | null;
}

const THREAD_SELECT = `
    SELECT t.*, fc.slug AS c_slug, fc.name AS c_name, fc.read_min_rank, fc.post_min_rank, fc.locked AS c_locked,
           u.display_name AS a_name, u.handle AS a_handle, u.profile_public AS a_public, u.avatar_url AS a_avatar,
           u.role AS a_role, u.created_at AS a_joined, COALESCE(ua.total, 0) AS a_activity,
           (SELECT sp.name FROM subscriptions s JOIN subscription_plans sp ON sp.id = s.plan_id
             WHERE s.user_id = t.author_id AND s.status = ANY(ARRAY['active','trialing','past_due'])
             ORDER BY sp.sort_order DESC LIMIT 1) AS a_tier,
           lu.display_name AS lr_name, CASE WHEN lu.profile_public THEN lu.handle END AS lr_handle,
           oc.body AS opening_body,
           (SELECT COALESCE(SUM(v::int), 0) FROM jsonb_each_text(oc.reaction_counts) AS j(k, v)) AS reactions
      FROM forum_threads t
      JOIN forum_categories fc ON fc.id = t.category_id
      LEFT JOIN users u ON u.id = t.author_id
      LEFT JOIN user_activity ua ON ua.user_id = t.author_id
      LEFT JOIN users lu ON lu.id = t.last_reply_user_id
      LEFT JOIN comments oc ON oc.target_type = 'forum_thread' AND oc.target_id = t.id AND oc.is_opening`;

export const threadUrl = (categorySlug: string, threadSlug: string,): string => `/forum/${categorySlug}/${threadSlug}`;

function mapThread(r: ThreadRow,): ForumThread {
    const author = mapAuthor({
        author_id: r.author_id, guest_name: null, guest_email: null, guest_ip: null,
        a_name: r.a_name, a_handle: r.a_handle, a_public: r.a_public, a_avatar: r.a_avatar, a_role: r.a_role,
        a_joined: r.a_joined, a_activity: r.a_activity, a_tier: r.a_tier,
    } as CommentRow,);
    return {
        id: r.id,
        categoryId: r.category_id,
        category: { id: r.category_id, slug: r.c_slug, name: r.c_name, },
        slug: r.slug,
        title: r.title,
        url: threadUrl(r.c_slug, r.slug,),
        author,
        status: r.status,
        pinned: r.pinned,
        locked: r.locked,
        replyCount: Number(r.reply_count,),
        viewCount: Number(r.view_count,),
        reactionCount: Number(r.reactions ?? 0,),
        lastReplyAt: r.last_reply_at ? new Date(r.last_reply_at,).toISOString() : null,
        lastReplyBy: r.lr_name ? { name: r.lr_name, handle: r.lr_handle, } : null,
        createdAt: new Date(r.created_at,).toISOString(),
        updatedAt: new Date(r.updated_at,).toISOString(),
        excerpt: r.opening_body ? excerptOf(r.opening_body,) : '',
    };
}

async function canModerate(v: Viewer,): Promise<boolean> {
    if (!v.id) return false;
    if (await isModerator(v,)) return true;
    return permissions.can(v, 'forum:moderate',).catch(() => false);
}

async function requireManage(v: Viewer,): Promise<void> {
    if (!v.id || !(await permissions.can(v, 'forum:manage',).catch(() => false))) throw new ForbiddenError();
}

// ─── Categories ─────────────────────────────────────────────────────

function mapCategory(r: CategoryRow, canPost: boolean,): ForumCategory {
    return {
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        sortOrder: Number(r.sort_order,),
        parentId: r.parent_id,
        readMinRank: r.read_min_rank,
        postMinRank: r.post_min_rank,
        locked: r.locked,
        threadCount: Number(r.thread_count,),
        postCount: Number(r.post_count,),
        lastPostAt: r.last_post_at ? new Date(r.last_post_at,).toISOString() : null,
        lastThread: r.last_thread_id && r.lt_slug
            ? { id: r.last_thread_id, slug: r.lt_slug, title: r.lt_title ?? '', author: r.lt_author ?? null, }
            : null,
        canPost,
    };
}

const CATEGORY_SELECT = `
    SELECT fc.*, lt.slug AS lt_slug, lt.title AS lt_title, lu.display_name AS lt_author
      FROM forum_categories fc
      LEFT JOIN forum_threads lt ON lt.id = fc.last_thread_id AND lt.status = 'visible'
      LEFT JOIN users lu ON lu.id = lt.author_id`;

/** Categories the viewer may read (all of them for managers, flagged). */
export async function listCategories(viewer: Viewer,): Promise<ForumCategory[]> {
    const [s, level, manager,] = await Promise.all([
        getSettings(), viewerLevel(viewer,), permissions.can(viewer, 'forum:manage',).catch(() => false),
    ],);
    const canStart = viewer.id ? await permissions.can(viewer, 'forum:thread_create',).catch(() => false) : false;
    const rows = (await query<CategoryRow>(`${CATEGORY_SELECT} ORDER BY fc.sort_order, fc.name`,)).rows;
    return rows
        .filter((r,) => manager || canReadCategory(level, s, r,))
        .map((r,) => mapCategory(r, canStart && canPostCategory(level, s, r,),));
}

async function categoryBy(column: 'id' | 'slug', value: string,): Promise<CategoryRow> {
    const r = (await query<CategoryRow>(`${CATEGORY_SELECT} WHERE fc.${column} = $1`, [value,],)).rows[0];
    if (!r) throw new NotFoundError('Forum category',);
    return r;
}

async function uniqueCategorySlug(base: string, exceptId?: string,): Promise<string> {
    const root = generateSlug(base,).slice(0, 70,) || 'category';
    for (let i = 0; i < 50; i++) {
        const slug = i ? `${root}-${i}` : root;
        const hit = await query(`SELECT 1 FROM forum_categories WHERE slug = $1 AND id IS DISTINCT FROM $2`, [slug, exceptId ?? null,],);
        if (!hit.rows.length) return slug;
    }
    throw new ConflictError('Could not find a free slug for that category.',);
}

export async function saveCategory(id: string | null, body: ForumCategoryBody, viewer: Viewer,): Promise<ForumCategory> {
    await requireManage(viewer,);
    const name = String(body.name ?? '',).trim();
    if (!name && !id) throw new ValidationError('Name is required.',);
    const rank = (v: number | null | undefined,) => (v === undefined ? undefined : v === null ? null : Math.max(0, Math.round(Number(v,),),));
    if (!id) {
        const slug = await uniqueCategorySlug(body.slug || name,);
        const r = await query<{ id: string; }>(
            `INSERT INTO forum_categories (slug, name, description, parent_id, read_min_rank, post_min_rank, locked, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, false),
                     COALESCE($8, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM forum_categories))) RETURNING id`,
            [slug, name, body.description ?? null, body.parentId ?? null, rank(body.readMinRank,) ?? null, rank(body.postMinRank,) ?? null,
                body.locked ?? null, body.sortOrder ?? null,],
        );
        return mapCategory(await categoryBy('id', r.rows[0].id,), true,);
    }
    const cur = await categoryBy('id', id,);
    const slug = body.slug !== undefined && body.slug !== cur.slug ? await uniqueCategorySlug(body.slug || name || cur.name, id,) : cur.slug;
    await query(
        `UPDATE forum_categories SET slug = $2, name = COALESCE(NULLIF($3, ''), name),
                description = CASE WHEN $4 THEN $5 ELSE description END,
                parent_id = CASE WHEN $6 THEN $7::uuid ELSE parent_id END,
                read_min_rank = CASE WHEN $8 THEN $9::int ELSE read_min_rank END,
                post_min_rank = CASE WHEN $10 THEN $11::int ELSE post_min_rank END,
                locked = COALESCE($12, locked), sort_order = COALESCE($13, sort_order), updated_at = NOW()
          WHERE id = $1`,
        [id, slug, name, body.description !== undefined, body.description ?? null, body.parentId !== undefined, body.parentId ?? null,
            body.readMinRank !== undefined, rank(body.readMinRank,) ?? null, body.postMinRank !== undefined, rank(body.postMinRank,) ?? null,
            body.locked ?? null, body.sortOrder ?? null,],
    );
    return mapCategory(await categoryBy('id', id,), true,);
}

export async function removeCategory(id: string, viewer: Viewer,): Promise<void> {
    await requireManage(viewer,);
    const used = await query(`SELECT 1 FROM forum_threads WHERE category_id = $1 LIMIT 1`, [id,],);
    if (used.rows.length) throw new ConflictError('Move or delete this category\'s threads first.',);
    await query(`DELETE FROM forum_categories WHERE id = $1`, [id,],);
}

export async function reorderCategories(ids: string[], viewer: Viewer,): Promise<void> {
    await requireManage(viewer,);
    await transaction(async (c,) => {
        for (let i = 0; i < ids.length; i++) await c.query(`UPDATE forum_categories SET sort_order = $2 WHERE id = $1`, [ids[i], i,],);
    },);
}

// ─── Threads ────────────────────────────────────────────────────────

/** Visibility of thread rows for a viewer (SQL). */
function threadVisibility(viewer: Viewer, moderator: boolean, params: unknown[],): string {
    if (moderator) return `t.status <> 'deleted'`;
    if (viewer.id) {
        params.push(viewer.id,);
        return `(t.status = 'visible' OR (t.status = 'pending' AND t.author_id = $${params.length}))`;
    }
    return `t.status = 'visible'`;
}

export async function categoryThreads(slug: string, viewer: Viewer, page = 1, limitIn?: number,): Promise<{ category: ForumCategory; threads: ForumThread[]; total: number; page: number; limit: number; }> {
    const s = await getSettings();
    const level = await viewerLevel(viewer,);
    const cat = await categoryBy('slug', slug,);
    const moderator = await canModerate(viewer,);
    if (!moderator && !canReadCategory(level, s, cat,)) {
        throw new ForbiddenError(level < 0 ? 'Sign in to read the forum.' : 'This part of the forum is for subscribers.',);
    }
    const limit = Math.min(100, Math.max(5, limitIn ?? s.threadsPerPage,),);
    page = Math.max(1, page,);
    const params: unknown[] = [cat.id,];
    const vis = threadVisibility(viewer, moderator, params,);
    const total = Number((await query<{ n: number; }>(`SELECT COUNT(*)::int AS n FROM forum_threads t WHERE t.category_id = $1 AND ${vis}`, params,)).rows[0]?.n ?? 0,);
    const rows = (await query<ThreadRow>(
        `${THREAD_SELECT} WHERE t.category_id = $1 AND ${vis}
          ORDER BY t.pinned DESC, COALESCE(t.last_reply_at, t.created_at) DESC
          LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
        params,
    )).rows;
    const canStart = viewer.id ? await permissions.can(viewer, 'forum:thread_create',).catch(() => false) : false;
    return { category: mapCategory(cat, canStart && canPostCategory(level, s, cat,),), threads: rows.map(mapThread,), total, page, limit, };
}

async function threadRow(where: string, params: unknown[],): Promise<ThreadRow | null> {
    return (await query<ThreadRow>(`${THREAD_SELECT} WHERE ${where}`, params,)).rows[0] ?? null;
}

/** Count a view at most once per viewer (or IP) per 6 hours. Best effort. */
async function countView(threadId: string, who: string,): Promise<void> {
    try {
        const fresh = await getRedis().set(`forum:view:${threadId}:${who}`, '1', 'EX', 6 * 3600, 'NX',);
        if (fresh) await query(`UPDATE forum_threads SET view_count = view_count + 1 WHERE id = $1`, [threadId,],);
    } catch { /* never block a page view */ }
}

async function detail(r: ThreadRow, viewer: Viewer,): Promise<ForumThreadDetail> {
    const s = await getSettings();
    const level = await viewerLevel(viewer,);
    const moderator = await canModerate(viewer,);
    const cat = { read_min_rank: r.read_min_rank, post_min_rank: r.post_min_rank, locked: r.c_locked, };
    const openingRow = (await query<{ id: string; }>(
        `SELECT id FROM comments WHERE target_type = 'forum_thread' AND target_id = $1 AND is_opening`, [r.id,],
    )).rows[0];
    const fullOpening = openingRow ? await getRow(openingRow.id,) : null;
    const opening = fullOpening ? (await mapForViewer([fullOpening,], viewer, moderator,))[0] : null;
    let replyBlockedReason: string | null = null;
    const canReplyPerm = viewer.id ? await permissions.can(viewer, 'forum:reply',).catch(() => false) : false;
    if (!viewer.id) replyBlockedReason = 'Sign in to reply.';
    else if (r.locked || r.c_locked) replyBlockedReason = 'This thread is locked.';
    else if (r.status !== 'visible') replyBlockedReason = 'This thread is awaiting approval.';
    else if (!canReplyPerm || !canReplyCategory(level, s, cat,)) replyBlockedReason = 'Replying here needs a higher subscription.';
    return {
        ...mapThread(r,),
        opening,
        canReply: !replyBlockedReason || moderator,
        canEdit: moderator || (Boolean(viewer.id,) && r.author_id === viewer.id && Boolean(opening?.canEdit,)),
        canModerate: moderator,
        replyBlockedReason: moderator ? null : replyBlockedReason,
    };
}

/** The thread page (counts a view). */
export async function getThread(categorySlug: string, threadSlug: string, viewer: Viewer, who: string,): Promise<ForumThreadDetail> {
    const r = await threadRow(`fc.slug = $1 AND t.slug = $2`, [categorySlug, threadSlug,],);
    if (!r) throw new NotFoundError('Thread',);
    await assertCanReadThread(r, viewer,);
    void countView(r.id, viewer.id ?? who,);
    return detail(r, viewer,);
}

export async function getThreadById(id: string, viewer: Viewer,): Promise<ForumThreadDetail> {
    const r = await threadRow(`t.id = $1`, [id,],);
    if (!r) throw new NotFoundError('Thread',);
    await assertCanReadThread(r, viewer,);
    return detail(r, viewer,);
}

async function assertCanReadThread(r: ThreadRow, viewer: Viewer,): Promise<void> {
    if (await canModerate(viewer,)) return;
    const own = Boolean(viewer.id,) && r.author_id === viewer.id;
    if (r.status !== 'visible' && !(own && r.status === 'pending')) throw new NotFoundError('Thread',);
    const s = await getSettings();
    const level = await viewerLevel(viewer,);
    if (!canReadCategory(level, s, { read_min_rank: r.read_min_rank, post_min_rank: r.post_min_rank, locked: r.c_locked, },)) {
        throw new ForbiddenError(level < 0 ? 'Sign in to read the forum.' : 'This part of the forum is for subscribers.',);
    }
}

/** Should this member's new forum post wait for approval? */
export async function forumNeedsApproval(viewer: Viewer,): Promise<boolean> {
    if (isStaffViewer(viewer,)) return false;
    const s = await getSettings();
    if (s.approveAll) return true;
    if (!s.approveUntil || !viewer.id) return false;
    const r = await query<{ n: number; }>(
        `SELECT COALESCE(forum_threads + forum_replies, 0)::int AS n FROM user_activity WHERE user_id = $1`, [viewer.id,],
    );
    return Number(r.rows[0]?.n ?? 0,) < s.approveUntil;
}

async function uniqueThreadSlug(categoryId: string, title: string, client: { query: typeof query; },): Promise<string> {
    const root = generateSlug(title,).slice(0, 140,) || 'thread';
    for (let i = 0; i < 100; i++) {
        const slug = i ? `${root}-${i}` : root;
        const hit = await client.query(`SELECT 1 FROM forum_threads WHERE category_id = $1 AND slug = $2`, [categoryId, slug,],);
        if (!hit.rows.length) return slug;
    }
    return `${root}-${Date.now().toString(36,)}`;
}

export async function createThread(input: { categoryId: string; title: string; body: string; }, viewer: Viewer, ip: string | null,): Promise<ForumThreadDetail> {
    if (!viewer.id) throw new ForbiddenError('Sign in to start a thread.',);
    if (!(await permissions.can(viewer, 'forum:thread_create',).catch(() => false))) throw new ForbiddenError('You cannot start threads.',);
    const s = await getSettings();
    const level = await viewerLevel(viewer,);
    const cat = await categoryBy('id', input.categoryId,);
    if (!canPostCategory(level, s, cat,)) throw new ForbiddenError(cat.locked ? 'This category is locked.' : 'Starting threads here needs a higher subscription.',);
    const title = String(input.title ?? '',).trim();
    const body = String(input.body ?? '',).trim();
    if (title.length < 3 || title.length > 200) throw new ValidationError('The title must be 3–200 characters.',);
    const { maxLength, } = await getEngineSettings();
    if (!body) throw new ValidationError('Write the first post.',);
    if (body.length > maxLength) throw new ValidationError(`Posts are limited to ${maxLength} characters.`,);
    await checkWriteRate(viewer.id, ip,);
    const status: ForumThreadStatus = (await forumNeedsApproval(viewer,)) ? 'pending' : 'visible';

    const { threadId, commentId, } = await transaction(async (client,) => {
        const slug = await uniqueThreadSlug(cat.id, title, client as never,);
        const t = await client.query<{ id: string; }>(
            `INSERT INTO forum_threads (category_id, slug, title, author_id, status) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [cat.id, slug, title, viewer.id, status,],
        );
        const c = await client.query<CommentRow>(
            `INSERT INTO comments (target_type, target_id, author_id, body, status, is_opening)
             VALUES ('forum_thread', $1, $2, $3, $4, true) RETURNING *`,
            [t.rows[0].id, viewer.id, body, status,],
        );
        if (status === 'visible') await applyVisibility(client, c.rows[0], 1,);
        return { threadId: t.rows[0].id, commentId: c.rows[0].id, };
    },);
    const row = await getRow(commentId,);
    if (row) emitDiscussionEvent({ type: 'created', comment: row, actor: viewer, },);
    return getThreadById(threadId, viewer,);
}

/** Title / category (author or moderator). */
export async function updateThread(id: string, patch: { title?: string; categoryId?: string; }, viewer: Viewer,): Promise<ForumThreadDetail> {
    const r = await threadRow(`t.id = $1`, [id,],);
    if (!r) throw new NotFoundError('Thread',);
    const moderator = await canModerate(viewer,);
    const own = Boolean(viewer.id,) && r.author_id === viewer.id;
    if (!moderator && !(own && (await permissions.can(viewer, 'discussions:edit_own',).catch(() => false)))) throw new ForbiddenError();
    if (patch.categoryId && patch.categoryId !== r.category_id && !moderator) throw new ForbiddenError('Only moderators can move threads.',);
    const title = patch.title !== undefined ? String(patch.title,).trim() : r.title;
    if (title.length < 3 || title.length > 200) throw new ValidationError('The title must be 3–200 characters.',);
    const categoryId = patch.categoryId ?? r.category_id;
    if (categoryId !== r.category_id) await categoryBy('id', categoryId,);
    await transaction(async (client,) => {
        const slug = categoryId !== r.category_id ? await uniqueThreadSlug(categoryId, r.slug, client as never,) : r.slug;
        await client.query(`UPDATE forum_threads SET title = $2, category_id = $3, slug = $4, updated_at = NOW() WHERE id = $1`, [id, title, categoryId, slug,],);
    },);
    if (categoryId !== r.category_id) await reconcileCategories([r.category_id, categoryId,],);
    return getThreadById(id, viewer,);
}

/** Moderation of a whole thread. Status changes go through the opening comment so counters stay right. */
export async function actOnThread(id: string, action: ForumThreadAction, viewer: Viewer,): Promise<{ id: string; status: ForumThreadStatus; pinned: boolean; locked: boolean; }> {
    const r = await threadRow(`t.id = $1`, [id,],);
    if (!r) throw new NotFoundError('Thread',);
    const moderator = await canModerate(viewer,);
    const own = Boolean(viewer.id,) && r.author_id === viewer.id;
    // An author may delete their own thread while nobody has replied.
    const ownDelete = action === 'delete' && own && Number(r.reply_count,) === 0
        && (await permissions.can(viewer, 'discussions:delete_own',).catch(() => false));
    if (!moderator && !ownDelete) throw new ForbiddenError();
    const statusFor: Partial<Record<ForumThreadAction, ForumThreadStatus>> = { approve: 'visible', restore: 'visible', hide: 'hidden', delete: 'deleted', };
    const flag: Partial<Record<ForumThreadAction, [string, boolean,]>> = {
        pin: ['pinned', true,], unpin: ['pinned', false,], lock: ['locked', true,], unlock: ['locked', false,],
    };
    if (flag[action]) {
        const [col, val,] = flag[action]!;
        await query(`UPDATE forum_threads SET ${col} = $2, updated_at = NOW() WHERE id = $1`, [id, val,],);
    } else if (statusFor[action]) {
        const next = statusFor[action]!;
        await query(`UPDATE forum_threads SET status = $2, updated_at = NOW() WHERE id = $1`, [id, next,],);
        const opening = (await query<{ id: string; }>(
            `SELECT id FROM comments WHERE target_type = 'forum_thread' AND target_id = $1 AND is_opening`, [id,],
        )).rows[0];
        if (opening) {
            const { after, } = await setStatus(opening.id, next,);
            emitDiscussionEvent({
                type: next === 'visible' ? (action === 'approve' ? 'approved' : 'restored') : next === 'hidden' ? 'hidden' : 'deleted',
                comment: after, actor: viewer,
            },);
        }
    } else {
        throw new ValidationError('Unknown action',);
    }
    const t = (await query<{ status: ForumThreadStatus; pinned: boolean; locked: boolean; }>(
        `SELECT status, pinned, locked FROM forum_threads WHERE id = $1`, [id,],
    )).rows[0];
    return { id, ...t, };
}

/** Admin list across categories. */
export async function adminThreads(q: ForumAdminThreadsQuery, viewer: Viewer,): Promise<{ items: ForumThread[]; total: number; page: number; limit: number; }> {
    if (!(await canModerate(viewer,))) throw new ForbiddenError();
    const page = Math.max(1, Number(q.page ?? 1,),);
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 25,),),);
    const params: unknown[] = [];
    const where: string[] = [];
    if (q.status && q.status !== 'all') { params.push(q.status,); where.push(`t.status = $${params.length}`,); }
    else if (!q.status) where.push(`t.status <> 'deleted'`,);
    if (q.category) { params.push(q.category,); where.push(`(fc.slug = $${params.length} OR fc.id::text = $${params.length})`,); }
    if (q.pinned !== undefined) { params.push(Boolean(q.pinned,),); where.push(`t.pinned = $${params.length}`,); }
    if (q.search) { params.push(`%${q.search}%`,); where.push(`(t.title ILIKE $${params.length} OR u.display_name ILIKE $${params.length})`,); }
    const w = where.length ? `WHERE ${where.join(' AND ',)}` : '';
    const total = Number((await query<{ n: number; }>(
        `SELECT COUNT(*)::int AS n FROM forum_threads t JOIN forum_categories fc ON fc.id = t.category_id LEFT JOIN users u ON u.id = t.author_id ${w}`,
        params,
    )).rows[0]?.n ?? 0,);
    const rows = (await query<ThreadRow>(
        `${THREAD_SELECT} ${w} ORDER BY COALESCE(t.last_reply_at, t.created_at) DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params,
    )).rows;
    return { items: rows.map(mapThread,), total, page, limit, };
}

// ─── Counters (target hooks + reconcile) ────────────────────────────

/** A forum comment entered/left `visible` (inside the comment write transaction). */
export async function onForumCount(
    client: { query: typeof query; }, threadId: string, delta: number, c: { isOpening: boolean; authorId: string | null; },
): Promise<void> {
    if (c.isOpening) {
        await client.query(
            `UPDATE forum_categories SET thread_count = GREATEST(0, thread_count + $2), post_count = GREATEST(0, post_count + $2),
                    last_post_at = CASE WHEN $2::int > 0 THEN NOW() ELSE last_post_at END,
                    last_thread_id = CASE WHEN $2::int > 0 THEN $1::uuid ELSE last_thread_id END
              WHERE id = (SELECT category_id FROM forum_threads WHERE id = $1)`,
            [threadId, delta,],
        );
        return;
    }
    await client.query(
        `UPDATE forum_threads SET reply_count = GREATEST(0, reply_count + $2),
                last_reply_at = CASE WHEN $2::int > 0 THEN NOW() ELSE last_reply_at END,
                last_reply_user_id = CASE WHEN $2::int > 0 THEN $3::uuid ELSE last_reply_user_id END
          WHERE id = $1`,
        [threadId, delta, c.authorId,],
    );
    await client.query(
        `UPDATE forum_categories SET post_count = GREATEST(0, post_count + $2),
                last_post_at = CASE WHEN $2::int > 0 THEN NOW() ELSE last_post_at END,
                last_thread_id = CASE WHEN $2::int > 0 THEN $1::uuid ELSE last_thread_id END
          WHERE id = (SELECT category_id FROM forum_threads WHERE id = $1)`,
        [threadId, delta,],
    );
}

/** Recompute category counters (all, or the given ids). */
export async function reconcileCategories(ids?: string[],): Promise<void> {
    await query(
        `UPDATE forum_categories fc SET
            thread_count = (SELECT COUNT(*) FROM forum_threads t WHERE t.category_id = fc.id AND t.status = 'visible'),
            post_count = (SELECT COUNT(*) FROM comments c JOIN forum_threads t ON t.id = c.target_id
                           WHERE c.target_type = 'forum_thread' AND c.status = 'visible' AND t.category_id = fc.id AND t.status = 'visible'),
            last_post_at = (SELECT MAX(c.created_at) FROM comments c JOIN forum_threads t ON t.id = c.target_id
                             WHERE c.target_type = 'forum_thread' AND c.status = 'visible' AND t.category_id = fc.id AND t.status = 'visible'),
            last_thread_id = (SELECT t.id FROM forum_threads t WHERE t.category_id = fc.id AND t.status = 'visible'
                               ORDER BY COALESCE(t.last_reply_at, t.created_at) DESC LIMIT 1)
          WHERE $1::uuid[] IS NULL OR fc.id = ANY($1::uuid[])`,
        [ids ?? null,],
    );
}

export async function reconcile(): Promise<void> {
    await query(
        `UPDATE forum_threads t SET
            reply_count = x.n, last_reply_at = x.last_at, last_reply_user_id = x.last_user
           FROM (SELECT t2.id,
                        COUNT(c.id) FILTER (WHERE c.status = 'visible' AND NOT c.is_opening)::int AS n,
                        MAX(c.created_at) FILTER (WHERE c.status = 'visible' AND NOT c.is_opening) AS last_at,
                        (ARRAY_AGG(c.author_id ORDER BY c.created_at DESC) FILTER (WHERE c.status = 'visible' AND NOT c.is_opening))[1] AS last_user
                   FROM forum_threads t2
                   LEFT JOIN comments c ON c.target_type = 'forum_thread' AND c.target_id = t2.id
                  GROUP BY t2.id) x
          WHERE x.id = t.id`,
    );
    await reconcileCategories();
}

/** Keep a thread's status in step when its opening post is moderated from the shared queue. */
export async function syncThreadStatus(threadId: string, status: ForumThreadStatus,): Promise<void> {
    await query(`UPDATE forum_threads SET status = $2, updated_at = NOW() WHERE id = $1 AND status <> $2`, [threadId, status,],);
}
