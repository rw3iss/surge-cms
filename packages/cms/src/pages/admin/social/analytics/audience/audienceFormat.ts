/**
 * Pure helpers for the Audience & content panels (dashboard + digest view):
 * shares, top-N, best hours, readable names for breakdown keys, and the
 * "why is this block empty" notes driven by the collector's capabilities.
 */
import type { AudienceBucket, AudienceDemographics, SocialAudience, } from '@sitesurge/types';

/** Buckets sorted by value (largest first), shares recomputed from the values. */
export function withShares(buckets: AudienceBucket[] | null | undefined,): AudienceBucket[] {
    const list = (buckets ?? []).filter((b,) => Number.isFinite(b.value,) && b.value > 0);
    const total = list.reduce((t, b,) => t + b.value, 0,);
    return list
        .map((b,) => ({ key: b.key, value: b.value, share: total ? b.value / total : 0, }))
        .sort((a, b,) => b.value - a.value || a.key.localeCompare(b.key,));
}

/** The N largest buckets (shares relative to the whole breakdown, not to the N). */
export function topN(buckets: AudienceBucket[] | null | undefined, n: number,): AudienceBucket[] {
    return withShares(buckets,).slice(0, Math.max(0, n,),);
}

/** Age bands in natural order (13-17, 18-24, … 65+), not by size. */
export function ageOrder(buckets: AudienceBucket[] | null | undefined,): AudienceBucket[] {
    const lower = (k: string,) => {
        const m = /^(\d+)/.exec(k,);
        return m ? Number(m[1],) : Number.MAX_SAFE_INTEGER;
    };
    return withShares(buckets,).sort((a, b,) => lower(a.key,) - lower(b.key,));
}

/** The hours (0–23) with the most followers online, best first. */
export function bestHours(hours: Array<{ hour: number; value: number; }> | null | undefined, n = 3,): number[] {
    return [...(hours ?? []),]
        .filter((h,) => Number.isFinite(h.value,) && h.value > 0)
        .sort((a, b,) => b.value - a.value || a.hour - b.hour)
        .slice(0, n,)
        .map((h,) => h.hour);
}

/** All 24 hours, missing ones as 0, in order. */
export function fullDay(hours: Array<{ hour: number; value: number; }> | null | undefined,): Array<{ hour: number; value: number; }> {
    const by = new Map((hours ?? []).map((h,) => [h.hour, h.value,]),);
    return Array.from({ length: 24, }, (_, h,) => ({ hour: h, value: by.get(h,) ?? 0, }),);
}

/** 0 → "12 AM", 13 → "1 PM". */
export function hourLabel(h: number,): string {
    const hh = ((h % 24) + 24) % 24;
    const twelve = hh % 12 === 0 ? 12 : hh % 12;
    return `${twelve} ${hh < 12 ? 'AM' : 'PM'}`;
}

/** "US" → "🇺🇸". Non-ISO keys return ''. */
export function flagEmoji(code: string,): string {
    const c = String(code ?? '',).trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(c,)) return '';
    return String.fromCodePoint(...[...c,].map((ch,) => 0x1f1e6 + ch.charCodeAt(0,) - 65),);
}

let regionNames: Intl.DisplayNames | null | undefined;
/** "US" → "United States" (falls back to the code). */
export function countryName(code: string,): string {
    const c = String(code ?? '',).trim().toUpperCase();
    if (regionNames === undefined) {
        try {
            regionNames = new Intl.DisplayNames(['en',], { type: 'region', },);
        } catch {
            regionNames = null;
        }
    }
    if (!/^[A-Z]{2}$/.test(c,) || !regionNames) return code;
    try {
        return regionNames.of(c,) ?? code;
    } catch {
        return code;
    }
}

const TYPE_LABELS: Record<string, string> = {
    REEL: 'Reels', REELS: 'Reels', FEED: 'Posts', POST: 'Posts', STORY: 'Stories', CAROUSEL: 'Carousels',
    CAROUSEL_ALBUM: 'Carousels', AD: 'Ads', IGTV: 'IGTV', LIVE: 'Live', VIDEO: 'Videos', IMAGE: 'Images',
};
/** Content-type breakdown key → label. */
export function typeLabel(key: string,): string {
    return TYPE_LABELS[String(key,).toUpperCase()] ?? titleCase(key,);
}

const FOLLOW_LABELS: Record<string, string> = { FOLLOWER: 'Followers', NON_FOLLOWER: 'Non-followers', UNKNOWN: 'Unknown', };
export function followLabel(key: string,): string {
    return FOLLOW_LABELS[String(key,).toUpperCase()] ?? titleCase(key,);
}

const GENDER_LABELS: Record<string, string> = { F: 'Women', M: 'Men', U: 'Unspecified', FEMALE: 'Women', MALE: 'Men', };
export function genderLabel(key: string,): string {
    return GENDER_LABELS[String(key,).toUpperCase()] ?? titleCase(key,);
}

const KIND_LABELS: Record<string, string> = {
    reel: 'Reels', story: 'Stories', carousel: 'Carousels', image: 'Images', video: 'Videos', short: 'Shorts', live: 'Live',
    post: 'Posts', feed: 'Posts',
};
export function kindLabel(kind: string,): string {
    return KIND_LABELS[String(kind,).toLowerCase()] ?? titleCase(kind,);
}

const VIEWER_LABELS: Record<string, string> = { NEW: 'New viewers', RETURNING: 'Returning viewers', };
export function viewerLabel(key: string,): string {
    return VIEWER_LABELS[String(key,).toUpperCase()] ?? titleCase(key,);
}

/** TikTok traffic source keys ("For You", "PERSONAL_PROFILE", "follow") → plain words. */
export function sourceLabel(key: string,): string {
    const k = String(key,).replace(/[_-]+/g, ' ',).trim();
    if (/^for ?you$/i.test(k,)) return 'For You feed';
    const lower = k.toLowerCase();
    return lower.charAt(0,).toUpperCase() + lower.slice(1,);
}

/** Post kinds the posts table can filter by, in a fixed order. */
export const POST_KINDS = ['reel', 'story', 'carousel', 'image', 'video', 'short', 'live',] as const;

/** The POST_KINDS present in `seen` (case-insensitive), in POST_KINDS order, plus any unknown kinds after. */
export function kindsPresent(seen: Array<string | null | undefined>,): string[] {
    const set = new Set(seen.filter(Boolean,).map((k,) => String(k,).toLowerCase()),);
    const known = POST_KINDS.filter((k,) => set.has(k,));
    const extra = [...set,].filter((k,) => !(POST_KINDS as readonly string[]).includes(k,)).sort();
    return [...known, ...extra,];
}

function titleCase(s: string,): string {
    return String(s ?? '',).toLowerCase().replace(/_/g, ' ',).replace(/(^|\s)\S/g, (c,) => c.toUpperCase(),);
}

export function hasDemographics(d: AudienceDemographics | null | undefined,): boolean {
    return Boolean(d && (d.age.length || d.gender.length || d.country.length || d.city.length));
}

export type AudienceBlock = 'demographics' | 'hours' | 'types' | 'follow' | 'stories' | 'hashtags' | 'benchmarks';

/**
 * Why a block has nothing to show, using the collector's capabilities when
 * it reported them (missing key = unknown → a neutral "no data yet").
 */
export function missingNote(block: AudienceBlock, caps: Record<string, boolean> | null | undefined,): string {
    const no = (k: string,) => caps != null && caps[k] === false;
    switch (block) {
        case 'demographics':
            return no('demographics',) || no('accountInsights',)
                ? 'Demographics need a Business or Creator account with 100+ followers and the insights permission.'
                : 'No demographics collected for this period yet.';
        case 'hours':
            return no('onlineFollowers',) || no('accountInsights',)
                ? 'Online-follower hours need account insights (a Business or Creator account).'
                : 'No online-follower hours collected for this period yet.';
        case 'types':
        case 'follow':
            return no('accountInsights',)
                ? 'Content and audience splits need account insights (a Business or Creator account).'
                : 'No breakdown collected for this period yet.';
        case 'stories':
            return no('stories',) ? 'Stories need the insights permission (captured every 3 hours while live).' : 'No stories in this period.';
        case 'hashtags':
            return 'No hashtags in posts with metrics for this period.';
        case 'benchmarks':
            return no('benchmarks',)
                ? 'Benchmarks need a Facebook-Login Instagram connection (business discovery).'
                : 'No benchmark accounts yet.';
    }
}

/** Anything at all to show for this audience? */
export function audienceHasData(a: SocialAudience | null | undefined,): boolean {
    if (!a) return false;
    const b = a.breakdowns;
    return hasDemographics(a.demographics.followers,) || hasDemographics(a.demographics.engaged,) || hasDemographics(a.demographics.reached,)
        || a.onlineHours.some((h,) => h.value > 0)
        || [b.viewsByType, b.reachByType, b.interactionsByType, b.viewsByFollow, b.reachByFollow,
            b.viewsByPaid, b.videoViewsByPlay, b.reactionsByType, b.trafficSources, b.viewerTypes,].some((x,) => (x?.length ?? 0) > 0)
        || a.contentKinds.length > 0 || a.hashtags.length > 0 || a.stories.count > 0 || a.benchmarks.length > 0;
}

export type HashtagSort = 'tag' | 'posts' | 'avgViews' | 'engagementRate';

/** Sort hashtag rows; nulls last in either direction. */
export function sortHashtags<T extends { tag: string; posts: number; avgViews: number | null; engagementRate: number | null; },>(
    rows: T[],
    field: HashtagSort,
    dir: 'asc' | 'desc',
): T[] {
    const sign = dir === 'asc' ? 1 : -1;
    return [...rows,].sort((a, b,) => {
        if (field === 'tag') return sign * a.tag.localeCompare(b.tag,);
        const av = a[field];
        const bv = b[field];
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return sign * (av - bv) || a.tag.localeCompare(b.tag,);
    },);
}

/** Instagram usernames: letters, digits, '.', '_' — 1–30 chars. */
export const IG_USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
export const MAX_BENCHMARKS = 20;

/** "@a, b\nc" → ['a', 'b', 'c'] (deduped, lower-case, '@' and instagram.com/ URLs stripped). */
export function parseUsernames(text: string,): string[] {
    const seen = new Set<string>();
    for (const part of String(text ?? '',).split(/[\s,;]+/,)) {
        let u = part.trim();
        if (!u) continue;
        u = u.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '',).replace(/\/.*$/, '',).replace(/^@/, '',).toLowerCase();
        if (u) seen.add(u,);
    }
    return [...seen,];
}

export function invalidUsernames(list: string[],): string[] {
    return list.filter((u,) => !IG_USERNAME_RE.test(u,));
}
