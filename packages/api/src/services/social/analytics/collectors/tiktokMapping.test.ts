import { describe, expect, it, } from 'vitest';
import {
    activityPoints,
    businessAsVideo,
    businessDailyPoints,
    businessPostMetric,
    capabilityNotes,
    distribution,
    followerDemographicPoints,
    fraction,
    genderKey,
    mergeMetric,
    timeline,
    viewWeightedPoints,
} from './tiktokMapping';

// Fixtures follow the documented examples (business-api.tiktok.com, v1.3).
const profileFixture = {
    display_name: 'La Flama Blanca',
    followers_count: 13,
    audience_ages: [{ age: '18-24', percentage: 0.5, }, { age: '25-34', percentage: 0.5, },],
    audience_genders: [{ gender: 'Female', percentage: 0.7554470336505679, }, { gender: 'Male', percentage: 0.24455296634943213, },],
    audience_countries: [{ country: 'US', percentage: 0.75, }, { country: 'GB', percentage: 0.25, },],
    audience_cities: [{ city_name: 'US Cincinnati', percentage: 0.597, },],
    metrics: [
        {
            date: '2026-11-01',
            video_views: 123,
            unique_video_views: 100,
            profile_views: 9,
            followers_count: 13,
            daily_total_followers: 2,
            daily_new_followers: 3,
            daily_lost_followers: 1,
            engaged_audience: 7,
            bio_link_clicks: 4,
            some_future_field: 99,
            audience_activity: [{ hour: '20', count: 1, }, { hour: '7', count: 4, }, { hour: 'x', count: 3, },],
        },
        { date: 'not-a-date', video_views: 1, },
    ],
};

const videoFixture = {
    item_id: '6990565363377392901',
    create_time: '1627617835',
    caption: 'little coco',
    thumbnail_url: 'http://p16-sign-va.tiktokcdn.com/x.image?x-expires=1',
    share_url: 'https://www.tiktok.com/@a/video/6990565363377392901',
    likes: 10,
    comments: 2,
    shares: 0,
    favorites: 3,
    video_views: 1231,
    reach: 154,
    video_duration: 20.0,
    total_time_watched: 695.942,
    average_time_watched: 4.118,
    full_video_watched_rate: 0.0237,
    new_followers: 4,
    impression_sources: [
        { percentage: 0.0113, impression_source: 'Follow', },
        { percentage: 0.8983, impression_source: 'For You', },
        { percentage: 0.0, impression_source: 'Hashtag', },
    ],
    audience_countries: [{ percentage: 0.7574, country: 'US', }, { percentage: 0.1775, country: 'GB', },],
    audience_cities: [{ city_name: 'US Los Angeles', percentage: 0.597, }, { city_name: 'US Other', percentage: 17.4921, },],
    audience_types: [{ percentage: 0.98, type: 'NEW_VIEWER', }, { percentage: 0.02, type: 'RETURN_VIEWER', },],
    video_view_retention: [{ second: '2', percentage: 0.5, }, { second: '0', percentage: 1, },],
    unknown_list: [{ a: 1, },],
};

describe('tiktok mapping helpers', () => {
    it('normalises rates and genders', () => {
        expect(fraction(0.0237,),).toBe(0.0237,);
        expect(fraction(25,),).toBe(0.25,);
        expect(fraction(null,),).toBeNull();
        expect([genderKey('Female',), genderKey('Male',), genderKey('Other',), genderKey(undefined,),],).toEqual(['F', 'M', 'U', 'U',],);
    },);
    it('detects a percent-scale distribution as a whole', () => {
        expect(distribution(videoFixture.audience_cities, 'city_name',),).toEqual([['US Los Angeles', 0.00597,], ['US Other', 0.174921,],],);
        expect(distribution('nope', 'country',),).toEqual([],);
    },);
    it('sorts timeline curves', () => {
        expect(timeline(videoFixture.video_view_retention,),).toEqual([[0, 1,], [2, 0.5,],],);
    },);
},);

describe('/business/get/ mapping', () => {
    it('daily metrics: known fields only, bad dates skipped', () => {
        const pts = businessDailyPoints(profileFixture.metrics,);
        expect(pts,).toContainEqual({ date: '2026-11-01', metric: 'views', value: 123, },);
        expect(pts,).toContainEqual({ date: '2026-11-01', metric: 'reach', value: 100, },);
        expect(pts,).toContainEqual({ date: '2026-11-01', metric: 'followersTotal', value: 13, },);
        expect(pts,).toContainEqual({ date: '2026-11-01', metric: 'followersNet', value: 2, },);
        expect(pts,).toContainEqual({ date: '2026-11-01', metric: 'lostFollowers', value: 1, },);
        expect(pts,).toContainEqual({ date: '2026-11-01', metric: 'accountsEngaged', value: 7, },);
        expect(pts,).toContainEqual({ date: '2026-11-01', metric: 'profileLinkTaps', value: 4, },);
        expect(pts.every((p,) => p.date === '2026-11-01'),).toBe(true,);
        expect(pts.some((p,) => p.metric === 'some_future_field'),).toBe(false,);
    },);
    it('hourly activity → onlineFollowers hour:<h>', () => {
        expect(activityPoints(profileFixture.metrics,),).toEqual([
            { date: '2026-11-01', metric: 'onlineFollowers', value: 1, dimension: 'hour:20', },
            { date: '2026-11-01', metric: 'onlineFollowers', value: 4, dimension: 'hour:7', },
        ],);
    },);
    it('follower demographics → audienceFollowers percent', () => {
        const pts = followerDemographicPoints(profileFixture, '2026-11-05',);
        expect(pts,).toContainEqual({ date: '2026-11-05', metric: 'audienceFollowers', value: 75.54, dimension: 'gender:F', },);
        expect(pts,).toContainEqual({ date: '2026-11-05', metric: 'audienceFollowers', value: 50, dimension: 'age:18-24', },);
        expect(pts,).toContainEqual({ date: '2026-11-05', metric: 'audienceFollowers', value: 25, dimension: 'country:GB', },);
        expect(pts,).toContainEqual({ date: '2026-11-05', metric: 'audienceFollowers', value: 59.7, dimension: 'city:US Cincinnati', },);
    },);
},);

describe('/business/video/list/ mapping', () => {
    it('maps every documented metric; tolerant of unknown fields', () => {
        const m = businessPostMetric(videoFixture,)!;
        expect(m,).toMatchObject({
            externalId: videoFixture.item_id, views: 1231, likes: 10, comments: 2, shares: 0, saves: 3, reach: 154,
            watchTimeS: 695.942, avgWatchS: 4.118, completionRate: 0.0237,
        },);
        expect(m.raw,).toMatchObject({
            newFollowers: 4,
            duration: 20,
            impressionSources: { Follow: 0.0113, 'For You': 0.8983, Hashtag: 0, },
            audienceTypes: { NEW_VIEWER: 0.98, RETURN_VIEWER: 0.02, },
            audienceCountries: { US: 0.7574, GB: 0.1775, },
            retention: [[0, 1,], [2, 0.5,],],
        },);
        expect(m.raw,).not.toHaveProperty('unknown_list',);
        expect(businessPostMetric({},),).toBeNull();
    },);
    it('a business video doubles as a Display-shaped video for the upsert', () => {
        expect(businessAsVideo(videoFixture,),).toMatchObject({
            id: videoFixture.item_id, create_time: 1627617835, video_description: 'little coco', view_count: 1231, duration: 20,
        },);
        expect(businessAsVideo({ item_id: '1', create_time: 1627617835000, },)?.create_time,).toBe(1627617835,);
    },);
    it('mergeMetric keeps earlier values when the later one is null and merges raw', () => {
        const merged = mergeMetric({ externalId: '1', views: 5, raw: { a: 1, }, }, { externalId: '1', views: null, reach: 3, raw: { b: 2, }, },);
        expect(merged,).toEqual({ externalId: '1', views: 5, reach: 3, raw: { a: 1, b: 2, }, },);
    },);
    it('view-weighted snapshot splits', () => {
        const pts = viewWeightedPoints([businessPostMetric(videoFixture,)!, { externalId: '2', views: 0, },], '2026-11-05',);
        expect(pts,).toContainEqual({ date: '2026-11-05', metric: 'trafficSources', dimension: 'source:For You', value: Math.round(0.8983 * 1231,), },);
        expect(pts,).toContainEqual({ date: '2026-11-05', metric: 'audienceReached', dimension: 'country:US', value: Math.round(0.7574 * 1231,), },);
        expect(pts,).toContainEqual({ date: '2026-11-05', metric: 'viewerTypes', dimension: 'viewer:NEW_VIEWER', value: Math.round(0.98 * 1231,), },);
        expect(pts.some((p,) => p.dimension === 'source:Hashtag'),).toBe(false,);
    },);
},);

describe('capability notes', () => {
    it('only when a Business token answered', () => {
        expect(capabilityNotes(null,),).toEqual([],);
        expect(capabilityNotes({ businessAccount: false, } as never,),).toEqual([],);
        const notes = capabilityNotes({
            businessAccount: true, accountInsights: true, newFollowers: false, demographics: true, onlineFollowers: true, mediaInsights: false,
        } as never,);
        expect(notes.join(),).toMatch(/new\/lost followers/,);
        expect(notes.join(),).toMatch(/video\.insights/,);
    },);
},);
