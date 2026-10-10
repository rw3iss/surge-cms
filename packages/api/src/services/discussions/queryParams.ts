/**
 * Pure parts of the discovery query (services/discussions/query.ts): defaults,
 * windows and the hot-score formula — SQL and a JS mirror kept side by side so
 * the tests pin both to the same numbers.
 */
import type { DiscussionQuery, DiscussionQueryKind, DiscussionQuerySort, DiscussionQueryWindow, } from '@sitesurge/types';

export interface NormalizedQuery {
    kind: DiscussionQueryKind;
    sort: DiscussionQuerySort;
    window: DiscussionQueryWindow;
    targetType?: string;
    targetId?: string;
    category?: string;
    author?: string;
    thread?: string;
    minReactions: number;
    includeReplies: boolean;
    page: number;
    limit: number;
}

const KINDS: readonly DiscussionQueryKind[] = ['comment', 'thread', 'both',];
const SORTS: readonly DiscussionQuerySort[] = ['latest', 'hot', 'top',];
const WINDOWS: readonly DiscussionQueryWindow[] = ['24h', '7d', '30d', 'all',];
export const MAX_LIMIT = 50;

const pick = <T extends string,>(v: unknown, allowed: readonly T[], fallback: T,): T =>
    (allowed as readonly string[]).includes(String(v,),) ? (v as T) : fallback;

const str = (v: unknown, max: number,): string | undefined => {
    const t = typeof v === 'string' ? v.trim() : '';
    return t ? t.slice(0, max,) : undefined;
};

/** Defaults + clamps. Unknown values fall back rather than throw — a template typo must still render. */
export function normalizeQuery(q: DiscussionQuery = {},): NormalizedQuery {
    const sort = pick(q.sort, SORTS, 'latest',);
    const thread = str(q.thread, 160,);
    return {
        kind: thread ? 'thread' : pick(q.kind, KINDS, 'both',),
        sort,
        window: pick(q.window, WINDOWS, sort === 'latest' ? 'all' : '7d',),
        targetType: str(q.targetType, 32,),
        targetId: str(q.targetId, 36,),
        category: str(q.category, 80,),
        author: str(q.author, 40,),
        thread,
        minReactions: Math.max(0, Math.floor(Number(q.minReactions,) || 0,),),
        includeReplies: q.includeReplies !== false && String(q.includeReplies,) !== 'false',
        page: Math.max(1, Math.floor(Number(q.page,) || 1,),),
        limit: Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(q.limit,) || 10,),),),
    };
}

/** Window → hours (null = no lower bound). */
export function windowHours(w: DiscussionQueryWindow,): number | null {
    return w === '24h' ? 24 : w === '7d' ? 24 * 7 : w === '30d' ? 24 * 30 : null;
}

/**
 * Hot score: `(replies × 2 + reactions + views ÷ 50 + 1) / (age_hours + 2) ^ 1.5`.
 * New activity rises, then decays with age. `ageSql` is a timestamp expression.
 */
export function hotScoreSql(e: { replies: string; reactions: string; views: string; ageFrom: string; },): string {
    const age = `(EXTRACT(EPOCH FROM (NOW() - ${e.ageFrom})) / 3600.0)`;
    return `((${e.replies}) * 2 + (${e.reactions}) + (${e.views}) / 50.0 + 1) / POWER(GREATEST(${age}, 0) + 2, 1.5)`;
}

/** JS mirror of hotScoreSql (tests + client-side re-ranking). */
export function hotScore(replies: number, reactions: number, views: number, ageHours: number,): number {
    return (replies * 2 + reactions + views / 50 + 1) / Math.pow(Math.max(ageHours, 0,) + 2, 1.5,);
}

/** Stable cache-key material for an anonymous query. */
export function queryHash(q: NormalizedQuery,): string {
    return Object.entries(q,).filter(([, v,],) => v !== undefined).sort(([a,], [b,],) => a.localeCompare(b,))
        .map(([k, v,],) => `${k}=${String(v,)}`).join('&',);
}
