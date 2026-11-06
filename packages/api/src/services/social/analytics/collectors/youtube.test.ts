import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../../../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);

import { getCollector, } from '../registry';
import { hasAnalyticsScope, latestPoints, parseCsv, reachPoints, reportRows, } from './youtube';

describe('youtube analytics collector', () => {
    it('registers itself', () => {
        expect(getCollector('youtube',)?.label,).toBe('YouTube',);
    },);

    it('detects the analytics scope among granted scopes', () => {
        expect(hasAnalyticsScope({ grantedScopes: 'https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics.readonly', },),).toBe(true,);
        expect(hasAnalyticsScope({ grantedScopes: 'https://www.googleapis.com/auth/youtube.readonly', },),).toBe(false,);
        expect(hasAnalyticsScope({},),).toBe(false,);
    },);

    it('maps an Analytics API report to rows', () => {
        const rows = reportRows({ columnHeaders: [{ name: 'day', }, { name: 'views', },], rows: [['2026-11-01', 12,], ['2026-11-02', 30,],], },);
        expect(rows,).toEqual([{ day: '2026-11-01', views: 12, }, { day: '2026-11-02', views: 30, },],);
    },);

    it('parses CSV with quotes and CRLF', () => {
        const rows = parseCsv('date,video_id,title\r\n20261101,abc,"Hello, ""world"""\r\n',);
        expect(rows,).toEqual([{ date: '20261101', video_id: 'abc', title: 'Hello, "world"', },],);
    },);

    it('sums reach rows per video/day and per channel day', () => {
        const pts = reachPoints([
            { date: '20261101', video_id: 'a', video_thumbnail_impressions: '100', video_thumbnail_impressions_ctr: '0.05', },
            { date: '20261101', video_id: 'a', video_thumbnail_impressions: '50', video_thumbnail_impressions_ctr: '0.04', },
            { date: '20261101', video_id: 'b', video_thumbnail_impressions: '10', video_thumbnail_impressions_ctr: '', },
        ],);
        const find = (metric: string, dimension = '',) => pts.find((p,) => p.metric === metric && (p.dimension ?? '') === dimension)?.value;
        expect(find('impressions', 'video:a',),).toBe(150,);
        expect(find('impressions', 'video:b',),).toBe(10,);
        expect(find('impressions',),).toBe(160,);
        expect(find('impressionsCtr', 'video:a',),).toBeCloseTo((100 * 0.05 + 50 * 0.04) / 150, 6,); // impression-weighted
        expect(pts.every((p,) => p.date === '2026-11-01'),).toBe(true,);
    },);

    it('keeps one value per day/metric/dimension across report files (later file wins, never summed)', () => {
        const a = reachPoints([{ date: '20261101', video_id: 'a', video_thumbnail_impressions: '100', video_thumbnail_impressions_ctr: '0.05', },],);
        const b = reachPoints([{ date: '20261101', video_id: 'a', video_thumbnail_impressions: '120', video_thumbnail_impressions_ctr: '0.06', },],);
        const pts = latestPoints([...a, ...b,],);
        expect(pts.filter((p,) => p.metric === 'impressions' && !p.dimension),).toEqual([{ date: '2026-11-01', metric: 'impressions', value: 120, },],);
        expect(pts,).toHaveLength(3,);
    },);

    it('status: off without a connection, partial in key mode, ready with the scope', async () => {
        const c = getCollector('youtube',)!;
        expect((await c.status({}, false,)).state,).toBe('off',);
        expect((await c.status({ apiKey: 'k', channelId: 'UCx', }, true,)).state,).toBe('partial',);
        const ready = await c.status({
            refreshToken: 'r', channelId: 'UCx',
            grantedScopes: 'https://www.googleapis.com/auth/yt-analytics.readonly',
        }, true,);
        expect(ready.state,).toBe('ready',);
    },);
},);
