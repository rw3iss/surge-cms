import { beforeEach, describe, expect, it, vi, } from 'vitest';

const queries: Array<{ sql: string; params: unknown[]; }> = [];
vi.mock('../../../../db', () => ({
    query: vi.fn(async (sql: string, params: unknown[] = [],) => {
        queries.push({ sql, params, },);
        return { rows: [], rowCount: 0, };
    },),
}),);
vi.mock('../../../../config', () => ({ config: { social: { tiktok: { clientKey: 'ck', clientSecret: 'cs', }, }, }, }),);
const mirror = vi.fn(async (_url: string, _p: string, id: string,) => `/uploads/social/tiktok-${id}.jpg`,);
vi.mock('../../../social', () => ({ mirrorRemoteMedia: mirror, }),);

import { getCollector, } from '../registry';
import { adoptNewerToken, grantedScopes, tiktokAccount, tiktokPostMetric, tiktokPostRow, } from './tiktok';

const video = {
    id: '7300000000000000001',
    create_time: 1_700_000_000,
    cover_image_url: 'https://p16-sign-va.tiktokcdn.com/c.jpg?x-expires=1',
    share_url: 'https://www.tiktok.com/@x/video/7300000000000000001',
    title: 'Hello',
    video_description: 'desc',
    duration: 31,
    view_count: 1200,
    like_count: 50,
    comment_count: 4,
    share_count: 2,
};

describe('tiktok display mappers', () => {
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
    it('adopts a token another process renewed (rotated refresh token), not an expired or identical one', () => {
        const keys = { access: 'accessToken', refresh: 'refreshToken', expires: 'tokenExpiresAt', };
        const now = Date.parse('2026-11-05T00:00:00Z',);
        const creds: Record<string, unknown> = { accessToken: 'old', refreshToken: 'r1', };
        expect(adoptNewerToken(creds, { accessToken: 'old', }, keys, now,),).toBeNull();
        expect(adoptNewerToken(creds, { accessToken: 'n', tokenExpiresAt: '2026-11-04T00:00:00Z', }, keys, now,),).toBeNull();
        expect(adoptNewerToken(creds, { accessToken: 'n', refreshToken: 'r2', tokenExpiresAt: '2026-11-06T00:00:00Z', }, keys, now,),).toBe('n',);
        expect(creds,).toMatchObject({ accessToken: 'n', refreshToken: 'r2', },);
    },);
    it('parses granted scopes', () => {
        expect(grantedScopes({ scope: 'user.info.basic,video.list', },),).toEqual(['user.info.basic', 'video.list',],);
        expect(grantedScopes({},),).toBeNull();
    },);
},);

const json = (b: unknown,) => new Response(JSON.stringify(b,), { status: 200, },);
const ok = (data: unknown,) => json({ code: 0, message: 'OK', data, },);

describe('tiktok collector', () => {
    const c = getCollector('tiktok',)!;
    beforeEach(() => {
        queries.length = 0;
        mirror.mockClear();
        vi.restoreAllMocks();
    },);

    it('status: off, basic (partial + upgrade help), business ready, capability gaps', async () => {
        expect((await c.status({}, false,)).state,).toBe('off',);
        const basic = await c.status({ accessToken: 't', scope: 'user.info.basic,user.info.stats,video.list', }, true,);
        expect(basic.state,).toBe('partial',);
        expect(basic.message,).toMatch(/Business Account/,);
        expect((await c.status({ accessToken: 't', scope: 'user.info.basic', }, true,)).message,).toMatch(/user\.info\.stats \+ video\.list/,);
        expect((await c.status({ accessToken: 't', businessAccessToken: 'b', businessId: 'x', }, true,)).state,).toBe('ready',);
        const gaps = await c.status({
            businessAccessToken: 'b', businessId: 'x',
            analyticsCapabilities: { businessAccount: true, accountInsights: true, newFollowers: false, demographics: false, onlineFollowers: true, mediaInsights: true, },
        }, true,);
        expect(gaps.state,).toBe('partial',);
        expect(gaps.message,).toMatch(/follower demographics/,);
        expect(gaps.collects.join(),).toMatch(/Business API/,);
    },);

    it('basic tier: refreshes an expired token (rotated), collects, upserts + mirrors covers once', async () => {
        const calls: string[] = [];
        vi.spyOn(globalThis, 'fetch',).mockImplementation(async (url: any,) => {
            const u = String(url,);
            calls.push(u,);
            if (u.includes('/oauth/token/')) return json({ access_token: 'new', refresh_token: 'r2', expires_in: 86400, refresh_expires_in: 31536000, scope: 'video.list', open_id: 'o1', },);
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
        const insert = queries.find((q,) => q.sql.includes('INSERT INTO social_posts',) && q.params[0] === video.id);
        expect(insert?.params[3],).toBe(`/uploads/social/tiktok-${video.id}.jpg`,);
        expect(mirror,).toHaveBeenCalledTimes(1,);
        expect(calls.some((u,) => u.includes('business-api'),),).toBe(false,);
        expect(warnings,).toEqual([],);
    },);

    it('business tier: every family independent; a refused family is recorded, not fatal', async () => {
        vi.spyOn(globalThis, 'fetch',).mockImplementation(async (url: any,) => {
            const u = new URL(String(url,),);
            const fields = JSON.parse(u.searchParams.get('fields',) ?? '[]',) as string[];
            if (u.pathname.endsWith('/business/get/')) {
                if (fields.includes('followers_count',) && !u.searchParams.get('start_date',)) return ok({ display_name: 'Biz', followers_count: 500, videos_count: 3, },);
                if (fields.includes('has_advanced_access',)) return ok({ has_advanced_access: false, is_business_account: true, },);
                if (fields.includes('video_views',)) return ok({ metrics: [{ date: '2026-11-03', video_views: 900, profile_views: 12, followers_count: 500, },], },);
                if (fields.includes('daily_new_followers',)) return ok({ metrics: [{ date: '2026-11-03', daily_new_followers: 7, daily_lost_followers: 2, daily_total_followers: 5, unique_video_views: 600, },], },);
                if (fields.includes('bio_link_clicks',)) return json({ code: 40001, message: 'No permission', data: {}, },);
                if (fields.includes('audience_activity',)) return ok({ metrics: [{ date: '2026-11-03', audience_activity: [{ hour: '20', count: 4, },], },], },);
                if (fields.includes('audience_genders',)) return ok({ audience_genders: [{ gender: 'Female', percentage: 0.6, }, { gender: 'Male', percentage: 0.4, },], },);
            }
            if (u.pathname.endsWith('/business/video/list/')) {
                if (fields.includes('total_time_watched',)) {
                    return ok({ videos: [{ item_id: '42', total_time_watched: 100, average_time_watched: 4, full_video_watched_rate: 0.03, impression_sources: [{ impression_source: 'For You', percentage: 0.9, },], },], has_more: false, },);
                }
                return ok({ videos: [{ item_id: '42', create_time: '1700000000', thumbnail_url: 'https://p16.tiktokcdn-us.com/t.jpg', caption: 'Cap', video_views: 1000, likes: 9, reach: 700, },], has_more: false, },);
            }
            return new Response('{}', { status: 404, },);
        },);
        const warnings: string[] = [];
        const res = await c.collect({
            today: '2026-11-05',
            posts: [],
            credentials: { businessAccessToken: 'b', businessId: 'open-1', businessTokenExpiresAt: '2099-01-01T00:00:00Z', },
            settings: {},
            warn: (m,) => warnings.push(m,),
        },);
        expect(warnings,).toEqual([],);
        expect(res.account?.followers,).toBe(500,);
        const pts = res.daily!;
        expect(pts,).toContainEqual({ date: '2026-11-03', metric: 'views', value: 900, },);
        expect(pts,).toContainEqual({ date: '2026-11-03', metric: 'newFollowers', value: 7, },);
        expect(pts,).toContainEqual({ date: '2026-11-03', metric: 'onlineFollowers', value: 4, dimension: 'hour:20', },);
        expect(pts,).toContainEqual({ date: '2026-11-05', metric: 'audienceFollowers', value: 60, dimension: 'gender:F', },);
        expect(pts,).toContainEqual({ date: '2026-11-05', metric: 'trafficSources', value: 900, dimension: 'source:For You', },);
        expect(res.posts?.[0],).toMatchObject({ externalId: '42', views: 1000, reach: 700, watchTimeS: 100, completionRate: 0.03, },);
        const caps = queries.map((q,) => String(q.params[0],),).find((p,) => p.includes('analyticsCapabilities',),)!;
        expect(JSON.parse(caps,).analyticsCapabilities,).toMatchObject({
            businessAccount: true, accountInsights: true, newFollowers: true, profileActions: false, onlineFollowers: true,
            demographics: true, mediaInsights: true, advancedAccess: true,
        },);
        expect(queries.some((q,) => q.sql.includes('INSERT INTO social_posts',) && q.params[0] === '42'),).toBe(true,);
    },);

    it('a dead Business token does not stop the basic tier', async () => {
        vi.spyOn(globalThis, 'fetch',).mockImplementation(async (url: any,) => {
            const u = String(url,);
            if (u.includes('business-api')) return json({ code: 40105, message: 'Access token is expired', data: {}, },);
            if (u.includes('/user/info/')) return json({ data: { user: { follower_count: 3, }, }, error: { code: 'ok', }, },);
            if (u.includes('/video/list/')) return json({ data: { videos: [], has_more: false, }, error: { code: 'ok', }, },);
            return new Response('{}', { status: 404, },);
        },);
        const warnings: string[] = [];
        const res = await c.collect({
            today: '2026-11-05',
            posts: [],
            credentials: { accessToken: 't', businessAccessToken: 'b', businessId: 'x', },
            settings: {},
            warn: (m,) => warnings.push(m,),
        },);
        expect(res.account?.followers,).toBe(3,);
        expect(warnings.join(),).toMatch(/Business API token/,);
        expect(queries.some((q,) => String(q.params[0],).includes('businessOauthError',)),).toBe(true,);
    },);
},);
