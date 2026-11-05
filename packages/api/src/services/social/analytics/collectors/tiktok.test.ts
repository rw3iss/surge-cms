import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queries: Array<{ sql: string; params: unknown[]; }> = [];
vi.mock('../../../../db', () => ({
    query: vi.fn(async (sql: string, params: unknown[] = [],) => {
        queries.push({ sql, params, },);
        return { rows: [], rowCount: 0, };
    },),
}),);
vi.mock('../../../../config', () => ({ config: { social: { tiktok: { clientKey: 'ck', clientSecret: 'cs', }, }, }, }),);

import { getCollector, } from '../registry';
import { grantedScopes, tiktokAccount, tiktokBusinessDaily, tiktokBusinessMetric, tiktokPostMetric, tiktokPostRow, } from './tiktok';

const video = {
    id: '7300000000000000001',
    create_time: 1_700_000_000,
    cover_image_url: 'https://p16.tiktokcdn.com/c.jpg',
    share_url: 'https://www.tiktok.com/@x/video/7300000000000000001',
    title: 'Hello',
    video_description: 'desc',
    duration: 31,
    view_count: 1200,
    like_count: 50,
    comment_count: 4,
    share_count: 2,
};

describe('tiktok mappers', () => {
    it('maps the profile to an account snapshot', () => {
        expect(tiktokAccount({ follower_count: 10, following_count: 3, likes_count: 99, video_count: 7, },),).toMatchObject({
            followers: 10, following: 3, totalLikes: 99, postsCount: 7,
        },);
    },);
    it('maps a video to a post metric and a social_posts row', () => {
        expect(tiktokPostMetric(video,),).toMatchObject({ externalId: video.id, views: 1200, likes: 50, comments: 4, shares: 2, },);
        const row = tiktokPostRow(video,);
        expect(row.content,).toBe('Hello',);
        expect(row.postUrl,).toBe(video.share_url,);
        expect(row.publishedAt,).toBe(new Date(1_700_000_000_000,).toISOString(),);
        expect(tiktokPostRow({ id: '1', video_description: ' d ', },).content,).toBe('d',);
    },);
    it('maps Business API rows', () => {
        expect(tiktokBusinessMetric({ item_id: '9', total_time_watched: 100, average_time_watched: 4.1, full_video_watched_rate: 0.02, reach: 80, },),)
            .toEqual({ externalId: '9', watchTimeS: 100, avgWatchS: 4.1, completionRate: 0.02, reach: 80, },);
        expect(tiktokBusinessMetric({ item_id: '9', full_video_watched_rate: 25, },)?.completionRate,).toBe(0.25,);
        expect(tiktokBusinessMetric({},),).toBeNull();
        expect(tiktokBusinessDaily([{ date: '2026-11-01', profile_views: 5, followers_count: -2, video_views: 300, }, { date: 'bad', },],),)
            .toEqual([
                { date: '2026-11-01', metric: 'followersNet', value: -2, },
                { date: '2026-11-01', metric: 'profileViews', value: 5, },
                { date: '2026-11-01', metric: 'views', value: 300, },
            ],);
    },);
    it('parses granted scopes', () => {
        expect(grantedScopes({ scope: 'user.info.basic,video.list', },),).toEqual(['user.info.basic', 'video.list',],);
        expect(grantedScopes({},),).toBeNull();
    },);
},);

describe('tiktok collector', () => {
    const c = getCollector('tiktok',)!;
    beforeEach(() => {
        queries.length = 0;
        vi.restoreAllMocks();
    },);

    it('status reflects connection, scopes and business access', async () => {
        expect((await c.status({}, false,)).state,).toBe('off',);
        expect((await c.status({ accessToken: 't', scope: 'user.info.basic,video.list', }, true,)).state,).toBe('partial',);
        expect((await c.status({ accessToken: 't', }, true,)).message,).toMatch(/Business/,);
        expect((await c.status({ accessToken: 't', businessAccessToken: 'b', businessId: 'x', }, true,)).state,).toBe('ready',);
    },);

    it('refreshes an expired token, collects and upserts videos', async () => {
        const calls: string[] = [];
        vi.spyOn(globalThis, 'fetch',).mockImplementation(async (url: any,) => {
            const u = String(url,);
            calls.push(u,);
            const json = (b: unknown,) => new Response(JSON.stringify(b,), { status: 200, },);
            if (u.includes('/oauth/token/')) return json({ access_token: 'new', refresh_token: 'r2', expires_in: 7200, scope: 'video.list', },);
            if (u.includes('/user/info/')) return json({ data: { user: { display_name: 'Me', follower_count: 5, }, }, error: { code: 'ok', }, },);
            if (u.includes('/video/list/')) return json({ data: { videos: [video,], has_more: false, cursor: 0, }, error: { code: 'ok', }, },);
            return new Response('{}', { status: 404, },);
        },);
        const warnings: string[] = [];
        const res = await c.collect({
            today: '2026-11-05',
            posts: [],
            credentials: { accessToken: 'old', refreshToken: 'r1', tokenExpiresAt: '2020-01-01T00:00:00Z', },
            settings: {},
            warn: (m,) => warnings.push(m,),
        },);
        expect(calls[0],).toContain('/oauth/token/',);
        expect(res.account?.followers,).toBe(5,);
        expect(res.posts,).toHaveLength(1,);
        expect(queries.some((q,) => q.sql.includes('UPDATE social_connections',) && String(q.params[0],).includes('"refreshToken":"r2"',)),).toBe(true,);
        expect(queries.some((q,) => q.sql.includes('INSERT INTO social_posts',) && q.params[0] === video.id),).toBe(true,);
        expect(warnings.join(),).not.toMatch(/Business API not configured/,);
    },);
},);
