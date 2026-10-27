/**
 * `GET /forum/feed` — threads for a forum BLOCK (and `{{ forum() }}`), shaped
 * for the viewer: each thread with its OPENING post (body html, reactions,
 * the viewer's rights), the newest reply's author, whether the viewer may
 * reply, and — when the block posts somewhere — the post target.
 *
 * Selection: `threads` (ids or slugs, ≤ 50, ORDER PRESERVED) or a query —
 * category (slug or id) / sort / window, paged. Sorts share discovery's SQL
 * (`threadRankSql`): latest = last activity, newest = date posted, hot, top.
 * Pinned threads do NOT float: the block is a chronological widget.
 *
 * Visibility: visible threads plus the viewer's OWN pending ones (so a poster
 * sees "awaiting approval"); categories the viewer cannot read are dropped in
 * SQL (paging stays right) and every thread then goes through the
 * `forum_thread` target's `accessMany` — the same decision replies use — for
 * read + reply. An unscoped query leaves out categories hidden from the forum
 * index; naming the category (or the threads) includes them.
 *
 * Caching: the ANONYMOUS result is cached briefly (`CACHE_KEYS.forumFeed`,
 * under the discussion-feed prefix, so every comment write / moderation drops
 * it). Signed-in viewers are computed per request (own pending threads,
 * reactions, rights).
 */
import {
    type Comment, DEFAULT_DISCUSSIONS_SETTINGS, DEFAULT_FORUM_BLOCK_LIMIT, FORUM_FEED_SORTS, FORUM_FEED_WINDOWS, type ForumFeedPostTarget, type ForumFeedQuery,
    type ForumFeedResponse, type ForumFeedSort, type ForumFeedThread, type ForumFeedWindow, type ForumSettings, MAX_FORUM_BLOCK_LIMIT,
} from '@sitesurge/types';
import { query, } from '../../db';
import { cache, CACHE_KEYS, } from '../cache';
import * as permissions from '../permissions';
import { isFeatureEnabledServer, } from '../settings';
import { mapForViewer, } from '../discussions/comments';
import { NOT_HIDDEN_CATEGORY, reactionTotal, threadRankSql, } from '../discussions/query';
import { windowHours, } from '../discussions/queryParams';
import { accessFor, } from '../discussions/readable';
import { authorColumns, authorJoin, AUTHOR_JOIN, COMMENT_COLUMNS, type CommentRow, excerptOf, mapAuthor, } from '../discussions/rows';
import { getSettings as getEngineSettings, } from '../discussions/settings';
import { isModerator, type Viewer, } from '../discussions/viewer';
import { canGuestPostCategory, canPostCategory, canReadCategory, viewerLevel, } from './access';
import { type CategoryRow, categoryByRef, threadUrl, } from './forum';
import { getSettings, } from './settings';

/** Anonymous feeds: short, the block polls (comment writes drop it sooner). */
const FEED_TTL_SECONDS = 30;
const EXCERPT_MAX = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Pure parts ─────────────────────────────────────────────────────

export interface NormalizedFeedQuery {
    /** null = query mode; [] = an empty selection (nothing to show). */
    threads: string[] | null;
    sort: ForumFeedSort;
    window: ForumFeedWindow;
    category?: string;
    postCategory?: string;
    page: number;
    limit: number;
}

const str = (v: unknown, max: number,): string | undefined => {
    const t = typeof v === 'string' ? v.trim() : '';
    return t ? t.slice(0, max,) : undefined;
};
const oneOf = <T extends string,>(v: unknown, list: readonly T[], def: T,): T => (list.includes(v as T,) ? (v as T) : def);

/** Defaults + clamps. Unknown values fall back — a block typo must still render. */
export function normalizeFeedQuery(q: ForumFeedQuery = {},): NormalizedFeedQuery {
    const threads = Array.isArray(q.threads,)
        ? [...new Set(q.threads.map((t,) => String(t ?? '',).trim().slice(0, 160,)).filter(Boolean,),),].slice(0, MAX_FORUM_BLOCK_LIMIT,)
        : null;
    const sort = oneOf(q.sort, FORUM_FEED_SORTS, 'latest',);
    return {
        threads,
        sort,
        window: oneOf(q.window, FORUM_FEED_WINDOWS, sort === 'latest' || sort === 'newest' ? 'all' : '7d',),
        category: str(q.category, 80,),
        postCategory: str(q.postCategory, 80,),
        page: threads ? 1 : Math.max(1, Math.floor(Number(q.page,) || 1,),),
        limit: Math.min(MAX_FORUM_BLOCK_LIMIT, Math.max(1, Math.floor(Number(q.limit,) || DEFAULT_FORUM_BLOCK_LIMIT,),),),
    };
}

/** Stable cache-key material. */
export function feedHash(q: NormalizedFeedQuery,): string {
    return [
        `t=${q.threads ? q.threads.join(',',) : '-'}`, `s=${q.sort}`, `w=${q.window}`, `c=${q.category ?? ''}`,
        `p=${q.postCategory ?? ''}`, `pg=${q.page}`, `l=${q.limit}`,
    ].join('&',);
}

/**
 * Rows in the order of `refs` (each an id or a slug). A ref matches by id
 * first, else by slug — slugs are unique per CATEGORY, so a slug shared by two
 * threads picks the oldest. A row is used once.
 */
export function orderByRefs<R extends { id: string; slug: string; created_at: Date | string; },>(refs: string[], rows: R[],): R[] {
    const byId = new Map(rows.map((r,) => [r.id.toLowerCase(), r,],),);
    const bySlug = new Map<string, R>();
    for (const r of [...rows,].sort((a, b,) => +new Date(a.created_at,) - +new Date(b.created_at,))) {
        if (!bySlug.has(r.slug,)) bySlug.set(r.slug, r,);
    }
    const used = new Set<string>();
    const out: R[] = [];
    for (const ref of refs) {
        const r = byId.get(ref.toLowerCase(),) ?? bySlug.get(ref,);
        if (r && !used.has(r.id,)) {
            used.add(r.id,);
            out.push(r,);
        }
    }
    return out;
}

// ─── SQL ────────────────────────────────────────────────────────────

interface FeedRow {
    id: string; slug: string; title: string; author_id: string | null; status: string; pinned: boolean; locked: boolean;
    reply_count: number; view_count: number; last_reply_at: Date | null; created_at: Date;
    category_id: string; c_slug: string; c_name: string; reaction_total: number; score: number;
    a_name: string | null; a_handle: string | null; a_public: boolean | null; a_avatar: string | null;
    a_role: string | null; a_joined: Date | null; a_activity: number | null; a_tier: string | null;
}

/** Category ids the viewer may read (null = every category: moderators). */
async function readableCategoryIds(viewer: Viewer, s: ForumSettings, moderator: boolean,): Promise<string[] | null> {
    if (moderator) return null;
    const level = await viewerLevel(viewer,);
    const rows = (await query<CategoryRow>(`SELECT id, read_min_rank, post_min_rank, locked FROM forum_categories`,)).rows;
    return rows.filter((r,) => canReadCategory(level, s, r,)).map((r,) => r.id);
}

async function selectThreads(q: NormalizedFeedQuery, viewer: Viewer, categoryIds: string[] | null,):
Promise<{ rows: FeedRow[]; total: number; }> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (viewer.id) {
        params.push(viewer.id,);
        where.push(`(t.status = 'visible' OR (t.status = 'pending' AND t.author_id = $${params.length}))`,);
    } else {
        where.push(`t.status = 'visible'`,);
    }
    if (categoryIds) {
        params.push(categoryIds,);
        where.push(`t.category_id = ANY($${params.length}::uuid[])`,);
    }
    if (q.threads) {
        const ids = q.threads.filter((r,) => UUID.test(r,));
        params.push(ids,);
        const idsAt = params.length;
        params.push(q.threads,);
        where.push(`(t.id = ANY($${idsAt}::uuid[]) OR t.slug = ANY($${params.length}::text[]))`,);
    } else {
        if (q.category) {
            params.push(q.category,);
            where.push(UUID.test(q.category,) ? `fc.id = $${params.length}::uuid` : `fc.slug = $${params.length}`,);
        } else {
            where.push(NOT_HIDDEN_CATEGORY,);
        }
        const hours = windowHours(q.window,);
        if (hours) {
            where.push(q.sort === 'newest'
                ? `t.created_at >= NOW() - INTERVAL '${hours} hours'`
                : `COALESCE(t.last_reply_at, t.created_at) >= NOW() - INTERVAL '${hours} hours'`,);
        }
    }
    const reactions = `COALESCE(${reactionTotal('oc',)}, 0)`;
    const { score, order, } = threadRankSql(q.sort, reactions,);
    const from = `
        FROM forum_threads t
        JOIN forum_categories fc ON fc.id = t.category_id
        LEFT JOIN comments oc ON oc.target_type = 'forum_thread' AND oc.target_id = t.id AND oc.is_opening
        ${authorJoin('t.author_id',)}
        WHERE ${where.join(' AND ',)}`;
    const select = `SELECT t.id, t.slug, t.title, t.author_id, t.status, t.pinned, t.locked, t.reply_count, t.view_count,
                t.last_reply_at, t.created_at, t.category_id, fc.slug AS c_slug, fc.name AS c_name,
                ${reactions} AS reaction_total, ${score} AS score,${authorColumns('t.author_id',)}
         ${from}`;
    if (q.threads) {
        if (!q.threads.length) return { rows: [], total: 0, };
        const rows = orderByRefs(q.threads, (await query<FeedRow>(`${select} LIMIT 200`, params,)).rows,);
        return { rows, total: rows.length, };
    }
    const total = Number((await query<{ n: number; }>(`SELECT COUNT(*)::int AS n ${from}`, params,)).rows[0]?.n ?? 0,);
    const rows = (await query<FeedRow>(
        `${select} ORDER BY ${order} LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`, params,
    )).rows;
    return { rows, total, };
}

/** Opening posts of the threads, in ONE query. */
async function openingRows(threadIds: string[],): Promise<Map<string, CommentRow>> {
    if (!threadIds.length) return new Map();
    const r = await query<CommentRow>(
        `SELECT ${COMMENT_COLUMNS} FROM comments c ${AUTHOR_JOIN}
          WHERE c.target_type = 'forum_thread' AND c.target_id = ANY($1::uuid[]) AND c.is_opening`,
        [threadIds,],
    );
    return new Map(r.rows.map((c,) => [c.target_id, c,],),);
}

/** The newest VISIBLE reply's author per thread, in ONE query (guests included). */
async function lastRepliers(threadIds: string[],): Promise<Map<string, { name: string; handle: string | null; }>> {
    if (!threadIds.length) return new Map();
    const r = await query<{ target_id: string; author_id: string | null; guest_name: string | null; name: string | null; handle: string | null; public: boolean | null; }>(
        `SELECT DISTINCT ON (c.target_id) c.target_id, c.author_id, c.guest_name,
                u.display_name AS name, u.handle, u.profile_public AS public
           FROM comments c LEFT JOIN users u ON u.id = c.author_id
          WHERE c.target_type = 'forum_thread' AND c.target_id = ANY($1::uuid[]) AND c.status = 'visible' AND NOT c.is_opening
          ORDER BY c.target_id, c.created_at DESC`,
        [threadIds,],
    );
    return new Map(r.rows.map((x,) => [x.target_id, {
        name: x.author_id ? (x.name || 'Member') : (x.guest_name || 'Anonymous'),
        handle: x.author_id && x.public !== false ? (x.handle ?? null) : null,
    },],),);
}

// ─── Post target ────────────────────────────────────────────────────

const ANON: Viewer = { id: null, role: null, };

/** May a guest post / reply anywhere (setting + the anonymous permission)? */
async function guestsAllowed(s: ForumSettings,): Promise<boolean> {
    if (!s.allowAnonymous) return false;
    return permissions.can(ANON, 'forum:post_anonymous',).catch(() => false);
}

async function postTargetFor(ref: string, viewer: Viewer, s: ForumSettings, guestsOk: boolean, moderator: boolean,):
Promise<ForumFeedPostTarget | null> {
    const cat = await categoryByRef(ref,).catch(() => null);
    if (!cat) return null;
    const anonymous = guestsOk && canGuestPostCategory(s, cat,);
    const base = { categoryId: cat.id, categorySlug: cat.slug, categoryName: cat.name, anonymous, };
    const level = await viewerLevel(viewer,);
    if (!moderator && !canReadCategory(level, s, cat,)) {
        return { ...base, canPost: false, reason: level < 0 ? 'Sign in to read the forum.' : 'This part of the forum is for subscribers.', };
    }
    if (!viewer.id) {
        if (anonymous) return { ...base, canPost: true, reason: null, };
        return { ...base, canPost: false, reason: cat.locked ? 'This category is locked.' : 'Sign in to post.', };
    }
    if (!(await permissions.can(viewer, 'forum:thread_create',).catch(() => false))) {
        return { ...base, canPost: false, reason: 'You cannot start threads.', };
    }
    if (!canPostCategory(level, s, cat,)) {
        return { ...base, canPost: false, reason: cat.locked ? 'This category is locked.' : 'Posting here needs a higher subscription.', };
    }
    return { ...base, canPost: true, reason: null, };
}

// ─── Feed ───────────────────────────────────────────────────────────

async function canModerate(v: Viewer,): Promise<boolean> {
    if (!v.id) return false;
    if (await isModerator(v,)) return true;
    return permissions.can(v, 'forum:moderate',).catch(() => false);
}

async function compute(q: NormalizedFeedQuery, viewer: Viewer,): Promise<ForumFeedResponse> {
    const [s, engine, moderator,] = await Promise.all([getSettings(), getEngineSettings(), canModerate(viewer,),],);
    const guestsOk = await guestsAllowed(s,);
    const [categoryIds, replyPerm,] = await Promise.all([
        readableCategoryIds(viewer, s, moderator,),
        viewer.id ? permissions.can(viewer, 'forum:reply',).catch(() => false) : Promise.resolve(guestsOk,),
    ],);
    const { rows: candidates, total, } = await selectThreads(q, viewer, categoryIds,);

    // The forum_thread target decides read + reply (the same rule replies use).
    const access = await accessFor(candidates.map((r,) => ({ type: 'forum_thread', id: r.id, })), viewer,);
    const rows = candidates.filter((r,) => access.get(`forum_thread:${r.id}`,)?.canRead,);
    const ids = rows.map((r,) => r.id);
    const [openings, repliers, postTarget,] = await Promise.all([
        openingRows(ids,),
        lastRepliers(ids,),
        q.postCategory ? postTargetFor(q.postCategory, viewer, s, guestsOk, moderator,) : Promise.resolve(null,),
    ],);
    const openingList = [...openings.values(),];
    const mapped = openingList.length ? await mapForViewer(openingList, viewer, moderator,) : [];
    const openingById = new Map<string, Comment>(mapped.map((c, i,) => [openingList[i].target_id, c,],),);

    const items: ForumFeedThread[] = rows.map((r,) => {
        const a = access.get(`forum_thread:${r.id}`,);
        const oRow = openings.get(r.id,);
        // A guest thread has no author row: its name lives on the opening post.
        const author = oRow ? mapAuthor(oRow,) : mapAuthor({ guest_name: null, guest_email: null, guest_ip: null, ...r, } as unknown as CommentRow,);
        let replyBlockedReason: string | null = null;
        if (!a?.canComment) replyBlockedReason = a?.reason ?? (viewer.id ? 'Replies are closed.' : 'Sign in to reply.');
        else if (!replyPerm && !moderator) replyBlockedReason = viewer.id ? 'You cannot reply in the forum.' : 'Sign in to reply.';
        return {
            id: r.id,
            slug: r.slug,
            title: r.title,
            url: threadUrl(r.c_slug, r.slug,),
            category: { id: r.category_id, slug: r.c_slug, name: r.c_name, },
            author,
            opening: openingById.get(r.id,) ?? null,
            excerpt: oRow && (oRow.status === 'visible' || moderator || (viewer.id && oRow.author_id === viewer.id))
                ? excerptOf(oRow.body, EXCERPT_MAX,)
                : '',
            status: r.status === 'pending' ? 'pending' : 'visible',
            pinned: Boolean(r.pinned,),
            locked: Boolean(r.locked,),
            replyCount: Number(r.reply_count ?? 0,),
            viewCount: Number(r.view_count ?? 0,),
            reactionCount: Number(r.reaction_total ?? 0,),
            lastReplyAt: r.last_reply_at ? new Date(r.last_reply_at,).toISOString() : null,
            lastReplyBy: repliers.get(r.id,) ?? null,
            createdAt: new Date(r.created_at,).toISOString(),
            canReply: !replyBlockedReason,
            replyBlockedReason,
        };
    },);

    return {
        items,
        page: q.page,
        limit: q.limit,
        total,
        postTarget,
        anonymousAllowed: guestsOk,
        maxLength: engine.maxLength,
        reactions: engine.reactions,
        reactionsEnabled: engine.reactionsEnabled,
    };
}

/** An empty feed (forum off, nothing selected). */
async function emptyFeed(q: NormalizedFeedQuery,): Promise<ForumFeedResponse> {
    const engine = await getEngineSettings().catch(() => DEFAULT_DISCUSSIONS_SETTINGS);
    return {
        items: [], page: q.page, limit: q.limit, total: 0, postTarget: null, anonymousAllowed: false,
        maxLength: engine.maxLength, reactions: engine.reactions, reactionsEnabled: engine.reactionsEnabled,
    };
}

/** The feed for a viewer (anonymous results cached briefly). */
export async function forumFeed(raw: ForumFeedQuery, viewer: Viewer,): Promise<ForumFeedResponse> {
    const q = normalizeFeedQuery(raw,);
    if (!(await isFeatureEnabledServer('forum',).catch(() => false))) return emptyFeed(q,);
    if (viewer.id) return compute(q, viewer,);
    const key = CACHE_KEYS.forumFeed(feedHash(q,),);
    const hit = await cache.get<ForumFeedResponse>(key,).catch(() => null);
    if (hit) return hit;
    const res = await compute(q, viewer,);
    await cache.set(key, res, FEED_TTL_SECONDS,).catch(() => {},);
    return res;
}
