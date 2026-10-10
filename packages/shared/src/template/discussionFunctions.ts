/**
 * `{{ }}` discovery functions over comments + forum threads — ONE mapping from
 * a call to a `DiscussionQuery`, so the site, SSR and email runtimes read the
 * same function the same way. Each runtime runs the query its own way (SDK on
 * the site, the service on the server) and wraps the items as
 * `entityRef(DISCUSSION_LIST_KIND, items)`, which `{{for … as t}}` iterates
 * and a bare `{{ hotThreads(5) }}` renders as a list.
 *
 *   latestComments(5)              hotComments(3, targetType='post')
 *   latestThreads(5, category='general')
 *   hotThreads(5, window='7d', category='general')
 *   discussions(sort='top', kind='both', window='30d', limit=10)
 *   commentCount(post)             forumThread('slug').replyCount
 */
import type { DiscussionQuery, } from '../api/routes/discussionsQuery';

/** EntityRef kind of a discovery list (data = the item array). */
export const DISCUSSION_LIST_KIND = 'discussionList';
/** EntityRef kind of `forumThread('slug')` (data = one thread item). */
export const FORUM_THREAD_KIND = 'forumThread';

export const DISCUSSION_FUNCTION_NAMES = [
    'latestComments', 'hotComments', 'latestThreads', 'hotThreads', 'discussions', 'commentCount', 'forumThread',
] as const;

const PRESETS: Record<string, Pick<DiscussionQuery, 'kind' | 'sort'>> = {
    latestComments: { kind: 'comment', sort: 'latest', },
    hotComments: { kind: 'comment', sort: 'hot', },
    latestThreads: { kind: 'thread', sort: 'latest', },
    hotThreads: { kind: 'thread', sort: 'hot', },
    discussions: {},
};

const NAMED_KEYS = [
    'kind', 'sort', 'window', 'targetType', 'targetId', 'category', 'author', 'minReactions', 'includeReplies', 'limit', 'page',
] as const;

/** The query for a list function call, or null when `name` is not one. Named args override the preset. */
export function discussionQueryFor(name: string, args: unknown[], named?: Record<string, unknown>,): DiscussionQuery | null {
    const preset = PRESETS[name];
    if (!preset) return null;
    const q: Record<string, unknown> = { ...preset, };
    if (typeof args[0] === 'number') q.limit = args[0];
    else if (typeof args[0] === 'string' && /^\d+$/.test(args[0],)) q.limit = Number(args[0],);
    for (const k of NAMED_KEYS) {
        const v = named?.[k];
        if (v !== undefined && v !== null && v !== '') q[k] = v;
    }
    if (q.limit === undefined) q.limit = 5;
    return q as DiscussionQuery;
}

/** `commentCount(post)` / `commentCount('<id>', type='event')` → the target. */
export function commentCountTarget(args: unknown[], named?: Record<string, unknown>,): { type: string; id: string; } | null {
    const a = args[0] as { __entity?: boolean; kind?: string; id?: string; data?: Record<string, unknown> | null; } | string | undefined;
    if (a && typeof a === 'object' && a.__entity) {
        const id = String(a.data?.id ?? '',);
        return /^[0-9a-f-]{36}$/i.test(id,) ? { type: String(a.kind,), id, } : null;
    }
    const id = typeof a === 'string' ? a.trim() : '';
    if (!/^[0-9a-f-]{36}$/i.test(id,)) return null;
    return { type: typeof named?.type === 'string' ? named.type : 'post', id, };
}
