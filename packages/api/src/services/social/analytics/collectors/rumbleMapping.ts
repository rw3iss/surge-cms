/**
 * Rumble analytics — PURE mapping (no I/O; tested in rumble.test.ts).
 * Sources and limits: social/rumbleParse.ts.
 */
import { count, type RumbleLiveDatedUser, type RumbleLivestream, type RumbleVideoItem, } from '../../rumbleParse';
import type { DailyPoint, PostMetric, } from '../types';

/** One video's cumulative numbers (votes up = likes, reposts = shares). */
export function rumblePostMetric(item: RumbleVideoItem,): PostMetric {
    return {
        externalId: String(item.id,),
        views: count(item.views,),
        likes: count(item.rumble_votes?.num_votes_up,),
        comments: count(item.comments?.count,),
        shares: count(item.reposts_count,),
        raw: {
            dislikes: count(item.rumble_votes?.num_votes_down,),
            score: typeof item.rumble_votes?.score === 'number' ? item.rumble_votes.score : null,
            durationS: count(item.duration,),
            rumblePlays: count(item.video_stats?.rumble_plays,),
            // Revenue is only non-zero when the viewer IS the owner, which a public page never is.
            ...(count(item.video_stats?.revenue,) ? { revenue: item.video_stats!.revenue, revenueUnits: item.video_stats!.revenue_units ?? null, } : {}),
            ...(item.watching_now != null ? { watchingNow: count(item.watching_now,), } : {}),
        },
    };
}

/** The Live Stream API lists at most this many recent followers / subscribers. */
export const RECENT_LIST_CAP = 50;

const utcDate = (iso: string | null,): string | null => {
    const t = Date.parse(String(iso ?? '',),);
    return Number.isFinite(t,) ? new Date(t,).toISOString().slice(0, 10,) : null;
};

/**
 * New followers / subscribers per UTC day, counted from a "recent" list.
 * Only COMPLETE days are returned: when the list is full (50), its oldest day
 * may be cut off, so that day — and anything older — is left out. Days with
 * no one are not written (absence ≠ zero for a sample this small).
 */
export function newPerDay(list: RumbleLiveDatedUser[], metric: string, today: string,): DailyPoint[] {
    const dates = list.map((u,) => utcDate(u.on,)).filter((d,): d is string => Boolean(d,));
    if (!dates.length) return [];
    const oldest = dates.reduce((a, b,) => (a < b ? a : b));
    const full = list.length >= RECENT_LIST_CAP;
    const by = new Map<string, number>();
    for (const d of dates) {
        if (d > today) continue;
        if (full && d <= oldest) continue;
        by.set(d, (by.get(d,) ?? 0) + 1,);
    }
    return [...by.entries(),].sort(([a,], [b,],) => a.localeCompare(b,)).map(([date, value,],) => ({ date, metric, value, }));
}

/** How a live sample combines with the value already stored for the day. */
export type LiveMode = 'max' | 'add' | 'set';
export interface LivePoint extends DailyPoint {
    mode: LiveMode;
}

/** Per-stream memory between 10-minute samples (kept in the connection settings). */
export interface LiveStreamState {
    lastMessageAt: string | null;
    lastRantAt: string | null;
    seenAt: string;
}

const after = (iso: string | null, mark: string | null,): boolean => {
    const t = Date.parse(String(iso ?? '',),);
    if (!Number.isFinite(t,)) return mark === null;
    return mark === null || t > Date.parse(mark,);
};

const newest = (list: Array<{ createdOn: string | null; }>, prev: string | null,): string | null =>
    list.reduce<string | null>((m, x,) => {
        const t = Date.parse(String(x.createdOn ?? '',),);
        if (!Number.isFinite(t,)) return m;
        return m === null || t > Date.parse(m,) ? new Date(t,).toISOString() : m;
    }, prev,);

/**
 * One sample of a live stream → increments for the day. Chat messages and
 * Rants are counted only when newer than the previous sample's newest (the
 * API returns the latest 50, so a chat busier than 50 messages / 10 minutes
 * is undercounted). `key` is the dimension id (`live:<key>`).
 */
export function liveSamplePoints(
    stream: RumbleLivestream,
    prev: LiveStreamState | null,
    key: string,
    day: string,
    nowIso: string,
): { points: LivePoint[]; state: LiveStreamState; } {
    const messages = stream.recentMessages.filter((m,) => after(m.createdOn, prev?.lastMessageAt ?? null,),);
    const rants = stream.recentRants.filter((r,) => after(r.createdOn, prev?.lastRantAt ?? null,),);
    const rantCents = rants.reduce((s, r,) => s + (r.amountCents || 0), 0,);
    const vals: Array<[string, number | null, LiveMode,]> = [
        ['liveWatchingPeak', stream.watchingNow, 'max',],
        ['liveChatMessages', messages.length, 'add',],
        ['liveRants', rants.length, 'add',],
        ['liveRantsCents', rantCents, 'add',],
        ['liveLikes', stream.likes, 'set',],
        ['liveDislikes', stream.dislikes, 'set',],
    ];
    const points: LivePoint[] = [];
    for (const [metric, value, mode,] of vals) {
        if (value === null || !Number.isFinite(value,)) continue;
        points.push({ date: day, metric, value, mode, dimension: '', },);
        points.push({ date: day, metric, value, mode, dimension: `live:${key}`, },);
    }
    return {
        points,
        state: {
            lastMessageAt: newest(stream.recentMessages, prev?.lastMessageAt ?? null,),
            lastRantAt: newest(stream.recentRants, prev?.lastRantAt ?? null,),
            seenAt: nowIso,
        },
    };
}

/**
 * Which captured video a livestream is. Rumble's Live Stream API gives the
 * stream an id that is, as far as we can tell, the video's base-36 id — so
 * that is tried first; then the same title published within a day of the
 * stream's start. Null when nothing matches.
 */
export function matchLivestream(
    stream: { id: string; title: string | null; createdOn: string | null; },
    posts: Array<{ externalId: string; title: string | null; publishedAt: string | null; }>,
): string | null {
    const asNumber = /^v?[0-9a-z]+$/i.test(stream.id,) ? parseInt(stream.id.replace(/^v/i, '',), 36,) : NaN;
    if (Number.isSafeInteger(asNumber,)) {
        const hit = posts.find((p,) => p.externalId === String(asNumber,) || p.externalId === stream.id);
        if (hit) return hit.externalId;
    }
    const title = (stream.title ?? '').trim().toLowerCase();
    if (!title) return null;
    const start = Date.parse(String(stream.createdOn ?? '',),);
    const DAY = 86_400_000;
    const same = posts.filter((p,) => (p.title ?? '').trim().toLowerCase() === title);
    const near = same.filter((p,) => {
        const t = Date.parse(String(p.publishedAt ?? '',),);
        return !Number.isFinite(start,) || !Number.isFinite(t,) || Math.abs(t - start,) <= DAY;
    },);
    return near[0]?.externalId ?? null;
}
