import { describe, expect, it, } from 'vitest';
import {
    Budget,
    capabilityNotes,
    completionRate,
    dueToday,
    isRecent,
    readCost,
    syndicationMetric,
    tweetKind,
    tweetMetric,
    tweetThumbnail,
    X_READ_COST_USD,
} from './twitterMapping';

/** Trimmed real `tweet-result` payloads (fetched 2026-11-06). */
const SYND_TEXT = {
    __typename: 'Tweet',
    favorite_count: 325212,
    created_at: '2006-03-21T20:50:14.000Z',
    id_str: '20',
    text: 'just setting up my twttr',
    user: { id_str: '12', name: 'jack', screen_name: 'jack', },
    conversation_count: 19203,
};
const SYND_VIDEO = {
    __typename: 'Tweet',
    favorite_count: 1200,
    id_str: '1585341984679469056',
    conversation_count: 300,
    video: { aspectRatio: [16, 9,], durationMs: 9301, viewCount: 0, videoId: { type: 'tweet', id: '1585341984679469056', }, },
};

describe('x free tier (syndication)', () => {
    it('maps likes + replies and never invents reposts, impressions or followers', () => {
        const m = syndicationMetric(SYND_TEXT,)!;
        expect(m,).toMatchObject({ externalId: '20', likes: 325212, comments: 19203, views: null, },);
        expect(m.shares,).toBeUndefined();
        expect(m.impressions,).toBeUndefined();
        expect(m.raw?.tier,).toBe('free',);
    },);

    it('treats a 0 video viewCount as unknown, keeps duration', () => {
        const m = syndicationMetric(SYND_VIDEO,)!;
        expect(m.views,).toBeNull();
        expect(m.raw?.durationS,).toBeCloseTo(9.301,);
        expect(syndicationMetric({ ...SYND_VIDEO, video: { viewCount: 4000, }, },)!.views,).toBe(4000,);
    },);

    it('rejects a payload without an id', () => {
        expect(syndicationMetric({},),).toBeNull();
    },);
},);

describe('x paid mapping', () => {
    const media = new Map<string, Record<string, any>>([
        ['3_1', { media_key: '3_1', type: 'photo', url: 'https://pbs.twimg.com/media/a.jpg', },],
        ['7_2', {
            media_key: '7_2', type: 'video', preview_image_url: 'https://pbs.twimg.com/v.jpg', duration_ms: 30000,
            public_metrics: { view_count: 500, },
            non_public_metrics: { playback_0_count: 400, playback_25_count: 300, playback_50_count: 200, playback_75_count: 150, playback_100_count: 100, },
        },],
    ],);

    it('classifies post kinds', () => {
        expect(tweetKind({ referenced_tweets: [{ type: 'replied_to', },], },),).toBe('reply',);
        expect(tweetKind({ referenced_tweets: [{ type: 'quoted', },], },),).toBe('quote',);
        expect(tweetKind({ attachments: { media_keys: ['7_2',], }, }, media,),).toBe('video',);
        expect(tweetKind({ attachments: { media_keys: ['3_1',], }, }, media,),).toBe('photo',);
        expect(tweetKind({},),).toBe('post',);
    },);

    it('picks a thumbnail from photo url or video preview', () => {
        expect(tweetThumbnail({ attachments: { media_keys: ['7_2',], }, }, media,),).toBe('https://pbs.twimg.com/v.jpg',);
        expect(tweetThumbnail({}, media,),).toBeNull();
    },);

    it('derives completion from playback quartiles and keeps clicks + engagements', () => {
        const m = tweetMetric({
            id: '1',
            attachments: { media_keys: ['7_2',], },
            public_metrics: { impression_count: 1000, like_count: 5, reply_count: 1, retweet_count: 2, quote_count: 0, bookmark_count: 1, },
            non_public_metrics: { impression_count: 1000, url_link_clicks: 3, user_profile_clicks: 4, engagements: 20, },
        }, media,);
        expect(m.completionRate,).toBe(0.25,);
        expect(m.clicks,).toBe(7,);
        expect(m.raw,).toMatchObject({ linkClicks: 3, profileClicks: 4, engagements: 20, videoViews: 500, durationS: 30, tier: 'paid', },);
        expect(completionRate({ playback_0_count: 0, playback_100_count: 0, },),).toBeNull();
    },);
},);

describe('x spend + cadence', () => {
    it('budget affords reads under the cap and charges what was read', () => {
        const b = new Budget(1, 0.5,);
        expect(b.afford(200, X_READ_COST_USD.post,),).toBe(100,);
        expect(b.afford(1000, X_READ_COST_USD.owned,),).toBe(500,);
        b.charge(100, X_READ_COST_USD.post,);
        expect(b.leftUsd,).toBe(0,);
        expect(b.afford(1, X_READ_COST_USD.user,),).toBe(0,);
        expect(readCost(1, 0, 100,),).toBe(0.11,);
    },);

    it('reads posts < 30 days daily, older ones on Mondays only', () => {
        const posts = [
            { publishedAt: '2026-11-01T10:00:00Z', },
            { publishedAt: '2026-09-01T10:00:00Z', },
            { publishedAt: null, },
        ];
        expect(dueToday(posts, '2026-11-05',),).toHaveLength(1,); // Thursday
        expect(dueToday(posts, '2026-11-09',),).toHaveLength(3,); // Monday
        expect(isRecent('1970-01-01T00:00:00Z', '2026-11-05',),).toBe(false,);
    },);

    it('names the paid families that failed, nothing when never tried', () => {
        expect(capabilityNotes(null,),).toEqual([],);
        expect(capabilityNotes({ freeHydration: true, },),).toEqual([],);
        expect(capabilityNotes({ paidReads: false, },)[0],).toMatch(/paid API reads/,);
        expect(capabilityNotes({ paidReads: true, accountInsights: true, discovery: true, mediaInsights: false, },),).toEqual([
            'private metrics (impressions, link/profile clicks, video quartiles)',
        ],);
    },);
},);
