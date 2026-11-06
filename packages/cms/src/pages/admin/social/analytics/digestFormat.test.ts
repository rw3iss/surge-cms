import { describe, expect, it, } from 'vitest';
import { DEFAULT_SOCIAL_ANALYTICS_SETTINGS, } from '@sitesurge/types';
import {
    daysAgo, deltaText, metricLabel, deltaTone, fmtMetric, invalidRecipients, orderedMetricKeys, parseRecipients, periodLabel, scheduleDescription,
} from './digestFormat';

const m = (value: number | null, previous: number | null,) => ({
    value, previous,
    change: value !== null && previous !== null ? value - previous : null,
    changePct: value !== null && previous ? (value - previous) / previous : null,
});

describe('digest formatting', () => {
    it('describes the schedule', () => {
        const d = DEFAULT_SOCIAL_ANALYTICS_SETTINGS.digest;
        expect(scheduleDescription({ ...d, frequency: 'weekly', weekday: 1, hour: 9, timezone: 'America/New_York', },),).toBe('Every Monday at 9:00 (America/New_York)',);
        expect(scheduleDescription({ ...d, frequency: 'daily', hour: 7, timezone: '', },),).toBe('Every day at 7:00',);
        expect(scheduleDescription({ ...d, frequency: 'monthly', monthDay: 3, hour: 14, timezone: 'UTC', },),).toBe('On day 3 of every month at 14:00 (UTC)',);
    },);

    it('formats deltas with arrows, percent and amount', () => {
        expect(deltaText('views', m(1100, 1000,),),).toBe('▲ 10.0% (+100)',);
        expect(deltaText('views', m(900, 1000,),),).toBe('▼ 10.0% (−100)',);
        expect(deltaText('views', m(5, 5,),),).toBe('no change',);
        expect(deltaText('views', m(5, null,),),).toBe('',);
        expect(deltaText('engagementRate', m(0.05, 0.04,),),).toBe('▲ +1.0 pts',);
        expect(deltaTone(m(1, 2,),),).toBe('down',);
        expect(deltaText('views', m(10, 0,),),).toBe('▲ +10',);
    },);

    it('formats metric values by unit', () => {
        expect(fmtMetric('views', 12345,),).toBe('12,345',);
        expect(fmtMetric('engagementRate', 0.0532,),).toBe('5.3%',);
        expect(fmtMetric('avgViewDuration', 75,),).toBe('1:15',);
        expect(fmtMetric('followerChange', 12,),).toBe('+12',);
        expect(fmtMetric('views', null,),).toBe('—',);
    },);

    it('labels periods', () => {
        expect(periodLabel('2026-11-01', '2026-11-07',),).toBe('Nov 1 – Nov 7, 2026',);
        expect(periodLabel('2025-12-28', '2026-01-03',),).toBe('Dec 28, 2025 – Jan 3, 2026',);
        expect(periodLabel('2026-11-05', '2026-11-05',),).toBe('Nov 5, 2026',);
    },);

    it('parses and checks recipients', () => {
        expect(parseRecipients('a@b.co, A@B.co\nc@d.io; ',),).toEqual(['a@b.co', 'c@d.io',],);
        expect(invalidRecipients(['a@b.co', 'nope',],),).toEqual(['nope',],);
    },);

    it('orders metric keys and dates', () => {
        expect(orderedMetricKeys({ zeta: m(1, 1,), engagementRate: m(1, 1,), views: m(1, 1,), followers: m(1, null,), empty: m(null, null,), },),)
            .toEqual(['followers', 'views', 'engagementRate', 'zeta',],);
        expect(metricLabel('avgViewsPerPost',),).toBe('Views / post',);
        expect(fmtMetric('watchTimeMinutes', 150,),).toBe('3 h',);
        expect(daysAgo(7, new Date('2026-11-08T12:00:00Z',),),).toBe('2026-11-01',);
    },);
},);

describe('send result message', () => {
    it('says why nothing was sent, or how many failed', async () => {
        const { sendResultMessage, } = await import('./digestFormat');
        expect(sendResultMessage({ sent: 0, recipients: [], reason: 'no_recipients', },).kind,).toBe('info',);
        expect(sendResultMessage({ sent: 0, recipients: ['a@x.co',], reason: 'not_ready', },).text,).toMatch(/not ready/,);
        expect(sendResultMessage({ sent: 2, failed: 0, recipients: ['a@x.co', 'b@x.co',], reason: null, },),).toEqual({ kind: 'success', text: 'Emailed to 2 recipients.', },);
        expect(sendResultMessage({ sent: 1, failed: 1, recipients: ['a@x.co', 'b@x.co',], reason: null, },).kind,).toBe('error',);
        expect(sendResultMessage({ sent: 0, failed: 2, recipients: ['a@x.co', 'b@x.co',], reason: null, },).kind,).toBe('error',);
    },);
},);
