/** Forum block feed: query normalization, selection order, hidden categories, sorts, rights. */
import { beforeEach, describe, expect, it, vi, } from 'vitest';
import { DEFAULT_DISCUSSIONS_SETTINGS, DEFAULT_FORUM_SETTINGS, } from '@sitesurge/types';

const { dbQuery, can, accessFor, settings, } = vi.hoisted(() => ({
    dbQuery: vi.fn(),
    can: vi.fn(),
    accessFor: vi.fn(),
    settings: { current: {} as Record<string, unknown>, },
}),);

vi.mock('../../db', () => ({ query: (...a: unknown[]) => dbQuery(...a,), transaction: vi.fn(), }),);
vi.mock('../permissions', () => ({ can: (...a: unknown[]) => can(...a,), }),);
vi.mock('../settings', () => ({ isFeatureEnabledServer: async () => true, }),);
vi.mock('../cache', () => ({
    cache: { get: async () => null, set: async () => {}, },
    CACHE_KEYS: { forumFeed: (h: string,) => `discussions:feed:forum:${h}`, },
    getRedis: vi.fn(),
}),);
vi.mock('../discussions/readable', () => ({ accessFor: (...a: unknown[]) => accessFor(...a,), }),);
vi.mock('../discussions/comments', () => ({
    mapForViewer: async (rows: { id: string; }[],) => rows.map((r,) => ({ id: r.id, bodyHtml: '<p>x</p>', })),
    applyVisibility: vi.fn(), getRow: vi.fn(), setStatus: vi.fn(),
}),);
vi.mock('../discussions/settings', () => ({ getSettings: async () => DEFAULT_DISCUSSIONS_SETTINGS, }),);
vi.mock('../discussions/viewer', () => ({ isModerator: async () => false, isStaffViewer: () => false, }),);
vi.mock('../access/level', () => ({ viewerLevel: async (v: { id?: string | null; },) => (v.id ? 0 : -1), }),);
vi.mock('./settings', () => ({ getSettings: async () => ({ ...DEFAULT_FORUM_SETTINGS, ...settings.current, }), }),);

import { feedHash, forumFeed, normalizeFeedQuery, orderByRefs, } from './feed';
import { threadRankSql, } from '../discussions/query';

const ANON = { id: null, role: null, };
const MEMBER = { id: '11111111-1111-4111-8111-111111111111', role: 'member', };
const CAT = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', slug: 'talk', name: 'Talk', read_min_rank: null, post_min_rank: null, locked: false, };

const thread = (id: string, slug: string, over: Record<string, unknown> = {},) => ({
    id, slug, title: `Thread ${slug}`, author_id: MEMBER.id, status: 'visible', pinned: false, locked: false, reply_count: 2,
    view_count: 5, last_reply_at: null, created_at: new Date('2026-10-01T00:00:00Z',), category_id: CAT.id, c_slug: 'talk',
    c_name: 'Talk', reaction_total: 1, score: 0, a_name: 'Ann', a_handle: 'ann', a_public: true, ...over,
});

/** SQL issued by the last forumFeed call. */
const sqls = (): string[] => dbQuery.mock.calls.map((c,) => String(c[0],));

function wire(threads: Record<string, unknown>[],) {
    dbQuery.mockImplementation(async (sql: string,) => {
        if (sql.includes('FROM forum_categories fc') && sql.includes('LEFT JOIN forum_threads lt')) return { rows: [CAT,], };
        if (sql.startsWith('SELECT id, read_min_rank',)) return { rows: [CAT,], };
        if (sql.includes('COUNT(*)::int AS n',)) return { rows: [{ n: threads.length, },], };
        if (sql.includes('FROM forum_threads t',)) return { rows: threads, };
        if (sql.includes('c.is_opening',) && sql.includes('c.*',)) {
            return { rows: threads.map((t,) => ({ id: `o-${t.id}`, target_id: t.id, body: `Body of ${t.slug}`, status: t.status, author_id: t.author_id, guest_name: null, guest_email: null, guest_ip: null, a_name: 'Ann', })), };
        }
        if (sql.includes('DISTINCT ON (c.target_id)',)) return { rows: [], };
        return { rows: [], };
    },);
}

beforeEach(() => {
    dbQuery.mockReset();
    can.mockReset();
    can.mockResolvedValue(true,);
    accessFor.mockReset();
    accessFor.mockImplementation(async (pairs: { type: string; id: string; }[],) =>
        new Map(pairs.map((p,) => [`${p.type}:${p.id}`, { canRead: true, canComment: true, allowAnonymous: false, title: '', url: '', },],),));
    settings.current = {};
},);

describe('normalizeFeedQuery', () => {
    it('defaults: latest, all time, page 1, 20', () => {
        expect(normalizeFeedQuery({},),).toMatchObject({ threads: null, sort: 'latest', window: 'all', page: 1, limit: 20, },);
    },);
    it('hot / top default to 7 days; unknown values fall back', () => {
        expect(normalizeFeedQuery({ sort: 'hot', },).window,).toBe('7d',);
        expect(normalizeFeedQuery({ sort: 'nope' as never, window: 'x' as never, },),).toMatchObject({ sort: 'latest', window: 'all', },);
    },);
    it('clamps limit to 50, dedupes and caps threads, keeps their order', () => {
        expect(normalizeFeedQuery({ limit: 500, },).limit,).toBe(50,);
        const many = Array.from({ length: 80, }, (_, i,) => `t${i}`,);
        const q = normalizeFeedQuery({ threads: ['b', 'a', 'b', ' ', ...many,], },);
        expect(q.threads!.slice(0, 2,),).toEqual(['b', 'a',],);
        expect(q.threads!.length,).toBe(50,);
    },);
    it('an empty selection stays an empty selection (not a query)', () => {
        expect(normalizeFeedQuery({ threads: [], },).threads,).toEqual([],);
    },);
    it('hash differs by every option', () => {
        const a = feedHash(normalizeFeedQuery({ category: 'x', },),);
        expect(a,).not.toBe(feedHash(normalizeFeedQuery({ category: 'y', },),),);
        expect(a,).not.toBe(feedHash(normalizeFeedQuery({ category: 'x', sort: 'newest', },),),);
    },);
},);

describe('orderByRefs', () => {
    const id1 = '00000000-0000-4000-8000-000000000001';
    const rows = [
        { id: id1, slug: 'one', created_at: '2026-01-02', },
        { id: '00000000-0000-4000-8000-000000000002', slug: 'two', created_at: '2026-01-01', },
        { id: '00000000-0000-4000-8000-000000000003', slug: 'two', created_at: '2026-01-03', },
    ];
    it('keeps the requested order, matching ids and slugs', () => {
        expect(orderByRefs(['two', id1,], rows,).map((r,) => r.id),).toEqual(['00000000-0000-4000-8000-000000000002', id1,],);
    },);
    it('drops unknown refs and duplicates', () => {
        expect(orderByRefs(['zzz', 'one', id1,], rows,).length,).toBe(1,);
    },);
},);

describe('threadRankSql', () => {
    it('latest = last activity, newest = date posted', () => {
        expect(threadRankSql('latest', 'r',).order,).toBe('COALESCE(t.last_reply_at, t.created_at) DESC',);
        expect(threadRankSql('newest', 'r',).order,).toBe('t.created_at DESC',);
    },);
    it('hot / top order by score', () => {
        expect(threadRankSql('hot', 'r',).order,).toContain('score DESC',);
        expect(threadRankSql('top', 'r',).score,).toContain('t.reply_count + r',);
    },);
},);

describe('forumFeed', () => {
    it('an unscoped query leaves hidden-from-index categories out; naming the category includes them', async () => {
        wire([thread('t1', 'one',),],);
        await forumFeed({}, ANON,);
        expect(sqls().find((s,) => s.includes('FROM forum_threads t',) && s.includes('LIMIT',)),).toContain('hidden_from_index',);
        dbQuery.mockClear();
        await forumFeed({ category: 'talk', }, ANON,);
        const sql = sqls().find((s,) => s.includes('FROM forum_threads t',) && s.includes('LIMIT',))!;
        expect(sql,).not.toContain('hidden_from_index',);
        expect(sql,).toContain('fc.slug = $',);
    },);

    it('selected threads come back in the requested order, hidden categories included', async () => {
        wire([thread('00000000-0000-4000-8000-00000000000a', 'alpha',), thread('00000000-0000-4000-8000-00000000000b', 'beta',),],);
        const r = await forumFeed({ threads: ['beta', 'alpha',], }, ANON,);
        expect(r.items.map((i,) => i.slug),).toEqual(['beta', 'alpha',],);
        expect(sqls().join('\n',),).not.toContain('hidden_from_index',);
    },);

    it('a signed-in viewer also sees their own pending threads', async () => {
        wire([thread('t1', 'mine', { status: 'pending', },),],);
        const r = await forumFeed({}, MEMBER,);
        expect(sqls().find((s,) => s.includes('FROM forum_threads t',) && s.includes('LIMIT',)),).toContain(`t.status = 'pending' AND t.author_id = $`,);
        expect(r.items[0].status,).toBe('pending',);
        expect(r.items[0].excerpt,).toBe('Body of mine',);
    },);

    it('drops threads the target refuses to read and reports reply rights', async () => {
        wire([thread('t1', 'open',), thread('t2', 'closed',),],);
        accessFor.mockImplementation(async () => new Map([
            ['forum_thread:t1', { canRead: true, canComment: false, reason: 'This thread is locked.', },],
            ['forum_thread:t2', { canRead: false, canComment: false, },],
        ],),);
        const r = await forumFeed({}, MEMBER,);
        expect(r.items.map((i,) => i.slug),).toEqual(['open',],);
        expect(r.items[0],).toMatchObject({ canReply: false, replyBlockedReason: 'This thread is locked.', },);
        expect(r.items[0].opening,).toMatchObject({ id: 'o-t1', },);
    },);

    it('post target: guests may post only with Allow anonymous posting + the permission', async () => {
        wire([],);
        let r = await forumFeed({ postCategory: 'talk', }, ANON,);
        expect(r.postTarget,).toMatchObject({ categorySlug: 'talk', canPost: false, anonymous: false, reason: 'Sign in to post.', },);
        expect(r.anonymousAllowed,).toBe(false,);

        settings.current = { allowAnonymous: true, };
        r = await forumFeed({ postCategory: 'talk', }, ANON,);
        expect(r.postTarget,).toMatchObject({ canPost: true, anonymous: true, },);
        expect(r.anonymousAllowed,).toBe(true,);

        can.mockImplementation(async (_v: unknown, key: string,) => key !== 'forum:post_anonymous',);
        r = await forumFeed({ postCategory: 'talk', }, ANON,);
        expect(r.postTarget,).toMatchObject({ canPost: false, anonymous: false, },);
    },);

    it('post target: a member needs forum:thread_create', async () => {
        wire([],);
        let r = await forumFeed({ postCategory: 'talk', }, MEMBER,);
        expect(r.postTarget,).toMatchObject({ canPost: true, reason: null, },);
        can.mockImplementation(async (_v: unknown, key: string,) => key !== 'forum:thread_create',);
        r = await forumFeed({ postCategory: 'talk', }, MEMBER,);
        expect(r.postTarget,).toMatchObject({ canPost: false, reason: 'You cannot start threads.', },);
    },);
},);
