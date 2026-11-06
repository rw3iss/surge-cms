import { afterEach, describe, expect, it, vi, } from 'vitest';

vi.mock('../../../../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);

import { getCollector, } from '../registry';
import { isThreadsTokenError, } from './threads';
import {
    dayTotals,
    endTimeToDay,
    insightValue,
    isOwnThread,
    mediaMetric,
    parseThreadsTime,
    threadKind,
    viewsSeries,
} from './threadsMapping';

describe('threads mapping', () => {
    it('parses +0000 offsets', () => {
        expect(parseThreadsTime('2024-04-15T07:00:00+0000',),).toBe('2024-04-15T07:00:00.000Z',);
        expect(parseThreadsTime('nope',),).toBeNull();
        expect(parseThreadsTime(undefined,),).toBeNull();
    },);

    it('assigns a daily value to the day BEFORE its end_time', () => {
        expect(endTimeToDay('2024-04-15T07:00:00+0000',),).toBe('2024-04-14',);
    },);

    it('maps the views time series', () => {
        const pts = viewsSeries({
            name: 'views',
            period: 'day',
            values: [{ value: 10, end_time: '2024-04-15T07:00:00+0000', }, { value: 'x', end_time: '2024-04-16T07:00:00+0000', }, { value: 4, end_time: '2024-04-16T07:00:00+0000', },],
        },);
        expect(pts,).toEqual([{ date: '2024-04-14', metric: 'views', value: 10, }, { date: '2024-04-15', metric: 'views', value: 4, },],);
    },);

    it('reads total_value, link_total_values and lifetime values', () => {
        expect(insightValue({ name: 'likes', total_value: { value: 7, }, },),).toBe(7,);
        expect(insightValue({ name: 'clicks', link_total_values: [{ value: 2, link_url: 'a', }, { value: 3, link_url: 'b', },], },),).toBe(5,);
        expect(insightValue({ name: 'clicks', link_total_values: [], },),).toBeNull();
        expect(insightValue({ name: 'views', period: 'lifetime', values: [{ value: 42, },], },),).toBe(42,);
    },);

    it('dayTotals skips views/followers and stamps the day', () => {
        const pts = dayTotals('2024-05-01', [
            { name: 'likes', total_value: { value: 3, }, },
            { name: 'replies', total_value: { value: 0, }, },
            { name: 'clicks', link_total_values: [{ value: 9, },], },
            { name: 'views', values: [{ value: 1, end_time: '2024-05-02T07:00:00+0000', },], },
            { name: 'followers_count', total_value: { value: 100, }, },
        ],);
        expect(pts,).toEqual([
            { date: '2024-05-01', metric: 'likes', value: 3, },
            { date: '2024-05-01', metric: 'replies', value: 0, },
            { date: '2024-05-01', metric: 'clicks', value: 9, },
        ],);
    },);

    it('maps media insights: replies → comments, reposts + quotes → shares', () => {
        const m = mediaMetric('123', [
            { name: 'views', values: [{ value: 100, },], },
            { name: 'likes', values: [{ value: 8, },], },
            { name: 'replies', values: [{ value: 2, },], },
            { name: 'reposts', values: [{ value: 3, },], },
            { name: 'quotes', values: [{ value: 1, },], },
            { name: 'shares', values: [{ value: 5, },], },
        ],);
        expect(m,).toEqual({
            externalId: '123',
            views: 100,
            likes: 8,
            comments: 2,
            shares: 4,
            raw: { views: 100, likes: 8, replies: 2, reposts: 3, quotes: 1, shares: 5, },
        },);
    },);

    it('leaves missing media metrics null', () => {
        const m = mediaMetric('9', [],);
        expect(m.views,).toBeNull();
        expect(m.shares,).toBeNull();
        expect(m.comments,).toBeNull();
    },);

    it('classifies threads', () => {
        expect(isOwnThread({ id: '1', media_type: 'REPOST_FACADE', },),).toBe(false,);
        expect(isOwnThread({ id: '1', media_type: 'TEXT_POST', },),).toBe(true,);
        expect(threadKind({ id: '1', media_type: 'VIDEO', },),).toBe('video',);
        expect(threadKind({ id: '1', media_type: 'CAROUSEL_ALBUM', },),).toBe('carousel',);
        expect(threadKind({ id: '1', media_type: 'TEXT_POST', },),).toBe('text',);
    },);
},);

describe('threads collector status', () => {
    const c = () => getCollector('threads',)!;
    it('registers with a token-refresh cron', () => {
        expect(c().connection,).toBe('threads',);
        expect(c().crons?.map((j,) => j.name),).toEqual(['threads-token-refresh',],);
    },);
    it('is off until connected, ready with a token + user id', async () => {
        expect((await c().status({}, false,)).state,).toBe('off',);
        expect((await c().status({ accessToken: 't', }, true,)).state,).toBe('off',);
        expect((await c().status({ accessToken: 't', threadsUserId: '1', tokenExpiresAt: '2000-01-01T00:00:00Z', }, true,)).state,).toBe('off',);
        expect((await c().status({ accessToken: 't', threadsUserId: '1', }, true,)).state,).toBe('ready',);
        expect((await c().status({ accessToken: 't', threadsUserId: '1', oauthError: 'x', }, true,)).state,).toBe('partial',);
    },);
},);

describe('threads collector errors', () => {
    afterEach(() => vi.unstubAllGlobals());
    const ctx = () => ({ today: '2026-11-06', posts: [], credentials: { accessToken: 'tok-secret-123', threadsUserId: '1', }, settings: {}, warn: vi.fn(), });

    it('classifies token errors', () => {
        expect(isThreadsTokenError(Object.assign(new Error('x',), { code: 190, },),),).toBe(true,);
        expect(isThreadsTokenError(Object.assign(new Error('x',), { status: 400, code: 100, },),),).toBe(false,);
    },);

    it('an expired token stops the run with the fix, without echoing the token', async () => {
        const fn = vi.fn(async () => ({
            ok: false, status: 400, json: async () => ({ error: { code: 190, message: 'Session expired for tok-secret-123', }, }),
        }) as unknown as Response,);
        vi.stubGlobal('fetch', fn,);
        const err = await getCollector('threads',)!.collect(ctx(),).catch((e,) => e as Error,);
        expect(err,).toBeInstanceOf(Error,);
        expect((err as Error).message,).toContain('reconnect',);
        expect((err as Error).message,).not.toContain('tok-secret-123',);
        expect(fn,).toHaveBeenCalledTimes(1,);
    },);
},);
