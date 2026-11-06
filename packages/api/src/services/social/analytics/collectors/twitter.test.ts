import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../../../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);

import { getCollector, } from '../registry';
import {
    accountFrom,
    analyticsSettings,
    currentSpend,
    DEFAULT_MONTHLY_CAP_USD,
    friendlyXReadError,
    paidBlocker,
    planReads,
    readCost,
    tweetMetric,
    userCreds,
    X_READ_COST_USD,
} from './twitter';

describe('twitter analytics collector', () => {
    it('registers itself', () => {
        expect(getCollector('twitter',)?.connection,).toBe('twitter',);
    },);

    it('is off unless explicitly enabled; cap defaults when unset or invalid', () => {
        expect(analyticsSettings({},),).toEqual({ enabled: false, monthlyCapUsd: DEFAULT_MONTHLY_CAP_USD, ownedApp: false, },);
        expect(analyticsSettings({ analytics: { enabled: 'yes', }, },).enabled,).toBe(false,);
        expect(analyticsSettings({ analytics: { enabled: true, monthlyCapUsd: 3.5, }, },),).toEqual({ enabled: true, monthlyCapUsd: 3.5, ownedApp: false, },);
        expect(analyticsSettings({ analytics: { enabled: true, monthlyCapUsd: -1, }, },).monthlyCapUsd,).toBe(DEFAULT_MONTHLY_CAP_USD,);
        expect(analyticsSettings({ analytics: { enabled: true, monthlyCapUsd: '', }, },).monthlyCapUsd,).toBe(DEFAULT_MONTHLY_CAP_USD,);
        expect(analyticsSettings({ analytics: { enabled: true, monthlyCapUsd: 0, }, },).monthlyCapUsd,).toBe(0,);
    },);

    it('resets the month-to-date spend in a new month', () => {
        expect(currentSpend({ analyticsSpend: { month: '2026-11', spentUsd: 1.25, }, }, '2026-11-05',),).toEqual({ month: '2026-11', spentUsd: 1.25, },);
        expect(currentSpend({ analyticsSpend: { month: '2026-10', spentUsd: 9, }, }, '2026-11-01',),).toEqual({ month: '2026-11', spentUsd: 0, },);
        expect(currentSpend({}, '2026-11-01',).spentUsd,).toBe(0,);
    },);

    it('plans reads under the cap', () => {
        // $1 cap, nothing spent: account ($0.01) + 198 posts ($0.99).
        expect(planReads(0, 1, 500,),).toEqual({ account: true, posts: 198, },);
        expect(planReads(0, 1, 20,),).toEqual({ account: true, posts: 20, },);
        // Only the account read fits.
        expect(planReads(0.99, 1, 50,),).toEqual({ account: true, posts: 0, },);
        // Nothing fits.
        expect(planReads(0.995, 1, 50,),).toEqual({ account: false, posts: 0, },);
        expect(planReads(0, 0, 50,).account,).toBe(false,);
        // Float drift: exactly enough for the account + 2 posts.
        expect(planReads(0, X_READ_COST_USD.user + 2 * X_READ_COST_USD.post, 10,),).toEqual({ account: true, posts: 2, },);
    },);

    it('prices reads', () => {
        expect(readCost(1, 150,),).toBe(0.76,);
        expect(readCost(0, 0,),).toBe(0,);
    },);

    it('needs all four user-context credentials', () => {
        expect(userCreds({ apiKey: 'a', apiSecret: 'b', accessToken: 'c', },),).toBeNull();
        expect(userCreds({ apiKey: 'a', apiSecret: 'b', accessToken: 'c', accessSecret: 'd', },)?.accessSecret,).toBe('d',);
    },);

    it('maps /users/me to an account snapshot', () => {
        const a = accountFrom({ id: '1', username: 'surge', public_metrics: { followers_count: 10, following_count: 2, tweet_count: 300, listed_count: 4, }, },);
        expect(a,).toMatchObject({ followers: 10, following: 2, postsCount: 300, },);
        expect(a?.raw?.listed_count,).toBe(4,);
        expect(accountFrom(undefined,),).toBeNull();
    },);

    it('maps a recent tweet with private metrics and video quartiles', () => {
        const media = new Map([['3_9', {
            media_key: '3_9',
            type: 'video',
            public_metrics: { view_count: 50, },
            non_public_metrics: { playback_0_count: 40, playback_25_count: 30, playback_50_count: 20, playback_75_count: 10, playback_100_count: 5, },
        },],],);
        const m = tweetMetric({
            id: '123',
            attachments: { media_keys: ['3_9',], },
            public_metrics: { impression_count: 900, like_count: 20, reply_count: 3, retweet_count: 4, quote_count: 1, bookmark_count: 2, },
            non_public_metrics: { impression_count: 900, url_link_clicks: 7, user_profile_clicks: 5, },
            organic_metrics: { impression_count: 880, like_count: 20, },
        }, media,);
        expect(m,).toMatchObject({ externalId: '123', views: 900, impressions: 900, likes: 20, comments: 3, shares: 5, saves: 2, clicks: 12, },);
        expect((m.raw?.media as any[])[0].non_public_metrics.playback_100_count,).toBe(5,);
        expect(m.raw?.organic_metrics,).toBeDefined();
    },);

    it('maps an older tweet (public metrics only) without inventing clicks', () => {
        const m = tweetMetric({ id: '9', public_metrics: { impression_count: 10, like_count: 1, reply_count: 0, retweet_count: 0, quote_count: 0, bookmark_count: 0, }, },);
        expect(m.clicks,).toBeNull();
        expect(m.shares,).toBe(0,);
        expect(m.raw?.non_public_metrics,).toBeUndefined();
    },);

    it('explains paid / auth / rate-limit failures', () => {
        expect(friendlyXReadError(402, '',),).toMatch(/credits/,);
        expect(friendlyXReadError(400, '{"title":"CreditsDepleted","type":"credits-depleted"}',),).toMatch(/402/,);
        expect(friendlyXReadError(401, '',),).toMatch(/credentials/,);
        expect(friendlyXReadError(403, '',),).toMatch(/paid X API plan/,);
        expect(friendlyXReadError(429, '',),).toMatch(/rate limit/,);
    },);
},);

describe('twitter paid gate', () => {
    const creds = { apiKey: 'a', apiSecret: 'b', accessToken: 'c', accessSecret: 'd', };
    it('is "off" until analytics is enabled, then names the missing piece', () => {
        expect(paidBlocker({}, creds, true,),).toBe('off',);
        expect(paidBlocker({ analytics: { enabled: true, }, }, creds, true,),).toMatch(/Feed mode API/,);
        expect(paidBlocker({ analytics: { enabled: true, }, twitterMode: 'api', }, {}, true,),).toMatch(/Access Token/,);
        expect(paidBlocker({ analytics: { enabled: true, }, twitterMode: 'api', }, creds, false,),).toMatch(/not enabled/,);
        expect(paidBlocker({ analytics: { enabled: true, }, twitterMode: 'api', }, creds, true,),).toBeNull();
    },);
},);
