/**
 * Discovery: latest / hot / top lists of comments and forum threads, for use
 * ANYWHERE — `GET /discussions/query`, the SDK, `{{ hotThreads(5) }}`-style
 * template functions (site, SSR, email) and the read-only `comment` /
 * `forum_thread` entity types.
 *
 * Visibility is decided ONLY through the target registry: a row is kept when
 * its target type is registered + enabled AND `access(id, viewer).canRead`.
 * A type with no registered target (e.g. `forum_thread` before the Forum
 * registers it) is simply excluded — so nothing here imports a feature.
 *
 * Caching: the ANONYMOUS result is cached 5 min (`CACHE_KEYS.discussionFeed`)
 * and dropped on any comment write/moderation (listener at the bottom). A
 * signed-in viewer is computed uncached: what they may read depends on their
 * tier and role, so a shared cached list would be wrong for them, and caching
 * per user would multiply the key space for lists that are cheap to build.
 *
 * Pagination: SQL pages a candidate set; rows the viewer may not read are
 * dropped afterwards, so `total` is an UPPER bound and a page can be short.
 */
import type {
    DiscussionCommentItem, DiscussionItem, DiscussionQuery, DiscussionThreadItem,
} from '@sitesurge/types';
import { query as dbQuery, } from '../../db';
import { cache, CACHE_KEYS, } from '../cache';
import { mapForViewer, } from './comments';
import { onDiscussionEvent, } from './events';
import { targetSummaries, } from './moderation';
import { type NormalizedQuery, hotScoreSql, normalizeQuery, queryHash, windowHours, } from './queryParams';
import { AUTHOR_JOIN, authorColumns, authorJoin, COMMENT_COLUMNS, type CommentRow, excerptOf, mapAuthor, } from './rows';
import { accessFor, } from './readable';
import { allTargets, findTarget, } from './targets';
import type { Viewer, } from './viewer';

export { normalizeQuery, } from './queryParams';

const FEED_TTL_SECONDS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Total reactions on a comment row aliased `alias`. */
const reactionTotal = (alias: string,) =>
    `(SELECT COALESCE(SUM(v::int), 0) FROM jsonb_each_text(${alias}.reaction_counts) AS j(k, v))`;

export interface QueryResult {
    items: DiscussionItem[];
    page: number;
    limit: number;
    /** Upper bound (before per-item access filtering). */
    total: number;
}

/** Target types usable right now (registered AND their feature on). */
async function enabledTypes(): Promise<string[]> {
    const out: string[] = [];
    for (const t of allTargets()) if (await findTarget(t.type,)) out.push(t.type,);
    return out;
}

// ─── Comments ───────────────────────────────────────────────────────

async function queryComments(q: NormalizedQuery, viewer: Viewer, types: string[], take: number,):
Promise<{ rows: (CommentRow & { score: number; })[]; total: number; }> {
    const params: unknown[] = [];
    const where = [`c.status = 'visible'`, `NOT c.is_opening`,];
    let allowed = types;
    if (q.targetType) allowed = types.filter((t,) => t === q.targetType);
    if (q.category) allowed = allowed.filter((t,) => t === 'forum_thread');
    if (!allowed.length) return { rows: [], total: 0, };
    params.push(allowed,);
    where.push(`c.target_type = ANY($${params.length}::text[])`,);
    if (q.targetId && UUID.test(q.targetId,)) { params.push(q.targetId,); where.push(`c.target_id = $${params.length}`,); }
    if (!q.includeReplies) where.push(`c.parent_id IS NULL`,);
    if (q.author) { params.push(q.author,); where.push(`lower(u.handle) = lower($${params.length})`,); }
    const hours = windowHours(q.window,);
    if (hours) where.push(`c.created_at >= NOW() - INTERVAL '${hours} hours'`,);
    if (q.category) {
        params.push(q.category,);
        where.push(`EXISTS (SELECT 1 FROM forum_threads ft JOIN forum_categories fc ON fc.id = ft.category_id
                            WHERE ft.id = c.target_id AND fc.slug = $${params.length})`,);
    }
    const reactions = reactionTotal('c',);
    if (q.minReactions) { params.push(q.minReactions,); where.push(`${reactions} >= $${params.length}`,); }

    const score = q.sort === 'hot'
        ? hotScoreSql({ replies: 'c.reply_count', reactions, views: '0', ageFrom: 'c.created_at', },)
        : q.sort === 'top' ? `(c.reply_count + ${reactions})::float` : '0::float';
    const order = q.sort === 'latest' ? 'c.created_at DESC' : `score DESC, c.created_at DESC`;
    const w = `WHERE ${where.join(' AND ',)}`;
    const total = Number((await dbQuery<{ n: number; }>(`SELECT COUNT(*)::int AS n FROM comments c ${AUTHOR_JOIN} ${w}`, params,)).rows[0]?.n ?? 0,);
    const rows = (await dbQuery<CommentRow & { score: number; }>(
        `SELECT ${COMMENT_COLUMNS}, ${score} AS score FROM comments c ${AUTHOR_JOIN} ${w} ORDER BY ${order} LIMIT ${take}`,
        params,
    )).rows;
    return { rows, total, };
}

async function toCommentItems(rows: (CommentRow & { score: number; })[], viewer: Viewer,): Promise<DiscussionCommentItem[]> {
    if (!rows.length) return [];
    const [mapped, summaries,] = await Promise.all([mapForViewer(rows, viewer,), targetSummaries(rows,),],);
    return mapped.map((c, i,) => {
        const row = rows[i];
        const target = summaries.get(`${row.target_type}:${row.target_id}`,) ?? null;
        return {
            ...c,
            kind: 'comment' as const,
            target,
            excerpt: excerptOf(row.body,),
            url: target ? `${target.url}#comment-${row.id}` : '',
            score: Number(row.score ?? 0,),
        };
    },);
}

// ─── Threads ────────────────────────────────────────────────────────

interface ThreadRow {
    id: string; slug: string; title: string; author_id: string | null; pinned: boolean; locked: boolean;
    reply_count: number; view_count: number; last_reply_at: Date | null; created_at: Date;
    cat_slug: string; cat_name: string; opening_body: string | null; reaction_total: number; score: number;
    a_name: string | null; a_handle: string | null; a_public: boolean | null; a_avatar: string | null;
    a_role: string | null; a_joined: Date | null; a_activity: number | null; a_tier: string | null;
}

async function queryThreads(q: NormalizedQuery, take: number,): Promise<{ rows: ThreadRow[]; total: number; }> {
    const params: unknown[] = [];
    const where = [`t.status = 'visible'`,];
    if (q.thread) {
        params.push(q.thread,);
        where.push(UUID.test(q.thread,) ? `t.id = $${params.length}::uuid` : `t.slug = $${params.length}`,);
    }
    if (q.category) { params.push(q.category,); where.push(`fc.slug = $${params.length}`,); }
    if (q.author) { params.push(q.author,); where.push(`lower(u.handle) = lower($${params.length})`,); }
    const hours = windowHours(q.window,);
    if (hours && !q.thread) where.push(`COALESCE(t.last_reply_at, t.created_at) >= NOW() - INTERVAL '${hours} hours'`,);
    const reactions = `COALESCE(${reactionTotal('oc',)}, 0)`;
    if (q.minReactions) { params.push(q.minReactions,); where.push(`${reactions} >= $${params.length}`,); }

    const score = q.sort === 'hot'
        ? hotScoreSql({ replies: 't.reply_count', reactions, views: 't.view_count', ageFrom: 'COALESCE(t.last_reply_at, t.created_at)', },)
        : q.sort === 'top' ? `(t.reply_count + ${reactions})::float` : '0::float';
    const order = q.sort === 'latest' ? 'COALESCE(t.last_reply_at, t.created_at) DESC' : 'score DESC, t.created_at DESC';
    const from = `
        FROM forum_threads t
        JOIN forum_categories fc ON fc.id = t.category_id
        LEFT JOIN comments oc ON oc.target_type = 'forum_thread' AND oc.target_id = t.id AND oc.is_opening
        ${authorJoin('t.author_id',)}
        WHERE ${where.join(' AND ',)}`;
    const total = Number((await dbQuery<{ n: number; }>(`SELECT COUNT(*)::int AS n ${from}`, params,)).rows[0]?.n ?? 0,);
    const rows = (await dbQuery<ThreadRow>(
        `SELECT t.id, t.slug, t.title, t.author_id, t.pinned, t.locked, t.reply_count, t.view_count,
                t.last_reply_at, t.created_at, fc.slug AS cat_slug, fc.name AS cat_name,
                oc.body AS opening_body, ${reactions} AS reaction_total, ${score} AS score,${authorColumns('t.author_id',)}
         ${from} ORDER BY ${order} LIMIT ${take}`,
        params,
    )).rows;
    return { rows, total, };
}

function toThreadItem(r: ThreadRow,): DiscussionThreadItem {
    const author = mapAuthor({ guest_name: null, guest_email: null, guest_ip: null, ...r, } as unknown as CommentRow,);
    return {
        kind: 'thread',
        id: r.id,
        title: r.title,
        slug: r.slug,
        url: `/forum/${r.cat_slug}/${r.slug}`,
        category: { slug: r.cat_slug, name: r.cat_name, },
        author,
        excerpt: r.opening_body ? excerptOf(r.opening_body,) : '',
        replyCount: Number(r.reply_count ?? 0,),
        viewCount: Number(r.view_count ?? 0,),
        reactionCount: Number(r.reaction_total ?? 0,),
        pinned: Boolean(r.pinned,),
        locked: Boolean(r.locked,),
        lastReplyAt: r.last_reply_at ? new Date(r.last_reply_at,).toISOString() : null,
        createdAt: new Date(r.created_at,).toISOString(),
        score: Number(r.score ?? 0,),
    };
}

// ─── Merge ──────────────────────────────────────────────────────────

const sortKey = (i: DiscussionItem, sort: NormalizedQuery['sort'],): number =>
    sort === 'latest'
        ? Date.parse(i.kind === 'thread' ? (i.lastReplyAt ?? i.createdAt) : i.createdAt,)
        : i.score;

async function compute(q: NormalizedQuery, viewer: Viewer,): Promise<QueryResult> {
    const types = await enabledTypes();
    const threadsOn = types.includes('forum_thread',);
    const wantComments = q.kind !== 'thread';
    const wantThreads = q.kind !== 'comment' && threadsOn && (!q.targetType || q.targetType === 'forum_thread');
    // Over-fetch so per-item access filtering still fills the page.
    const take = Math.min(500, q.page * q.limit * 2 + 10,);
    const [c, t,] = await Promise.all([
        wantComments && !q.thread ? queryComments(q, viewer, types, take,) : Promise.resolve({ rows: [], total: 0, }),
        wantThreads ? queryThreads(q, take,) : Promise.resolve({ rows: [], total: 0, }),
    ],);

    // Access for every distinct target, in parallel / batched (readable.ts).
    const access = await accessFor([
        ...c.rows.map((r,) => ({ type: r.target_type, id: r.target_id, })),
        ...t.rows.map((r,) => ({ type: 'forum_thread', id: r.id, })),
    ], viewer,);
    const commentRows = c.rows.filter((r,) => access.get(`${r.target_type}:${r.target_id}`,)?.canRead,);
    const threadRows = t.rows.filter((r,) => access.get(`forum_thread:${r.id}`,)?.canRead,);

    const merged: DiscussionItem[] = [
        ...(await toCommentItems(commentRows, viewer,)),
        ...threadRows.map(toThreadItem,),
    ].sort((a, b,) => sortKey(b, q.sort,) - sortKey(a, q.sort,));
    const start = (q.page - 1) * q.limit;
    return { items: merged.slice(start, start + q.limit,), page: q.page, limit: q.limit, total: c.total + t.total, };
}

/** Run a discovery query for a viewer (anonymous results cached 5 min). */
export async function query(raw: DiscussionQuery, viewer: Viewer,): Promise<QueryResult> {
    const q = normalizeQuery(raw,);
    if (viewer.id) return compute(q, viewer,);
    const key = CACHE_KEYS.discussionFeed(queryHash(q,),);
    const hit = await cache.get<QueryResult>(key,).catch(() => null);
    if (hit) return hit;
    const res = await compute(q, viewer,);
    await cache.set(key, res, FEED_TTL_SECONDS,).catch(() => {},);
    return res;
}

/** One thread by slug or id, or null (what `{{forumThread('slug')}}` uses). */
export async function thread(ref: string, viewer: Viewer,): Promise<DiscussionThreadItem | null> {
    const r = await query({ thread: ref, kind: 'thread', limit: 1, }, viewer,);
    return (r.items[0] as DiscussionThreadItem | undefined) ?? null;
}

// Any comment change (incl. a thread's opening post and moderation) can move
// a list: drop the cached anonymous feeds. NOT reactions: they only nudge
// hot/top ordering, the 5-minute TTL covers that, and invalidating on every
// toggle let one user keep every feed on the site uncached.
onDiscussionEvent(async (e,) => {
    if (e.type === 'reacted') return;
    await cache.invalidateDiscussionFeedCache();
},);
