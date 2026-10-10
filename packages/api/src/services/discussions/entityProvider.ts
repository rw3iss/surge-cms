/**
 * Read-only entity types over the discovery layer: `comment` (discussions
 * feature) and `forum_thread` (forum feature). They let an ENTITY BLOCK or a
 * CAROUSEL entity item bind a `query` data source — "hot threads in General
 * this week" — and render each record through a content-block template,
 * without a bespoke block.
 *
 * The query knobs are VIRTUAL FILTERS (entities/virtualFilters.ts): `sort`
 * (latest | hot | top), `window` (24h | 7d | 30d | all), `category` (forum
 * category slug) and, for comments, `targetType`. They show in the query
 * builder with suggestions; this provider receives them in `filter` and maps
 * the EntityQuery onto a DiscussionQuery. Records are discovery items (author,
 * excerpt, url, counts …), so `{{forum_thread.title}}` / `{{comment.excerpt}}` work.
 *
 * Writes are refused — comments and threads have their own APIs and rules.
 * Admin reads (the Entities Data tab) see everything; public reads are
 * anonymous (the entity endpoint has no per-viewer shape).
 */
import type { DiscussionItem, DiscussionQuery, EntityFieldOption, EntityQuery, EntityRecord, } from '@sitesurge/types';
import { ForbiddenError, } from '../../core/errors';
import { query as dbQuery, } from '../../db';
import { registerEntityDataProvider, } from '../../entities/dataProviders';
import { registerVirtualFilter, type SqlCondition, } from '../../entities/virtualFilters';
import { getRow, mapForViewer, } from './comments';
import { targetSummaries, } from './moderation';
import { query, thread, } from './query';
import { excerptOf, } from './rows';
import { findTarget, } from './targets';
import type { Viewer, } from './viewer';

const ANON: Viewer = { id: null, role: null, };
/** Staff-shaped viewer for admin reads (Entities Data tab): access() lets staff read everything. */
const ADMIN: Viewer = { id: '00000000-0000-0000-0000-000000000000', role: 'admin', };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A filter value (bare or `{op, value}`) → its string. */
function filterValue(f: EntityQuery['filter'], key: string,): string | undefined {
    const raw = f?.[key] as unknown;
    const v = raw !== null && typeof raw === 'object' && 'value' in (raw as object) ? (raw as { value: unknown; }).value : raw;
    if (v === undefined || v === null) return undefined;
    const s = Array.isArray(v,) ? String(v[0] ?? '',) : String(v,);
    return s.trim() || undefined;
}

/** EntityQuery → DiscussionQuery. `sortBy=createdAt` means latest. */
export function toDiscussionQuery(kind: 'comment' | 'thread', q: EntityQuery = {},): DiscussionQuery {
    const sort = filterValue(q.filter, 'sort',) ?? (q.sortBy === 'createdAt' ? 'latest' : undefined);
    return {
        kind,
        sort: sort as DiscussionQuery['sort'],
        window: filterValue(q.filter, 'window',) as DiscussionQuery['window'],
        category: filterValue(q.filter, 'category',),
        targetType: kind === 'comment' ? filterValue(q.filter, 'targetType',) : undefined,
        author: filterValue(q.filter, 'author',),
        page: q.page,
        limit: q.limit,
    };
}

const asRecord = (i: DiscussionItem,): EntityRecord => ({ ...(i as unknown as Record<string, unknown>), id: i.id, });

const readOnly = async (): Promise<never> => {
    throw new ForbiddenError('Comments and forum threads are read-only here — use their own pages.',);
};

/** Provider for one kind. */
function provider(kind: 'comment' | 'thread',) {
    return {
        async list(q: EntityQuery, opts: { admin?: boolean; },) {
            const r = await query(toDiscussionQuery(kind, q,), opts.admin ? ADMIN : ANON,);
            return { items: r.items.map(asRecord,), total: r.total, };
        },
        async getById(id: string,) {
            if (kind === 'thread') {
                const t = await thread(id, ANON,);
                return t ? asRecord(t,) : null;
            }
            if (!UUID.test(id,)) return null;
            const row = await getRow(id,);
            if (!row || row.status !== 'visible') return null;
            const target = await findTarget(row.target_type,);
            if (!(await target?.access(row.target_id, ANON,))?.canRead) return null;
            const [mapped,] = await mapForViewer([row,], ANON,);
            const summary = (await targetSummaries([row,],)).get(`${row.target_type}:${row.target_id}`,) ?? null;
            return {
                ...mapped, id: row.id, kind: 'comment', target: summary, excerpt: excerptOf(row.body,),
                url: summary ? `${summary.url}#comment-${row.id}` : '', score: 0,
            } as unknown as EntityRecord;
        },
        async getBySlug(slug: string,) {
            if (kind !== 'thread') return null;
            const t = await thread(slug, ANON,);
            return t ? asRecord(t,) : null;
        },
        create: readOnly,
        update: readOnly,
        remove: readOnly,
    };
}

registerEntityDataProvider('comment', provider('comment',),);
registerEntityDataProvider('forum_thread', provider('thread',),);

// ─── Query knobs (virtual filters — resolved by the provider above) ───

/** The provider interprets these; the generic repo never runs them. */
const handledByProvider = async (): Promise<SqlCondition> => () => 'TRUE';
const opts = (values: [string, string,][],): EntityFieldOption[] => values.map(([value, label,],) => ({ value, label, }));

const SORT = {
    key: 'sort', label: 'Sort', description: 'latest = newest activity · hot = activity weighted by age · top = most replies + reactions in the window.',
    options: async () => opts([['latest', 'Latest',], ['hot', 'Hot',], ['top', 'Top',],],),
    resolve: handledByProvider,
};
const WINDOW = {
    key: 'window', label: 'Time window', description: 'Default: 7 days for hot/top, all time for latest.',
    options: async () => opts([['24h', 'Last 24 hours',], ['7d', 'Last 7 days',], ['30d', 'Last 30 days',], ['all', 'All time',],],),
    resolve: handledByProvider,
};
const CATEGORY = {
    key: 'category', label: 'Forum category', description: 'A forum category slug.',
    options: async () => {
        const r = await dbQuery<{ slug: string; name: string; }>(`SELECT slug, name FROM forum_categories ORDER BY sort_order, name`,)
            .catch(() => ({ rows: [], }));
        return r.rows.map((c,) => ({ value: c.slug, label: c.name, }));
    },
    resolve: handledByProvider,
};
const TARGET_TYPE = {
    key: 'targetType', label: 'Comments on', description: 'Only comments on this kind of item.',
    options: async () => opts([['post', 'Posts',], ['event', 'Events',], ['forum_thread', 'Forum threads',],],),
    resolve: handledByProvider,
};

for (const f of [SORT, WINDOW, CATEGORY, TARGET_TYPE,]) registerVirtualFilter('comment', f,);
for (const f of [SORT, WINDOW, CATEGORY,]) registerVirtualFilter('forum_thread', f,);
