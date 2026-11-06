import { afterEach, describe, expect, it, vi, } from 'vitest';

vi.mock('../../../../db', () => ({ query: vi.fn(async () => ({ rows: [], }),), transaction: vi.fn(), }),);
vi.mock('../../../social.js', () => ({ mirrorRemoteMedia: vi.fn(async (u: string,) => u,), }),);

const map = await import('./facebookMapping');
const media = await import('./facebookMedia');
await import('./facebook');
const { getCollector, } = await import('../registry');

type Reply = { status?: number; body: unknown; };
function stubFetch(answer: (url: URL,) => Reply,): void {
    vi.stubGlobal('fetch', vi.fn(async (input: string,) => {
        const r = answer(new URL(input,),);
        return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.body, } as unknown as Response;
    },),);
}
const graphErr = (code: number, message: string,): Reply => ({ status: 400, body: { error: { code, message, }, }, });
const END = '2026-11-04T07:00:00+0000';

afterEach(() => vi.unstubAllGlobals());

describe('facebookMapping', () => {
    it('page daily: totals, ms → minutes, video splits, reactions by type', () => {
        const pts = map.pageDailyPoints({
            data: [
                { name: 'page_media_view', period: 'day', values: [{ value: 300, end_time: END, },], },
                { name: 'page_video_view_time', period: 'day', values: [{ value: 120000, end_time: END, },], },
                { name: 'page_video_views_paid', period: 'day', values: [{ value: 4, end_time: END, },], },
                { name: 'page_actions_post_reactions_total', period: 'day', values: [{ value: { like: 5, love: 2, }, end_time: END, },], },
                { name: 'page_media_view', period: 'week', values: [{ value: 999, end_time: END, },], },
            ],
        },);
        expect(pts,).toEqual([
            { date: '2026-11-03', metric: 'views', value: 300, },
            { date: '2026-11-03', metric: 'watchTimeMinutes', value: 2, },
            { date: '2026-11-03', metric: 'videoViews', value: 4, dimension: 'paid:PAID', },
            { date: '2026-11-03', metric: 'reactions', value: 5, dimension: 'reaction:like', },
            { date: '2026-11-03', metric: 'reactions', value: 2, dimension: 'reaction:love', },
            { date: '2026-11-03', metric: 'reactions', value: 7, },
        ],);
    },);

    it('breakdowns: both answer shapes, plain numbers ignored', () => {
        const a = map.pageBreakdownPoints({
            data: [{ name: 'page_media_view', total_value: { breakdowns: [{ dimension_keys: ['is_from_followers',], results: [{ dimension_values: ['true',], value: 8, }, { dimension_values: ['false',], value: 3, },], },], }, },],
        }, 'is_from_followers', '2026-11-03',);
        expect(a.map((p,) => [p.dimension, p.value,]),).toEqual([['follow:FOLLOWER', 8,], ['follow:NON_FOLLOWER', 3,],],);
        const b = map.pageBreakdownPoints({ data: [{ name: 'page_media_view', values: [{ value: { true: 1, false: 9, }, },], },], }, 'is_from_ads', '2026-11-03',);
        expect(b.map((p,) => [p.dimension, p.value,]),).toEqual([['paid:PAID', 1,], ['paid:ORGANIC', 9,],],);
        expect(map.pageBreakdownPoints({ data: [{ name: 'page_media_view', values: [{ value: 5, },], },], }, 'is_from_ads', 'd',),).toEqual([],);
    },);

    it('audience: followers by country / city', () => {
        const pts = map.audiencePoints({
            data: [
                { name: 'page_follows_country', values: [{ value: { US: 40, CA: 2, }, },], },
                { name: 'page_follows_city', values: [{ value: { 'Dallas, TX': 7, }, },], },
            ],
        }, '2026-11-05',);
        expect(pts,).toEqual([
            { date: '2026-11-05', metric: 'audienceFollowers', value: 40, dimension: 'country:US', },
            { date: '2026-11-05', metric: 'audienceFollowers', value: 2, dimension: 'country:CA', },
            { date: '2026-11-05', metric: 'audienceFollowers', value: 7, dimension: 'city:Dallas, TX', },
        ],);
    },);

    it('post kinds', () => {
        expect(map.fbPostKind({ attachments: { data: [{ media_type: 'photo', },], }, },),).toBe('photo',);
        expect(map.fbPostKind({ attachments: { data: [{ media_type: 'video', type: 'video_inline', },], }, },),).toBe('video',);
        expect(map.fbPostKind({ permalink_url: 'https://www.facebook.com/reel/123', },),).toBe('reel',);
        expect(map.fbPostKind({ status_type: 'shared_story', },),).toBe('link',);
        expect(map.fbPostKind({ status_type: 'created_event', },),).toBe('event',);
        expect(map.fbPostKind({ status_type: 'mobile_status_update', },),).toBe('post',);
    },);

    it('maps a reel: plays replace views, completion from avg ÷ length', () => {
        const p = map.mapFacebookPost('P_1', { reactions: { summary: { total_count: 4, }, }, },
            new Map([['post_media_view', 50,], ['post_video_length', 20000,],],), {},
            new Map([['fb_reels_total_plays', 900,], ['post_video_avg_time_watched', 5000,], ['post_video_view_time', 60000,],],),);
        expect(p,).toMatchObject({ views: 900, likes: 4, shares: 0, avgWatchS: 5, watchTimeS: 60, completionRate: 0.25, },);
        expect(p.raw?.mediaViews,).toBe(50,);
    },);

    it('capabilities: basic tier and notes', () => {
        const caps = { pageNode: true, postsList: true, reels: false, accountInsights: false, breakdowns: false, newFollowers: false, demographics: false, onlineFollowers: false, mediaInsights: false, videoInsights: false, benchmarks: false, checkedAt: '', };
        expect(map.isBasicTier(caps,),).toBe(true,);
        expect(map.isBasicTier({ ...caps, accountInsights: true, newFollowers: true, mediaInsights: true, },),).toBe(false,);
        expect(map.fbCapabilityNotes({ ...caps, accountInsights: true, newFollowers: true, mediaInsights: true, },),).toEqual([],);
    },);
},);

describe('facebookMedia', () => {
    it('merges a reel into its listed post, adds an unlisted one', () => {
        const items = media.mergeItems('P', [
            { id: 'P_1', attachments: { data: [{ media_type: 'video', target: { id: 'V1', }, },], }, },
            { id: 'P_2', },
        ], [{ id: 'V1', }, { id: 'V9', post_id: 'P_9', permalink_url: '/reel/V9', },],);
        expect(items.map((i,) => [i.externalId, i.kind, i.videoId,]),).toEqual([['P_1', 'reel', 'V1',], ['P_2', 'post', null,], ['P_9', 'reel', 'V9',],],);
        expect(items[2].node.permalink_url,).toBe('https://www.facebook.com/reel/V9',);
    },);

    it('listingDone needs 25 items AND the last older than 90 days', () => {
        const old = new Date(Date.now() - 100 * 86_400_000,).toISOString();
        expect(media.listingDone(Array(24,).fill({ created_time: old, },), Date.now(),),).toBe(false,);
        expect(media.listingDone(Array(25,).fill({ created_time: old, },), Date.now(),),).toBe(true,);
    },);
},);

describe('facebook collector tiers', () => {
    const run = async () => {
        const warned: string[] = [];
        const r = await getCollector('facebook',)!.collect({
            today: '2026-11-05', posts: [], credentials: { accessToken: 'EAAp', pageId: 'P1', }, settings: {}, warn: (m,) => warned.push(m,),
        },);
        return { r, warned, };
    };

    it('basic tier: insights refused → followers + posts still collected, upgrade warning', async () => {
        stubFetch((u,) => {
            const path = u.pathname.split('/',).slice(2,).join('/',);
            if (path === 'P1' && u.searchParams.get('fields',) === 'access_token') return graphErr(100, 'nonexisting field',);
            if (path === 'P1') return { body: { followers_count: 10, name: 'Page', }, };
            if (path === 'P1/published_posts') {
                return { body: { data: [{ id: 'P1_1', created_time: '2026-11-01T10:00:00+0000', reactions: { summary: { total_count: 3, }, }, comments: { summary: { total_count: 1, }, }, },], }, };
            }
            if (path.endsWith('/insights',)) return graphErr(10, '(#10) Requires read_insights permission',);
            return graphErr(100, 'unknown',);
        },);
        const { r, warned, } = await run();
        expect(r.account?.followers,).toBe(10,);
        expect(r.daily,).toEqual([],);
        expect(r.posts,).toEqual([expect.objectContaining({ externalId: 'P1_1', likes: 3, comments: 1, views: null, },),],);
        expect(warned.join(' ',),).toContain('read_insights',);
    },);

    it('status: partial when the granted scopes lack read_insights', async () => {
        const s = await getCollector('facebook',)!.status({ accessToken: 'EAA', pageId: 'P', grantedScopes: ['pages_read_engagement', 'pages_show_list',], }, true,);
        expect(s.state,).toBe('partial',);
        expect(s.message,).toContain('ANALYZE',);
    },);

    it('status: ready when every insights family worked', async () => {
        const caps = { pageNode: true, postsList: true, reels: true, accountInsights: true, breakdowns: true, newFollowers: true, demographics: true, onlineFollowers: false, mediaInsights: true, videoInsights: true, benchmarks: false, checkedAt: '', };
        const s = await getCollector('facebook',)!.status({ accessToken: 'EAA', pageId: 'P', analyticsCapabilities: caps, }, true,);
        expect(s.state,).toBe('ready',);
    },);
},);
