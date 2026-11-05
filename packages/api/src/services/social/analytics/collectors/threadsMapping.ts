/**
 * Pure Threads API → our shape mappers (no I/O, unit-tested in threads.test.ts).
 *
 * Threads insights response shapes (developers.facebook.com/docs/threads/insights):
 *  - user `views`: time series — `values: [{ value, end_time }]`, period day.
 *  - user `likes|replies|reposts|quotes|followers_count`: `total_value: { value }`
 *    over the requested since/until window (so one call per day gives a daily value).
 *  - user `clicks`: `link_total_values: [{ value, link_url }]`.
 *  - media insights: `data: [{ name, values: [{ value }] }]`, period lifetime.
 */
import type { DailyPoint, PostMetric, } from '../types';

/** The earliest `since` the Threads insights API accepts (2024-04-13). */
export const THREADS_INSIGHTS_EPOCH = 1712991600;

export interface ThreadsInsight {
    name: string;
    period?: string;
    values?: Array<{ value: unknown; end_time?: string; }>;
    total_value?: { value: unknown; };
    link_total_values?: Array<{ value: unknown; link_url?: string; }>;
}

export interface ThreadsMedia {
    id: string;
    media_type?: string;
    media_product_type?: string;
    text?: string;
    permalink?: string;
    timestamp?: string;
    thumbnail_url?: string;
    media_url?: string;
    username?: string;
    is_quote_post?: boolean;
}

const num = (v: unknown,): number | null => {
    const x = typeof v === 'number' ? v : Number(v,);
    return v === undefined || v === null || v === '' || !Number.isFinite(x,) ? null : x;
};

/** Unix seconds of a UTC day's midnight. */
export function dayStartUnix(day: string,): number {
    return Math.floor(Date.parse(`${day}T00:00:00Z`,) / 1000,);
}

export function addDays(day: string, n: number,): string {
    const d = new Date(`${day}T00:00:00Z`,);
    d.setUTCDate(d.getUTCDate() + n,);
    return d.toISOString().slice(0, 10,);
}

/** Threads timestamps use `+0000` offsets; normalise to `+00:00` before parsing. ISO string or null. */
export function parseThreadsTime(value: string | undefined | null,): string | null {
    if (!value) return null;
    const t = Date.parse(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2',),);
    return Number.isFinite(t,) ? new Date(t,).toISOString() : null;
}

/**
 * A daily value's `end_time` marks the END of its day (the next midnight in
 * Meta's reporting zone), so the value belongs to the day before.
 */
export function endTimeToDay(endTime: string,): string | null {
    const iso = parseThreadsTime(endTime,);
    return iso ? new Date(Date.parse(iso,) - 86400_000,).toISOString().slice(0, 10,) : null;
}

/** Single number of a total-value / link-total / lifetime insight. */
export function insightValue(i: ThreadsInsight,): number | null {
    if (i.total_value) return num(i.total_value.value,);
    if (i.link_total_values) {
        let sum = 0;
        let any = false;
        for (const l of i.link_total_values) {
            const v = num(l.value,);
            if (v !== null) {
                sum += v;
                any = true;
            }
        }
        return any ? sum : null;
    }
    // Lifetime (media) insight: the one value in `values`.
    const vals = (i.values ?? []).map((v,) => num(v.value,)).filter((v,): v is number => v !== null);
    return vals.length ? vals[vals.length - 1] : null;
}

/** `views` time series → one point per day. */
export function viewsSeries(i: ThreadsInsight,): DailyPoint[] {
    const out: DailyPoint[] = [];
    for (const v of i.values ?? []) {
        const value = num(v.value,);
        const date = v.end_time ? endTimeToDay(v.end_time,) : null;
        if (value !== null && date) out.push({ date, metric: 'views', value, },);
    }
    return out;
}

/** User total-value metrics over one day → points for that day (views handled by viewsSeries). */
export function dayTotals(day: string, data: ThreadsInsight[],): DailyPoint[] {
    const out: DailyPoint[] = [];
    for (const i of data) {
        if (i.name === 'views' || i.name === 'followers_count') continue;
        const value = insightValue(i,);
        if (value !== null) out.push({ date: day, metric: i.name, value, },);
    }
    return out;
}

/** Media insights → our per-post metric. replies → comments, reposts + quotes → shares. */
export function mediaMetric(externalId: string, data: ThreadsInsight[],): PostMetric {
    const raw: Record<string, number> = {};
    for (const i of data) {
        const v = insightValue(i,);
        if (v !== null) raw[i.name] = v;
    }
    const has = (k: string,) => Object.prototype.hasOwnProperty.call(raw, k,);
    const shares = has('reposts',) || has('quotes',) ? (raw.reposts ?? 0) + (raw.quotes ?? 0) : null;
    return {
        externalId,
        views: has('views',) ? raw.views : null,
        likes: has('likes',) ? raw.likes : null,
        comments: has('replies',) ? raw.replies : null,
        shares,
        raw,
    };
}

/** A repost of someone else's thread has no insights and is not our content. */
export function isOwnThread(m: ThreadsMedia,): boolean {
    return m.media_type !== 'REPOST_FACADE';
}

/** media_type → social_posts.media_kind. */
export function threadKind(m: ThreadsMedia,): string {
    switch (m.media_type) {
        case 'VIDEO': return 'video';
        case 'IMAGE': return 'image';
        case 'CAROUSEL_ALBUM': return 'carousel';
        default: return 'text';
    }
}
