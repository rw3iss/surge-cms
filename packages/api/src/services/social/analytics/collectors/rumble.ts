/**
 * Rumble analytics collector. Rumble has no official analytics API, so this
 * reads two UNOFFICIAL / owner sources (see social/rumbleParse.ts):
 *
 *  BASIC (channel URL, no sign-in) — the public channel videos pages:
 *   1. Account: followers (the channel's `followers` on its videos).
 *   2. Videos: the newest ≤ 100 (≤ 4 pages, stopping at 90 days once 25 are
 *      in) are upserted into social_posts (platform 'rumble', video / short /
 *      live), each with cumulative views, likes (votes up), dislikes,
 *      comments, shares (reposts), duration, Rumble plays.
 *  OWNER (Live Stream API URL — a secret key the creator makes):
 *   3. Followers (this channel + across all channels), paid subscribers,
 *      gifted subs; new followers / subscribers per day counted from the 50
 *      most recent (complete days only — a busier day is undercounted).
 *   4. Live: the `rumble-live` cron samples every 10 minutes while a stream is
 *      live — peak watching now, likes / dislikes, chat messages and Rants
 *      ($) — as daily rows (total + `live:<video id or stream id>`).
 *
 * Families are independent: a failing owner key never stops the basic tier
 * (and vice versa); what worked is kept in credentials.analyticsCapabilities.
 */
import type { SocialCollectorStatus, } from '@sitesurge/types';
import { query, } from '../../../../db';
import { logger, } from '../../../../utils/logger';
import { fetchLiveApi, listChannelVideos, } from '../../rumble';
import { redactLiveApiUrl, RUMBLE_LIVE_API_HELP_URL, rumbleFetchedPost, } from '../../rumbleParse';
import { registerCollector, } from '../registry';
import type { CollectContext, CollectResult, } from '../types';
import { liveSamplePoints, type LiveStreamState, matchLivestream, newPerDay, rumblePostMetric, } from './rumbleMapping';

const LIST_DAYS = 90;
const MIN_ITEMS = 25;
/** Live sample state for streams not seen for this long is dropped. */
const LIVE_STATE_DAYS = 2;

export interface RumbleCapabilities {
    publicPage?: boolean;
    liveApi?: boolean;
    liveApiError?: string | null;
    checkedAt?: string;
}

export const OWNER_HELP = 'For paid subscribers, follower history and live stream stats (viewers, chat, Rants): '
    + `create a Live Stream API URL at ${RUMBLE_LIVE_API_HELP_URL} and paste it on the Rumble card in Social → Configuration.`;

function capabilitiesOf(credentials: Record<string, unknown>,): RumbleCapabilities | null {
    const c = credentials.analyticsCapabilities;
    return c && typeof c === 'object' ? c as RumbleCapabilities : null;
}

async function saveCreds(patch: Record<string, unknown>,): Promise<void> {
    await query(
        `UPDATE social_connections SET credentials = COALESCE(credentials, '{}'::jsonb) || $1::jsonb, updated_at = NOW() WHERE provider::text = 'rumble'`,
        [JSON.stringify(patch,),],
    );
}

export function status(credentials: Record<string, unknown>, connected: boolean,): SocialCollectorStatus {
    const base = { platform: 'rumble' as const, label: 'Rumble', };
    const hasChannel = Boolean(credentials.channelUrl,);
    const hasOwner = Boolean(credentials.liveApiUrl,);
    if (!connected || (!hasChannel && !hasOwner)) {
        return { ...base, state: 'off', message: 'Add your Rumble channel in Social → Configuration → Rumble.', collects: [], };
    }
    const caps = capabilitiesOf(credentials,);
    const collects: string[] = [];
    const problems: string[] = [];
    if (hasChannel) {
        collects.push('Followers (public channel page)', 'Every recent video with views, likes, dislikes, comments, reposts, duration',);
        if (caps?.publicPage === false) problems.push('The last read of the public channel page failed — check the channel URL.',);
    } else {
        problems.push('Add the channel URL too, so videos and their numbers are collected.',);
    }
    if (!hasOwner) {
        return { ...base, state: 'partial', message: [...problems, OWNER_HELP,].join(' ',), collects, };
    }
    collects.push(
        'Followers (this channel and all channels), paid subscribers, gifted subs',
        'New followers / subscribers per day (from the 50 most recent)',
        'Live streams every 10 minutes: peak viewers, likes, chat messages, Rants',
    );
    if (caps?.liveApiError) problems.push(`Rumble Live Stream API: ${caps.liveApiError}`,);
    if (problems.length) return { ...base, state: 'partial', message: problems.join(' ',), collects, };
    return { ...base, state: 'ready', message: null, collects, };
}

async function collect(ctx: CollectContext,): Promise<CollectResult> {
    const channelUrl = String(ctx.credentials.channelUrl ?? '',);
    const liveApiUrl = String(ctx.credentials.liveApiUrl ?? '',);
    if (!channelUrl && !liveApiUrl) throw new Error('Rumble is not connected.',);
    const result: CollectResult = { daily: [], posts: [], };
    const caps: RumbleCapabilities = { ...(capabilitiesOf(ctx.credentials,) ?? {}), checkedAt: new Date().toISOString(), };
    const errors: string[] = [];

    // BASIC: public channel pages → social_posts + per-video numbers.
    if (channelUrl) {
        try {
            const { upsertSocialPost, } = await import('../../../social.js');
            const res = await listChannelVideos(channelUrl, {
                minItems: MIN_ITEMS,
                olderThan: Date.parse(`${ctx.today}T00:00:00Z`,) - LIST_DAYS * 86_400_000,
            },);
            for (const w of res.warnings) ctx.warn(w,);
            if (res.info) {
                result.account = {
                    followers: typeof res.info.followers === 'number' ? res.info.followers : null,
                    raw: { channel: res.info.url ?? channelUrl, channelTitle: res.info.title ?? res.info.name ?? null, subscribers: res.info.subscribers ?? null, verified: res.info.verified_badge ?? null, },
                };
            }
            let failed = 0;
            for (const item of res.items) {
                try {
                    const post = rumbleFetchedPost(item,);
                    await upsertSocialPost('rumble', post, { source: 'sync', postUrl: post.mediaUrl ?? null, },);
                } catch (e) {
                    if (++failed <= 3) ctx.warn(`Rumble video ${String(item.id,)}: could not store (${(e as Error).message})`,);
                }
                result.posts!.push(rumblePostMetric(item,),);
            }
            caps.publicPage = true;
        } catch (e) {
            caps.publicPage = false;
            errors.push(`public channel page: ${(e as Error).message}`,);
        }
    }

    // OWNER: Live Stream API (secret URL — never in a message).
    if (liveApiUrl) {
        try {
            const data = await fetchLiveApi(liveApiUrl,);
            result.account = {
                ...(result.account ?? {}),
                followers: data.followers ?? result.account?.followers ?? null,
                raw: {
                    ...(result.account?.raw ?? {}),
                    followersAllChannels: data.followersTotal,
                    paidSubscribers: data.subscribers,
                    giftedSubs: data.giftedSubs,
                    liveApiType: data.type,
                    channelName: data.channelName ?? data.username,
                },
            };
            const day = ctx.today;
            if (data.subscribers !== null) result.daily!.push({ date: day, metric: 'paidSubscribers', value: data.subscribers, },);
            if (data.giftedSubs !== null) result.daily!.push({ date: day, metric: 'giftedSubs', value: data.giftedSubs, },);
            result.daily!.push(...newPerDay(data.recentFollowers, 'newFollowers', day,),);
            result.daily!.push(...newPerDay(data.recentSubscribers, 'newSubscribers', day,),);
            caps.liveApi = true;
            caps.liveApiError = null;
        } catch (e) {
            const msg = redactLiveApiUrl((e as Error).message, liveApiUrl,);
            caps.liveApi = false;
            caps.liveApiError = msg;
            errors.push(`Live Stream API: ${msg}`,);
        }
    }

    await saveCreds({ analyticsCapabilities: caps, },).catch((e,) => logger.warn('rumble: could not save capabilities', { error: (e as Error).message, },),);
    // Nothing worked at all → a failed run; one tier failing → a warning.
    const worked = (channelUrl && caps.publicPage) || (liveApiUrl && caps.liveApi);
    if (!worked) throw new Error(`Rumble: ${errors.join('; ',)}`,);
    for (const e of errors) ctx.warn(`Rumble ${e}`,);
    return result;
}

// ── Live sampling (every 10 minutes while live) ──────────────────────────

interface LiveSettings {
    streams?: Record<string, LiveStreamState>;
}

export async function sampleRumbleLive(): Promise<number> {
    const r = await query<{ credentials: Record<string, unknown> | null; settings: Record<string, unknown> | null; }>(
        `SELECT credentials, settings FROM social_connections WHERE provider::text = 'rumble' AND is_connected = true AND is_enabled = true`,
    ).catch(() => ({ rows: [] as Array<{ credentials: Record<string, unknown> | null; settings: Record<string, unknown> | null; }>, }));
    const row = r.rows[0];
    const url = String(row?.credentials?.liveApiUrl ?? '',);
    if (!url) return 0;
    let data;
    try {
        data = await fetchLiveApi(url,);
    } catch (e) {
        logger.warn('rumble-live: Live Stream API failed', { error: redactLiveApiUrl((e as Error).message, url,), },);
        return 0;
    }
    const live = data.livestreams.filter((l,) => l.isLive,);
    const prevState = ((row?.settings?.rumbleLive ?? {}) as LiveSettings).streams ?? {};
    const nowIso = new Date().toISOString();
    const keep = Date.now() - LIVE_STATE_DAYS * 86_400_000;
    const nextState: Record<string, LiveStreamState> = {};
    for (const [id, s,] of Object.entries(prevState,)) if (Date.parse(s.seenAt,) >= keep) nextState[id] = s;
    if (!live.length) {
        if (Object.keys(nextState,).length !== Object.keys(prevState,).length) await saveLiveState(nextState,);
        return 0;
    }

    const posts = await query<{ external_id: string; content: string | null; published_at: Date | null; }>(
        `SELECT external_id, content, published_at FROM social_posts
          WHERE platform::text = 'rumble' AND (published_at IS NULL OR published_at > NOW() - INTERVAL '3 days')
          ORDER BY published_at DESC NULLS LAST LIMIT 200`,
    ).catch(() => ({ rows: [] as Array<{ external_id: string; content: string | null; published_at: Date | null; }>, }));
    const known = posts.rows.map((p,) => ({ externalId: p.external_id, title: p.content, publishedAt: p.published_at ? new Date(p.published_at,).toISOString() : null, }));

    const day = nowIso.slice(0, 10,);
    const points = [];
    for (const stream of live) {
        const key = matchLivestream(stream, known,) ?? stream.id;
        const s = liveSamplePoints(stream, prevState[stream.id] ?? null, key, day, nowIso,);
        points.push(...s.points,);
        nextState[stream.id] = s.state;
    }
    // Lazy: runner.ts imports the collectors (a static import would be a cycle).
    const { storeDailySamples, } = await import('../runner.js');
    const n = await storeDailySamples('rumble', points,);
    await saveLiveState(nextState,);
    return n;
}

async function saveLiveState(streams: Record<string, LiveStreamState>,): Promise<void> {
    await query(
        `UPDATE social_connections SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('rumbleLive', $1::jsonb) WHERE provider::text = 'rumble'`,
        [JSON.stringify({ streams, },),],
    ).catch((e,) => logger.warn('rumble-live: could not save state', { error: (e as Error).message, },));
}

registerCollector({
    platform: 'rumble',
    label: 'Rumble',
    connection: 'rumble',
    status,
    collect,
    crons: [{
        name: 'rumble-live',
        schedule: '*/10 * * * *',
        description: 'Samples Rumble live streams (viewers, likes, chat, Rants) every 10 minutes — only with a Live Stream API URL saved.',
        handler: async () => {
            await sampleRumbleLive();
        },
    },],
},);
