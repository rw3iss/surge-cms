import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../../../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);

import { benchmarkPoints, breakdownPoints, capabilityNotes, demographicPoints, igPostKind, mapInstagramMedia, navigationBreakdown, onlineFollowerPoints, } from './instagramMapping';
import { listingDone, } from './instagramMedia';

const bd = (name: string, key: string, results: Array<[string, number,]>,) => ({
    data: [{ name, total_value: { value: results.reduce((t, [, v,],) => t + v, 0,), breakdowns: [{ dimension_keys: [key,], results: results.map(([k, v,],) => ({ dimension_values: [k,], value: v, })), },], }, },],
});

describe('instagram mapping (pure)', () => {
    it('content-type and follower splits become dimensioned points', () => {
        expect(breakdownPoints(bd('views', 'media_product_type', [['REEL', 70,], ['POST', 30,],],), '2026-11-04',),).toEqual([
            { date: '2026-11-04', metric: 'views', value: 70, dimension: 'type:REEL', },
            { date: '2026-11-04', metric: 'views', value: 30, dimension: 'type:POST', },
        ],);
        expect(breakdownPoints(bd('reach', 'follow_type', [['NON_FOLLOWER', 5,],],), 'd',)[0].dimension,).toBe('follow:NON_FOLLOWER',);
        expect(breakdownPoints(bd('odd', 'follow_type', [['X', 1,],],), 'd',),).toEqual([],);
    },);

    it('demographics map to audience* metrics by age / gender / country / city', () => {
        const p = demographicPoints(bd('engaged_audience_demographics', 'country', [['US', 40,], ['CA', 3,],],), '2026-11-05',);
        expect(p,).toEqual([
            { date: '2026-11-05', metric: 'audienceEngaged', value: 40, dimension: 'country:US', },
            { date: '2026-11-05', metric: 'audienceEngaged', value: 3, dimension: 'country:CA', },
        ],);
    },);

    it('online followers: one point per hour on the day covered', () => {
        const p = onlineFollowerPoints({ data: [{ name: 'online_followers', values: [{ value: { 0: 3, 13: 20, 99: 1, }, end_time: '2026-11-05T08:00:00+0000', },], },], },);
        expect(p,).toEqual([
            { date: '2026-11-04', metric: 'onlineFollowers', value: 3, dimension: 'hour:0', },
            { date: '2026-11-04', metric: 'onlineFollowers', value: 20, dimension: 'hour:13', },
        ],);
    },);

    it('maps kinds, reels watch time (ms → s), skip rate → kept-watching share, story replies → comments', () => {
        expect(igPostKind({ media_product_type: 'REELS', },),).toBe('reel',);
        expect(igPostKind({ media_product_type: 'FEED', media_type: 'CAROUSEL_ALBUM', },),).toBe('carousel',);
        expect(igPostKind({ media_product_type: 'STORY', },),).toBe('story',);
        const r = mapInstagramMedia('r1', { media_product_type: 'REELS', }, new Map([['ig_reels_avg_watch_time', 4500,], ['reels_skip_rate', 35,], ['views', 900,],],),);
        expect(r,).toMatchObject({ views: 900, avgWatchS: 4.5, completionRate: 0.65, },);
        expect(mapInstagramMedia('s1', { media_product_type: 'STORY', }, new Map([['replies', 3,],],),).comments,).toBe(3,);
    },);

    it('story navigation breakdown', () => {
        expect(navigationBreakdown(bd('navigation', 'story_navigation_action_type', [['TAP_FORWARD', 10,], ['TAP_EXIT', 2,],],),),)
            .toEqual({ tap_forward: 10, tap_exit: 2, total: 12, },);
    },);

    it('benchmark points: followers, averages, posting rate', () => {
        const p = benchmarkPoints('Nasa', { followers_count: 1000, media_count: 50, media: { data: [
            { like_count: 10, comments_count: 2, timestamp: '2026-11-01T00:00:00+0000', },
            { like_count: 30, comments_count: 4, timestamp: '2026-10-25T00:00:00+0000', },
        ], }, }, '2026-11-05',);
        const v = Object.fromEntries(p.map((x,) => [x.metric, x.value,]),);
        expect(v,).toMatchObject({ peerFollowers: 1000, peerMediaCount: 50, peerAvgLikes: 20, peerAvgComments: 3, peerPostsPerWeek: 1, },);
        expect(p.every((x,) => x.dimension === 'peer:nasa'),).toBe(true,);
    },);

    it('lists until 90 days back with at least 25 items; names what is missing', () => {
        const now = Date.parse('2026-11-05T00:00:00Z',);
        const items = (n: number, iso: string,) => Array.from({ length: n, }, (_, i,) => ({ id: String(i,), timestamp: iso, }));
        expect(listingDone(items(10, '2026-01-01T00:00:00+0000',), now,),).toBe(false,);
        expect(listingDone(items(30, '2026-10-01T00:00:00+0000',), now,),).toBe(false,);
        expect(listingDone(items(30, '2026-06-01T00:00:00+0000',), now,),).toBe(true,);
        expect(capabilityNotes({ accountInsights: true, breakdowns: true, newFollowers: true, demographics: false, onlineFollowers: true, mediaInsights: true, stories: true, benchmarks: false, checkedAt: '', },),)
            .toEqual(['audience demographics (needs 100+ followers)',],);
    },);
},);
