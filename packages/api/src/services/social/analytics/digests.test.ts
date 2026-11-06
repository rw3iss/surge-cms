import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);

import { DEFAULT_SOCIAL_ANALYTICS_SETTINGS, type SocialAnalyticsDigest, } from '@sitesurge/types';
import { cleanInsights, dueSlot, localParts, metric, periodFor, previousPeriod, totalsOf, } from './digests';
import { changeBadge, fmtValue, periodLabel, renderDigestEmail, } from './digestEmail';

const digestCfg = (over: Partial<typeof DEFAULT_SOCIAL_ANALYTICS_SETTINGS.digest>,) => ({ ...DEFAULT_SOCIAL_ANALYTICS_SETTINGS.digest, enabled: true, ...over, });

describe('digest dates', () => {
    it('reads wall-clock parts in the time zone', () => {
        // 2026-11-09 03:30 UTC = Sunday 22:30 the day before in New York.
        expect(localParts(new Date('2026-11-09T03:30:00Z',), 'America/New_York',),).toEqual({ date: '2026-11-08', hour: 22, weekday: 0, day: 8, },);
    },);

    it('covers yesterday back one day / week / month, and the same length before', () => {
        expect(periodFor('daily', '2026-11-09',),).toEqual({ from: '2026-11-08', to: '2026-11-08', },);
        expect(periodFor('weekly', '2026-11-09',),).toEqual({ from: '2026-11-02', to: '2026-11-08', },);
        expect(periodFor('monthly', '2026-11-01',),).toEqual({ from: '2026-10-01', to: '2026-10-31', },);
        expect(previousPeriod({ from: '2026-11-02', to: '2026-11-08', },),).toEqual({ from: '2026-10-26', to: '2026-11-01', },);
    },);

    it('is due from the hour on the matching day, once per local date', () => {
        const mon9 = new Date('2026-11-09T14:05:00Z',); // Mon 09:05 New York
        expect(dueSlot(digestCfg({ frequency: 'weekly', weekday: 1, hour: 9, },), mon9,),).toEqual({ key: 'weekly:2026-11-09', localDate: '2026-11-09', },);
        expect(dueSlot(digestCfg({ frequency: 'weekly', weekday: 2, hour: 9, },), mon9,),).toBeNull();
        expect(dueSlot(digestCfg({ frequency: 'daily', hour: 10, },), mon9,),).toBeNull();
        expect(dueSlot(digestCfg({ frequency: 'monthly', monthDay: 9, hour: 9, },), mon9,)?.key,).toBe('monthly:2026-11-09',);
        expect(dueSlot({ ...digestCfg({},), enabled: false, }, mon9,),).toBeNull();
    },);
},);

describe('digest numbers', () => {
    it('computes change and change %', () => {
        expect(metric(120, 100,),).toEqual({ value: 120, previous: 100, change: 20, changePct: 0.2, },);
        expect(metric(5, 0,).changePct,).toBeNull();
        expect(metric(null, 3,).change,).toBeNull();
    },);

    it('totals only the numbers platforms gave, with an engagement rate', () => {
        const t = totalsOf([
            { views: 100, likes: 10, comments: 5, shares: 5, followers: 50, } as never,
            { views: null, likes: 2, comments: null, shares: null, followers: 10, } as never,
        ],);
        expect(t.views,).toBe(100,);
        expect(t.likes,).toBe(12,);
        expect(t.engagementRate,).toBeCloseTo(0.22,);
    },);

    it('formats values and change badges', () => {
        expect(fmtValue('engagementRate', 0.0531,),).toBe('5.3%',);
        expect(fmtValue('views', 203222,),).toBe('203k',);
        expect(fmtValue('avgViewDuration', 95,),).toBe('1:35',);
        expect(changeBadge(metric(110, 100,),).text,).toBe('▲ 10.0%',);
        expect(changeBadge(metric(50, 100,),).text,).toBe('▼ 50.0%',);
        expect(periodLabel('2026-10-30', '2026-11-05',),).toBe('Oct 30 – Nov 5, 2026',);
    },);

    it('keeps only well-formed AI insights', () => {
        expect(cleanInsights({ highlights: ['x',], },),).toBeNull();
        const ok = cleanInsights({ headline: 'Up', highlights: ['a', '',], topPosts: [{ id: 'p1', why: 'hook', }, { id: '', why: 'x', },], suggestions: 'no', },);
        expect(ok,).toEqual({ headline: 'Up', highlights: ['a',], platforms: [], topPosts: [{ id: 'p1', why: 'hook', },], suggestions: [], },);
    },);
},);

describe('digest email', () => {
    const digest: SocialAnalyticsDigest = {
        id: 'd1', frequency: 'weekly', from: '2026-11-02', to: '2026-11-08', status: 'ready', headline: 'Views <up>', trigger: 'schedule',
        createdAt: '2026-11-09T14:20:00Z', emailedAt: null, emailCount: 0, error: null,
        data: {
            v: 1, from: '2026-11-02', to: '2026-11-08', previousFrom: '2026-10-26', previousTo: '2026-11-01',
            sections: ['totals', 'platforms', 'trends', 'topPosts', 'ai',],
            totals: { views: metric(1200, 1000,), followers: metric(500, 490,), },
            platforms: [{ platform: 'youtube', label: 'YouTube', since: '2026-11-01', status: 'ready', statusMessage: null,
                metrics: { views: metric(1200, 1000,), }, series: { views: [{ date: '2026-11-02', value: 100, }, { date: '2026-11-03', value: 300, },], }, },],
            topPosts: [{ id: 'p1', platform: 'youtube', externalId: 'x', title: 'Big <video>', url: 'https://youtu.be/x', thumbnailUrl: null, kind: 'video',
                publishedAt: '2026-11-03T00:00:00Z', asOf: '2026-11-08', views: 900, likes: 50, comments: 5, shares: null, saves: null, watchTimeS: null,
                avgWatchS: null, completionRate: null, reach: null, impressions: null, clicks: null, viewsInPeriod: 800, viewsDay7: null, engagementRate: 0.06, },],
            definitionChanges: [],
            ai: { status: 'ok', provider: 'broker', pool: 'analytics', error: null,
                insights: { headline: 'Views <up>', highlights: ['More views',], platforms: [{ platform: 'YouTube', summary: 'Good week', },], topPosts: [{ id: 'p1', why: 'Timely', },], suggestions: ['Post more',], }, },
        },
    };
    const layout = { siteName: 'Surge', siteUrl: 'https://surge.test', logoUrl: null, address: null, } as never;

    it('renders every included section, escaped, with the dashboard link', () => {
        const html = renderDigestEmail(digest, layout, { format: 'full', viewUrl: 'https://surge.test/admin/social/analytics/digests/d1', settingsUrl: 'https://surge.test/s', },);
        expect(html,).toContain('Weekly social analytics · Nov 2 – Nov 8, 2026',);
        expect(html,).toContain('Views &lt;up&gt;',);
        expect(html,).not.toContain('Big <video>',);
        expect(html,).toContain('Big &lt;video&gt;',);
        expect(html,).toContain('Timely',);
        expect(html,).toContain('Post more',);
        expect(html,).toContain('Good week',);
        expect(html,).toContain('/admin/social/analytics/digests/d1',);
    },);

    it('summary format leaves out the platform tables and next steps', () => {
        const html = renderDigestEmail(digest, layout, { format: 'summary', viewUrl: 'v', settingsUrl: 's', },);
        expect(html,).not.toContain('By platform',);
        expect(html,).not.toContain('Post more',);
        expect(html,).toContain('See the full digest',);
    },);
},);
