import { describe, expect, it, vi, } from 'vitest';

vi.mock('../../../../db', () => ({ query: vi.fn(), transaction: vi.fn(), }),);

import { sanitizeCredentials, withoutMaskedValues, } from '../../../connections';
import {
    canonicalChannelUrl,
    channelCandidates,
    mapLiveApi,
    parseChannelInput,
    parseVideosPage,
    redactLiveApiUrl,
    rumbleEmbedId,
    rumbleFetchedPost,
    rumbleKind,
    validateLiveApiUrl,
} from '../../rumbleParse';
import { getCollector, } from '../registry';
import { liveSamplePoints, matchLivestream, newPerDay, rumblePostMetric, } from './rumbleMapping';
import { status, } from './rumble';

const ITEM = {
    object_type: 'video',
    videos: [{ url: 'https://hugh.cdn.rumble.cloud/video/x.mp4', type: 'mp4', res: 1080, },],
    url: 'https://rumble.com/v7hynwq-weekend-report.html',
    relative_url: '/v7hynwq-weekend-report.html',
    by: { type: 'channel', url: 'https://rumble.com/c/bongino', name: 'The Dan Bongino Show', title: 'The Dan Bongino Show', followers: 3676428, subscribers: 0, verified_badge: true, id: '_c276782', thumb: 'https://hugh.cdn.rumble.cloud/c.jpeg', },
    rumble_votes: { score: 553, num_votes_up: 566, num_votes_down: 13, },
    log: { view: '/l/view...x', },
    comments: { count: 81, },
    video_stats: { rumble_plays: 4317, youtube_views: 0, revenue: 0, revenue_units: 'dollars', },
    video_width: 1920,
    video_height: 1080,
    id: 449778068,
    eid: 'F2BCfIQv9Og',
    title: 'Weekend Report',
    duration: 2668,
    thumb: 'https://hugh.cdn.rumble.cloud/video/thumb.jpg',
    upload_date: '2026-11-07T12:00:00+00:00',
    is_short: false,
    live: false,
    live_datetime: null,
    live_streamed_on: null,
    livestream_status: null,
    watching_now: null,
    views: 58777,
    visibility: 'public',
    is_monetized: true,
    permalink_id: 'v7hynwq',
    reposts_count: 1,
};

function page(items: unknown[], extra = '',): string {
    return `<html><body><div><rum-videos-grid>
    <script type="application/json">
        ${JSON.stringify({ items, analytics: { url: 'x', }, },)}
    </script></rum-videos-grid>
    <a href="/c/bongino/videos?page=2">2</a><a href="/c/bongino/videos?page=30">30</a>${extra}</div></body></html>`;
}

describe('rumble channel page parser', () => {
    it('reads the videos grid JSON and the last page', () => {
        const p = parseVideosPage(page([ITEM, { object_type: 'ad', }, { object_type: 'video', },],),);
        expect(p.problem,).toBeNull();
        expect(p.items.map((i,) => i.id),).toEqual([449778068,],);
        expect(p.lastPage,).toBe(30,);
    },);

    it('reports a format change instead of throwing', () => {
        expect(parseVideosPage('<html>nothing</html>',).problem,).toMatch(/no videos grid/,);
        expect(parseVideosPage('<rum-videos-grid><script type="application/json">{bad</script>',).problem,).toMatch(/could not be read/,);
        expect(parseVideosPage('<rum-videos-grid><script type="application/json">{"x":1}</script>',).problem,).toMatch(/no items/,);
        expect(parseVideosPage(undefined as unknown as string,).items,).toEqual([],);
    },);

    it('maps an item to a feed post (trimmed raw, stable thumbnail, kind)', () => {
        const post = rumbleFetchedPost(ITEM,);
        expect(post.id,).toBe('449778068',);
        expect(post.content,).toBe('Weekend Report',);
        expect(post.mediaUrl,).toBe('https://rumble.com/v7hynwq-weekend-report.html',);
        expect(post.thumbnailUrl,).toBe('https://hugh.cdn.rumble.cloud/video/thumb.jpg',);
        expect(post.authorName,).toBe('The Dan Bongino Show',);
        expect([post.likes, post.comments, post.shares,],).toEqual([566, 81, 1,],);
        expect(post.publishedAt.toISOString(),).toBe('2026-11-07T12:00:00.000Z',);
        expect(post.rawData.mediaKind,).toBe('video',);
        expect(post.rawData.durationSeconds,).toBe(2668,);
        expect(post.rawData.embedId,).toBe('v7fsaz8',);
        expect(post.rawData,).not.toHaveProperty('videos',);
        expect(post.rawData,).not.toHaveProperty('log',);
    },);

    it('classifies shorts and live streams', () => {
        expect(rumbleKind({ is_short: true, },),).toBe('short',);
        expect(rumbleKind({ live: true, },),).toBe('live',);
        expect(rumbleKind({ livestream_status: 2, },),).toBe('live',);
        expect(rumbleKind({},),).toBe('video',);
        expect(rumbleEmbedId(449778068,),).toBe('v7fsaz8',);
        expect(rumbleEmbedId('x',),).toBeNull();
    },);

    it('maps per-video metrics (votes up = likes, reposts = shares)', () => {
        const m = rumblePostMetric(ITEM,);
        expect(m,).toMatchObject({ externalId: '449778068', views: 58777, likes: 566, comments: 81, shares: 1, },);
        expect(m.raw,).toMatchObject({ dislikes: 13, score: 553, durationS: 2668, rumblePlays: 4317, },);
        expect(m.raw,).not.toHaveProperty('revenue',);
    },);
},);

describe('rumble channel input', () => {
    it('accepts URLs, @name and name', () => {
        expect(parseChannelInput('https://rumble.com/c/Bongino/videos?page=2',),).toEqual({ kind: 'c', name: 'Bongino', },);
        expect(parseChannelInput('rumble.com/user/someone',),).toEqual({ kind: 'user', name: 'someone', },);
        expect(parseChannelInput('@bongino',),).toEqual({ kind: 'any', name: 'bongino', },);
        expect(parseChannelInput('bongino',),).toEqual({ kind: 'any', name: 'bongino', },);
        expect(channelCandidates({ kind: 'any', name: 'bongino', },),).toEqual(['https://rumble.com/c/bongino', 'https://rumble.com/user/bongino',],);
    },);

    it('refuses other hosts, video pages and odd names', () => {
        expect(parseChannelInput('https://evil.com/c/bongino',),).toBeNull();
        expect(parseChannelInput('https://rumble.com.evil.com/c/x',),).toBeNull();
        expect(parseChannelInput('https://rumble.com/v7hynwq-title.html',),).toBeNull();
        expect(parseChannelInput('../etc',),).toBeNull();
        expect(parseChannelInput('',),).toBeNull();
    },);

    it('canonicalizes a channel page URL', () => {
        expect(canonicalChannelUrl('https://rumble.com/c/bongino/videos?page=3',),).toBe('https://rumble.com/c/bongino',);
        expect(canonicalChannelUrl('https://www.rumble.com/user/x',),).toBe('https://rumble.com/user/x',);
        expect(canonicalChannelUrl('https://example.com/c/x',),).toBeNull();
    },);
},);

describe('rumble Live Stream API', () => {
    const URL_OK = 'https://rumble.com/-livestream-api/get-data?key=SECRETKEY123456';

    it('only accepts https rumble.com /-livestream-api/ URLs (SSRF guard)', () => {
        expect(validateLiveApiUrl(URL_OK,),).toEqual({ ok: true, url: URL_OK, },);
        expect(validateLiveApiUrl('http://rumble.com/-livestream-api/get-data?key=a',).ok,).toBe(false,);
        expect(validateLiveApiUrl('https://evil.com/-livestream-api/get-data',).ok,).toBe(false,);
        expect(validateLiveApiUrl('https://rumble.com.evil.com/-livestream-api/x',).ok,).toBe(false,);
        expect(validateLiveApiUrl('https://rumble.com:8443/-livestream-api/x',).ok,).toBe(false,);
        expect(validateLiveApiUrl('https://user:pw@rumble.com/-livestream-api/x',).ok,).toBe(false,);
        expect(validateLiveApiUrl('https://rumble.com/api/x',).ok,).toBe(false,);
        expect(validateLiveApiUrl('not a url',).ok,).toBe(false,);
    },);

    it('redacts the URL and its key from messages', () => {
        const msg = `fetch ${URL_OK} failed; key SECRETKEY123456; other https://rumble.com/-livestream-api/zzz?key=b`;
        const out = redactLiveApiUrl(msg, URL_OK,);
        expect(out,).not.toContain('SECRETKEY123456',);
        expect(out,).not.toContain('-livestream-api',);
    },);

    it('maps the answer and drops the stream key', () => {
        const data = mapLiveApi({
            now: 1730000000,
            type: 'channel',
            user_id: 7,
            channel_id: 9,
            username: 'me',
            channel_name: 'My Channel',
            followers: { num_followers: 120, num_followers_total: 150, latest_follower: { username: 'a', followed_on: '2026-11-06T10:00:00+00:00', }, recent_followers: [{ username: 'a', followed_on: '2026-11-06T10:00:00+00:00', },], },
            subscribers: { num_subscribers: 4, recent_subscribers: [{ username: 's', amount_dollars: 5, subscribed_on: '2026-11-05T10:00:00+00:00', },], },
            gifted_subs: { num_gifted_subs: 2, recent_gifted_subs: [{}, {},], },
            livestreams: [{
                id: '6abcd',
                title: 'Live now',
                created_on: '2026-11-07T18:00:00+00:00',
                is_live: true,
                stream_key: 'SUPER-SECRET-STREAM-KEY',
                categories: { primary: { slug: 'news', title: 'News', }, secondary: null, },
                likes: 10,
                dislikes: 1,
                watching_now: 300,
                chat: { recent_messages: [{ username: 'u', text: 'hi', created_on: '2026-11-07T18:05:00+00:00', },], recent_rants: [{ username: 'r', text: 'go', amount_cents: 500, created_on: '2026-11-07T18:06:00+00:00', },], },
            },],
        },);
        expect(data,).not.toBeNull();
        expect(JSON.stringify(data,),).not.toContain('SUPER-SECRET-STREAM-KEY',);
        expect(data!.followers,).toBe(120,);
        expect(data!.followersTotal,).toBe(150,);
        expect(data!.subscribers,).toBe(4,);
        expect(data!.recentSubscribers[0]!.amountCents,).toBe(500,);
        expect(data!.giftedSubs,).toBe(2,);
        expect(data!.livestreams[0],).toMatchObject({ id: '6abcd', isLive: true, watchingNow: 300, categories: { primary: 'News', secondary: null, }, },);
        expect(mapLiveApi([],),).toBeNull();
        expect(mapLiveApi({ hello: 1, },),).toBeNull();
    },);

    it('counts new followers on complete days only', () => {
        const recent = (dates: string[],) => dates.map((on,) => ({ username: 'x', on, }));
        expect(newPerDay(recent(['2026-11-06T10:00:00Z', '2026-11-06T11:00:00Z', '2026-11-05T09:00:00Z',],), 'newFollowers', '2026-11-07',),)
            .toEqual([{ date: '2026-11-05', metric: 'newFollowers', value: 1, }, { date: '2026-11-06', metric: 'newFollowers', value: 2, },],);
        // A full list (50) may cut its oldest day off — that day is left out.
        const full = recent([...Array(49,).fill('2026-11-06T10:00:00Z',), '2026-11-05T10:00:00Z',],);
        expect(newPerDay(full, 'newFollowers', '2026-11-07',),).toEqual([{ date: '2026-11-06', metric: 'newFollowers', value: 49, },],);
    },);

    it('samples a live stream: new chat / rants only, peak + likes', () => {
        const stream = {
            id: '6abcd', title: 'Live', createdOn: null, isLive: true, categories: { primary: null, secondary: null, },
            likes: 10, dislikes: 2, watchingNow: 300,
            recentMessages: [{ username: 'a', text: '1', createdOn: '2026-11-07T18:00:00Z', }, { username: 'b', text: '2', createdOn: '2026-11-07T18:05:00Z', },],
            recentRants: [{ username: 'r', text: 'x', createdOn: '2026-11-07T18:04:00Z', amountCents: 500, },],
        };
        const first = liveSamplePoints(stream, null, '449778068', '2026-11-07', '2026-11-07T18:06:00Z',);
        const val = (pts: typeof first.points, m: string,) => pts.find((p,) => p.metric === m && p.dimension === '')?.value;
        expect(val(first.points, 'liveChatMessages',),).toBe(2,);
        expect(val(first.points, 'liveRantsCents',),).toBe(500,);
        expect(val(first.points, 'liveWatchingPeak',),).toBe(300,);
        expect(first.points.some((p,) => p.dimension === 'live:449778068'),).toBe(true,);
        const again = liveSamplePoints(
            { ...stream, recentMessages: [...stream.recentMessages, { username: 'c', text: '3', createdOn: '2026-11-07T18:10:00Z', },], },
            first.state,
            '449778068',
            '2026-11-07',
            '2026-11-07T18:16:00Z',
        );
        expect(val(again.points, 'liveChatMessages',),).toBe(1,);
        expect(val(again.points, 'liveRants',),).toBe(0,);
        expect(again.points.find((p,) => p.metric === 'liveWatchingPeak')?.mode,).toBe('max',);
    },);

    it('matches a livestream to its video by base-36 id, else title + time', () => {
        const posts = [
            { externalId: '449778068', title: 'Other', publishedAt: '2026-11-07T12:00:00Z', },
            { externalId: '5', title: 'My Live Show', publishedAt: '2026-11-07T18:00:00Z', },
        ];
        expect(matchLivestream({ id: 'v7fsaz8', title: null, createdOn: null, }, posts,),).toBe('449778068',);
        expect(matchLivestream({ id: 'zzzz', title: 'my live show ', createdOn: '2026-11-07T17:00:00Z', }, posts,),).toBe('5',);
        expect(matchLivestream({ id: 'zzzz', title: 'my live show', createdOn: '2026-11-01T17:00:00Z', }, posts,),).toBeNull();
    },);
},);

describe('rumble connection + collector', () => {
    it('masks the Live Stream API URL and ignores an echoed mask', () => {
        const masked = sanitizeCredentials({ channelUrl: 'https://rumble.com/c/x', liveApiUrl: 'https://rumble.com/-livestream-api/get-data?key=abc', },);
        expect(masked.liveApiUrl,).toBe('••••••••',);
        expect(masked.hasLiveApiUrl,).toBe(true,);
        expect(masked.channelUrl,).toBe('https://rumble.com/c/x',);
        expect(withoutMaskedValues({ liveApiUrl: '••••••••', hasLiveApiUrl: true, channelUrl: 'x', },),).toEqual({ channelUrl: 'x', },);
    },);

    it('reports its tiers', () => {
        expect(status({}, false,).state,).toBe('off',);
        expect(status({ channelUrl: 'https://rumble.com/c/x', }, false,).state,).toBe('off',);
        const basic = status({ channelUrl: 'https://rumble.com/c/x', }, true,);
        expect(basic.state,).toBe('partial',);
        expect(basic.message,).toMatch(/livestream-api/,);
        expect(basic.collects.length,).toBe(2,);
        const owner = status({ channelUrl: 'https://rumble.com/c/x', liveApiUrl: 'https://rumble.com/-livestream-api/x', }, true,);
        expect(owner.state,).toBe('ready',);
        expect(owner.collects.length,).toBe(5,);
        const broken = status({ channelUrl: 'c', liveApiUrl: 'u', analyticsCapabilities: { liveApi: false, liveApiError: 'refused the key', }, }, true,);
        expect(broken.state,).toBe('partial',);
        expect(broken.message,).toMatch(/refused the key/,);
        expect(getCollector('rumble',)?.crons?.map((c,) => c.name),).toEqual(['rumble-live',],);
    },);
},);
