import { afterEach, describe, expect, it, vi, } from 'vitest';

vi.mock('../../../../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);

const meta = await import('./metaGraph');
const ig = await import('./instagram');
const fb = await import('./facebook');
const { getCollector, } = await import('../registry');

type Reply = { status?: number; body: unknown; };
/** fetch stub answering by the `metric` / path of each Graph request. */
function stubFetch(answer: (url: URL,) => Reply,): ReturnType<typeof vi.fn> {
    const fn = vi.fn(async (input: string,) => {
        const r = answer(new URL(input,),);
        return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body, } as unknown as Response;
    },);
    vi.stubGlobal('fetch', fn,);
    return fn;
}
const graphErr = (code: number, message: string,): Reply => ({ status: 400, body: { error: { code, message, }, }, });

afterEach(() => vi.unstubAllGlobals());

describe('metaGraph', () => {
    it('endTimeToDate: a daily end_time covers the day before', () => {
        expect(meta.endTimeToDate('2026-11-04T07:00:00+0000',),).toBe('2026-11-03',);
    },);

    it('insightNumbers reads total_value and the last values[] entry', () => {
        const m = meta.insightNumbers({
            data: [
                { name: 'views', total_value: { value: 120, }, },
                { name: 'reach', values: [{ value: 3, }, { value: 9, },], },
                { name: 'post_reactions_by_type_total', values: [{ value: { like: 2, }, },], },
            ],
        },);
        expect([...m,],).toEqual([['views', 120,], ['reach', 9,],],);
    },);

    it('classifies errors', () => {
        const e = (code: number, msg = 'x',) => new meta.GraphError(msg, 400, code, null,);
        expect(meta.isTokenError(e(190,),),).toBe(true,);
        expect(meta.isPermissionError(e(10,),),).toBe(true,);
        expect(meta.isPermissionError(e(10, '(#10) Not enough viewers for the media to show insights',),),).toBe(false,);
        expect(meta.isPermissionError(e(200,),),).toBe(true,);
        expect(meta.isMetricError(e(100,),),).toBe(true,);
    },);

    it('fetchInsights drops a dead metric, keeps the rest, warns once', async () => {
        stubFetch((u,) => {
            const m = u.searchParams.get('metric',)!;
            if (m.includes('gone',)) return graphErr(100, '(#100) metric[0] must be one of …',);
            return { body: { data: [{ name: m, total_value: { value: 5, }, },], }, };
        },);
        const dead = new Set<string>();
        const bag = new meta.WarningBag();
        const r = await meta.fetchInsights('https://g.test', 'x/insights', ['views', 'gone',], {}, 't', dead, bag, 'L',);
        expect(meta.insightNumbers(r,).get('views',),).toBe(5,);
        expect(dead.has('gone',),).toBe(true,);
        const warned: string[] = [];
        bag.flush((m,) => warned.push(m,),);
        expect(warned,).toHaveLength(1,);
        expect(warned[0],).toContain('gone',);
    },);

    it('fetchInsights: every metric failing = the object has no insights, nothing blacklisted', async () => {
        stubFetch(() => graphErr(100, 'Media posted before business account conversion',),);
        const dead = new Set<string>();
        const r = await meta.fetchInsights('https://g.test', 'x/insights', ['views', 'reach',], {}, 't', dead, new meta.WarningBag(), 'L',);
        expect(r.data,).toEqual([],);
        expect(dead.size,).toBe(0,);
    },);

    it('WarningBag counts repeats', () => {
        const bag = new meta.WarningBag();
        bag.add('a',);
        bag.add('a',);
        bag.add('b',);
        const out: string[] = [];
        bag.flush((m,) => out.push(m,),);
        expect(out,).toEqual(['a (×2)', 'b',],);
    },);
},);

describe('instagram mapping', () => {
    it('resolves host from the token type', () => {
        expect(ig.resolveInstagramAuth({ accessToken: 'EAAx', id: '178', },)?.base,).toContain('graph.facebook.com',);
        expect(ig.resolveInstagramAuth({ accessToken: 'IGAAx', id: '178', },)?.base,).toContain('graph.instagram.com',);
        expect(ig.resolveInstagramAuth({ accessToken: '', },),).toBeNull();
    },);

    it('maps a Reel: watch times ms → seconds, saved → saves', () => {
        const p = ig.mapInstagramMedia('m1', { media_product_type: 'REELS', like_count: 1, comments_count: 2, }, new Map([
            ['views', 1000,],
            ['reach', 800,],
            ['likes', 50,],
            ['saved', 7,],
            ['ig_reels_avg_watch_time', 4500,],
            ['ig_reels_video_view_total_time', 3_600_000,],
        ],),);
        expect(p,).toMatchObject({ externalId: 'm1', views: 1000, reach: 800, likes: 50, comments: 2, saves: 7, avgWatchS: 4.5, watchTimeS: 3600, },);
    },);

    it('falls back to like_count / comments_count without insights', () => {
        const p = ig.mapInstagramMedia('m2', { like_count: 3, comments_count: 4, }, new Map(),);
        expect(p,).toMatchObject({ likes: 3, comments: 4, views: null, watchTimeS: null, },);
    },);

    it('mediaKind', () => {
        expect(ig.mediaKind({ media_product_type: 'REELS', },),).toBe('REELS',);
        expect(ig.mediaKind({ media_product_type: 'AD', media_type: 'CAROUSEL_ALBUM', },),).toBe('FEED',);
    },);

    it('daily total_value + follows breakdown', () => {
        expect(ig.totalValuePoints({ data: [{ name: 'total_interactions', total_value: { value: 9, }, }, { name: 'odd', total_value: { value: 1, }, },], }, '2026-11-03',),)
            .toEqual([{ date: '2026-11-03', metric: 'engagements', value: 9, },],);
        expect(ig.followPoints({
            data: [{
                name: 'follows_and_unfollows',
                total_value: { breakdowns: [{ dimension_keys: ['follow_type',], results: [{ dimension_values: ['FOLLOWER',], value: 12, }, { dimension_values: ['NON_FOLLOWER',], value: 3, },], },], },
            },],
        }, '2026-11-03',),).toEqual([
            { date: '2026-11-03', metric: 'followersGained', value: 12, },
            { date: '2026-11-03', metric: 'followersLost', value: 3, },
        ],);
    },);

    it('story points carry the story dimension on its posting day', () => {
        expect(ig.storyPoints('s1', '2026-11-04T22:15:00+0000', new Map([['views', 40,], ['replies', 2,],],),),).toEqual([
            { date: '2026-11-04', metric: 'storyViews', value: 40, dimension: 'story:s1', },
            { date: '2026-11-04', metric: 'storyReplies', value: 2, dimension: 'story:s1', },
        ],);
    },);

    it('collect: each family on its own — account + media list + counters when insights are refused', async () => {
        const db = await import('../../../../db');
        vi.mocked(db.query,).mockResolvedValue({ rows: [], rowCount: 0, } as never,);
        stubFetch((u,) => {
            const path = u.pathname.split('/',).slice(2,).join('/',);
            if (path === '178') return { body: { followers_count: 900, follows_count: 10, media_count: 55, }, };
            if (path === '178/media') return { body: { data: [{ id: 'm1', like_count: 5, comments_count: 1, media_product_type: 'FEED', media_type: 'IMAGE', timestamp: '2026-11-01T10:00:00+0000', },], }, };
            if (path === '178/stories') return { body: { data: [], }, };
            if (path.endsWith('/insights',)) return graphErr(10, '(#10) Application does not have permission for this action',);
            return graphErr(100, 'unknown',);
        },);
        const warned: string[] = [];
        const c = getCollector('instagram',)!;
        const r = await c.collect({
            today: '2026-11-05',
            posts: [],
            credentials: { accessToken: 'EAAx', id: '178', },
            settings: {},
            warn: (m,) => warned.push(m,),
        },);
        expect(r.account,).toMatchObject({ followers: 900, following: 10, postsCount: 55, },);
        expect(r.posts,).toEqual([expect.objectContaining({ externalId: 'm1', likes: 5, comments: 1, views: null, },),],);
        expect(warned.some((w,) => w.includes('did not provide',)),).toBe(true,);
        // The social_posts upsert ran for the listed item.
        expect(vi.mocked(db.query,).mock.calls.some(([sql,],) => String(sql,).includes('INSERT INTO social_posts',)),).toBe(true,);
    },);

    it('status: partial with what the account cannot give (capabilities from the last run)', async () => {
        const c = getCollector('instagram',)!;
        const caps = { accountInsights: false, breakdowns: false, newFollowers: true, demographics: false, onlineFollowers: false, mediaInsights: true, stories: true, benchmarks: false, checkedAt: 'x', };
        const st = await c.status({ accessToken: 'EAAx', id: '178', analyticsCapabilities: caps, }, true,);
        expect(st.state,).toBe('partial',);
        expect(st.message,).toMatch(/demographics/,);
        const all = { ...caps, accountInsights: true, demographics: true, onlineFollowers: true, };
        expect((await c.status({ accessToken: 'EAAx', id: '178', analyticsCapabilities: all, }, true,)).state,).toBe('ready',);
    },);

    it('status: off when not connected, partial when the scope is missing', async () => {
        const c = getCollector('instagram',)!;
        expect((await c.status({}, false,)).state,).toBe('off',);
        expect((await c.status({ accessToken: 'EAA', id: '1', grantedScopes: 'instagram_basic,pages_show_list', }, true,)).state,).toBe('partial',);
    },);

    it('registers the stories cron', () => {
        expect(getCollector('instagram',)!.crons?.[0]?.name,).toBe('social-analytics-ig-stories',);
    },);
},);

describe('facebook mapping', () => {
    it('daily series: names → ours, view time ms → minutes', () => {
        const pts = meta.timeSeriesPoints({
            data: [
                { name: 'page_media_view', period: 'day', values: [{ value: 300, end_time: '2026-11-04T07:00:00+0000', },], },
                { name: 'page_video_view_time', period: 'day', values: [{ value: 120000, end_time: '2026-11-04T07:00:00+0000', },], },
                { name: 'page_daily_unfollows_unique', period: 'day', values: [{ value: 2, end_time: '2026-11-04T07:00:00+0000', },], },
            ],
        }, fb.FB_DAILY_METRICS, { page_video_view_time: 1 / 60000, },);
        expect(pts,).toEqual([
            { date: '2026-11-03', metric: 'views', value: 300, },
            { date: '2026-11-03', metric: 'watchTimeMinutes', value: 2, },
            { date: '2026-11-03', metric: 'followersLost', value: 2, },
        ],);
    },);

    it('maps a post: summaries + insights, view time ms → s', () => {
        const p = fb.mapFacebookPost('1_2', {
            reactions: { summary: { total_count: 10, }, },
            comments: { summary: { total_count: 3, }, },
        }, new Map([['post_media_view', 500,], ['post_total_media_view_unique', 400,], ['post_video_view_time', 90000,], ['post_clicks', 6,],],), { post_reactions_by_type_total: { like: 9, love: 1, }, },);
        expect(p,).toMatchObject({ externalId: '1_2', likes: 10, comments: 3, shares: 0, views: 500, reach: 400, clicks: 6, watchTimeS: 90, },);
        expect(p.raw?.reactionsByType,).toEqual({ like: 9, love: 1, },);
    },);

    it('status: off with setup instructions when not connected', async () => {
        const s = await getCollector('facebook',)!.status({}, false,);
        expect(s.state,).toBe('off',);
        expect(s.message,).toContain('read_insights',);
    },);

    it('collect end-to-end with a page token', async () => {
        stubFetch((u,) => {
            const path = u.pathname.split('/',).slice(2,).join('/',);
            if (path === 'P1' && u.searchParams.get('fields',) === 'access_token') return graphErr(100, 'nonexisting field',);
            if (path === 'P1') return { body: { followers_count: 4321, fan_count: 4000, }, };
            if (path === 'P1/insights') {
                return { body: { data: [{ name: 'page_media_view', period: 'day', values: [{ value: 77, end_time: '2026-11-04T07:00:00+0000', },], },], }, };
            }
            if (path === '' && u.searchParams.get('ids',)) return { body: { P1_9: { shares: { count: 2, }, }, }, };
            if (path === 'P1_9/insights') return { body: { data: [{ name: 'post_media_view', values: [{ value: 40, },], },], }, };
            return graphErr(100, 'unknown',);
        },);
        const warned: string[] = [];
        const r = await getCollector('facebook',)!.collect({
            today: '2026-11-05',
            posts: [{ id: 'p', externalId: 'P1_9', publishedAt: null, kind: null, },],
            credentials: { accessToken: 'EAAp', pageId: 'P1', },
            settings: {},
            warn: (m,) => warned.push(m,),
        },);
        expect(r.account?.followers,).toBe(4321,);
        expect(r.daily,).toEqual([{ date: '2026-11-03', metric: 'views', value: 77, },],);
        expect(r.posts,).toEqual([expect.objectContaining({ externalId: 'P1_9', views: 40, shares: 2, },),],);
    },);
},);
