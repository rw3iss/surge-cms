/**
 * Pure formatting helpers for the analytics digests UI (the in-browser digest,
 * the digest list and the settings page). No DOM, no Solid — unit-tested.
 */
import { SOCIAL_METRICS, type DigestMetric, type SocialAnalyticsDigestSendResponse, type SocialAnalyticsSettings, } from '@sitesurge/types';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',];

export const fmtNum = (v: number | null | undefined,): string => (v === null || v === undefined || !Number.isFinite(v,) ? '—' : Math.round(v,).toLocaleString('en-US',));

export const fmtPct = (v: number | null | undefined, digits = 1,): string => (v === null || v === undefined || !Number.isFinite(v,) ? '—' : `${(v * 100).toFixed(digits,)}%`);

export function fmtDuration(seconds: number | null | undefined,): string {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds,)) return '—';
    const s = Math.round(seconds,);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60,);
    if (m < 60) return `${m}:${String(s % 60,).padStart(2, '0',)}`;
    return `${Math.floor(m / 60,)}h ${m % 60}m`;
}

export function fmtMinutes(min: number | null | undefined,): string {
    if (min === null || min === undefined || !Number.isFinite(min,)) return '—';
    return min >= 120 ? `${Math.round(min / 60,).toLocaleString('en-US',)} h` : `${Math.round(min,).toLocaleString('en-US',)} min`;
}

/** Format a value of a metric key (counts, %, durations, minutes). */
export function fmtMetric(key: string, v: number | null | undefined,): string {
    const unit = SOCIAL_METRICS[key]?.unit;
    if (key === 'engagementRate' || unit === 'percent') return fmtPct(v,);
    if (key === 'avgViewDuration' || unit === 'seconds') return fmtDuration(v,);
    if (key === 'watchTimeMinutes' || unit === 'minutes') return fmtMinutes(v,);
    if (key === 'followerChange' && typeof v === 'number') return `${v > 0 ? '+' : ''}${fmtNum(v,)}`;
    return fmtNum(v,);
}

/** Digest labels (shorter than the dashboard's where it helps the tiles). */
const DIGEST_LABELS: Record<string, string> = {
    followers: 'Followers',
    followerChange: 'Follower change',
    views: 'Views',
    engagedViews: 'Engaged views',
    watchTimeMinutes: 'Watch time',
    avgViewDuration: 'Avg view',
    likes: 'Likes',
    comments: 'Comments',
    shares: 'Shares',
    posts: 'Posts',
    avgViewsPerPost: 'Views / post',
    engagementRate: 'Engagement',
};

export function metricLabel(key: string,): string {
    return DIGEST_LABELS[key] ?? SOCIAL_METRICS[key]?.label ?? key.replace(/([A-Z])/g, ' $1',).replace(/^./, (c,) => c.toUpperCase(),);
}

export type DeltaTone = 'up' | 'down' | 'flat' | 'none';

/** Direction of a change. For metrics where less is better (none today) callers can invert. */
export function deltaTone(m: DigestMetric | undefined,): DeltaTone {
    if (!m || m.change === null || m.change === undefined) return 'none';
    if (m.change > 0) return 'up';
    if (m.change < 0) return 'down';
    return 'flat';
}

/** "▲ 12.5% (+1,204)" / "▼ 3.0% (−87)" / "no change" / "" (no previous). */
export function deltaText(key: string, m: DigestMetric | undefined,): string {
    const tone = deltaTone(m,);
    if (tone === 'none' || !m) return '';
    if (tone === 'flat') return 'no change';
    const arrow = tone === 'up' ? '▲' : '▼';
    const abs = Math.abs(m.change!,);
    const amount = key === 'engagementRate' ? `${(abs * 100).toFixed(1,)} pts` : fmtMetric(key === 'followerChange' ? 'followers' : key, abs,);
    const sign = tone === 'up' ? '+' : '−';
    if (m.changePct === null || m.changePct === undefined || !Number.isFinite(m.changePct,) || key === 'engagementRate') return `${arrow} ${sign}${amount}`;
    return `${arrow} ${Math.abs(m.changePct * 100,).toFixed(1,)}% (${sign}${amount})`;
}

const pad2 = (n: number,) => String(n,).padStart(2, '0',);

/** "Every Monday at 9:00 (America/New_York)". */
export function scheduleDescription(d: SocialAnalyticsSettings['digest'],): string {
    const at = `${d.hour}:${pad2(0,)}`;
    const tz = d.timezone ? ` (${d.timezone})` : '';
    if (d.frequency === 'daily') return `Every day at ${at}${tz}`;
    if (d.frequency === 'weekly') return `Every ${WEEKDAYS[d.weekday] ?? 'Monday'} at ${at}${tz}`;
    return `On day ${d.monthDay} of every month at ${at}${tz}`;
}

/** What a digest covers, per frequency. */
export function periodDescription(frequency: SocialAnalyticsSettings['digest']['frequency'],): string {
    if (frequency === 'daily') return 'the previous day';
    if (frequency === 'weekly') return 'the previous 7 days';
    return 'the previous month';
}

/** "Nov 1 – Nov 7, 2026" (UTC dates YYYY-MM-DD). */
export function periodLabel(from: string, to: string,): string {
    const f = new Date(`${from}T00:00:00Z`,);
    const t = new Date(`${to}T00:00:00Z`,);
    if (Number.isNaN(f.getTime(),) || Number.isNaN(t.getTime(),)) return `${from} – ${to}`;
    const md: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC', };
    const year = (d: Date,) => d.getUTCFullYear();
    if (from === to) return f.toLocaleDateString('en-US', { ...md, year: 'numeric', },);
    const left = f.toLocaleDateString('en-US', year(f,) === year(t,) ? md : { ...md, year: 'numeric', },);
    return `${left} – ${t.toLocaleDateString('en-US', { ...md, year: 'numeric', },)}`;
}

/** Parse a comma / newline / semicolon separated address list (trimmed, unique, lower-cased). */
export function parseRecipients(text: string,): string[] {
    const seen = new Set<string>();
    for (const part of String(text ?? '',).split(/[\s,;]+/,)) {
        const a = part.trim().toLowerCase();
        if (a) seen.add(a,);
    }
    return [...seen,];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function invalidRecipients(list: string[],): string[] {
    return list.filter((a,) => !EMAIL_RE.test(a,));
}

/** UTC YYYY-MM-DD n days before today (n = 0 → today). */
export function daysAgo(n: number, now = new Date(),): string {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),),);
    d.setUTCDate(d.getUTCDate() - n,);
    return d.toISOString().slice(0, 10,);
}

/**
 * The fixed order of digest metrics. The snapshot is JSONB, which does not keep
 * object key order, so the UI never relies on it. (Engagement in a digest =
 * (likes + comments + shares) ÷ views.)
 */
export const TOTAL_KEYS = [
    'followers', 'followerChange', 'views', 'engagedViews', 'watchTimeMinutes', 'avgViewDuration',
    'likes', 'comments', 'shares', 'posts', 'avgViewsPerPost', 'engagementRate',
];

export function orderedMetricKeys(metrics: Record<string, DigestMetric>, preferred = TOTAL_KEYS,): string[] {
    const keys = Object.keys(metrics,).filter((k,) => metrics[k] && (metrics[k].value !== null || metrics[k].previous !== null));
    const first = preferred.filter((k,) => keys.includes(k,));
    return [...first, ...keys.filter((k,) => !first.includes(k,)).sort(),];
}

/** The toast after "Send email": sent / partly failed / why nothing went out. */
export function sendResultMessage(r: SocialAnalyticsDigestSendResponse,): { kind: 'success' | 'error' | 'info'; text: string; } {
    const n = (k: number,) => `${k} recipient${k === 1 ? '' : 's'}`;
    if (r.reason === 'not_ready') return { kind: 'info', text: 'The digest is not ready yet — try again when it has finished.', };
    if (!r.recipients.length || r.reason === 'no_recipients') {
        return { kind: 'info', text: 'No recipients — add addresses in Analytics → Settings → Email (or the notification type\'s email recipients).', };
    }
    const failed = r.failed ?? r.recipients.length - r.sent;
    if (!r.sent) return { kind: 'error', text: `Could not send to any of the ${n(r.recipients.length,)} (see the server log).`, };
    if (failed > 0) return { kind: 'error', text: `Emailed ${n(r.sent,)}; ${failed} failed (see the server log).`, };
    return { kind: 'success', text: `Emailed to ${n(r.sent,)}.`, };
}

export function sendResultToast(toast: { success(m: string,): void; error(m: string,): void; info(m: string,): void; }, r: SocialAnalyticsDigestSendResponse,): void {
    const m = sendResultMessage(r,);
    toast[m.kind](m.text,);
}
