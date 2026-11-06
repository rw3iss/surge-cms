/**
 * The digest as an EMAIL: table layout, inline styles, inside the branded
 * shell. Pure (digest + layout in, HTML out) so it is unit-testable and the
 * admin's "Open email version" shows exactly what is sent.
 *
 * Visual language shared with the browser view: KPI tiles with a coloured
 * change pill, platform tables, top posts with thumbnails, the AI card.
 * Trends are small bar charts made of table cells (no images — mail clients
 * block them by default, and SVG is not supported).
 */
import type { AudienceBucket, DigestData, DigestMetric, SocialAnalyticsDigest, SocialAudience, SocialPostAnalytics, } from '@sitesurge/types';
import { escapeHtml as esc, } from '../../../utils/html';
import { type BrandLayout, brandedEmail, } from '../../mail/branded';

const FONT = 'Arial,Helvetica,sans-serif';
const MUTED = '#6b7280';
const TEXT = '#111827';
const BORDER = '#e5e7eb';
const UP = '#15803d';
const UP_BG = '#dcfce7';
const DOWN = '#b91c1c';
const DOWN_BG = '#fee2e2';
const ACCENT = '#2563eb';

export const METRIC_LABELS: Record<string, string> = {
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

/** Display order (stored JSONB does not keep key order). */
export const METRIC_ORDER = Object.keys(METRIC_LABELS,);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',];

/** "Oct 30 – Nov 5, 2026" (one day: "Nov 5, 2026"). */
export function periodLabel(from: string, to: string,): string {
    const f = (d: string, year: boolean,) => {
        const [y, m, dd,] = d.split('-',).map(Number,);
        return `${MONTHS[m - 1]} ${dd}${year ? `, ${y}` : ''}`;
    };
    if (from === to) return f(to, true,);
    return `${f(from, from.slice(0, 4,) !== to.slice(0, 4,),)} – ${f(to, true,)}`;
}

/** A metric value for display. */
export function fmtValue(key: string, v: number | null,): string {
    if (v === null || v === undefined) return '—';
    if (key === 'engagementRate') return `${(v * 100).toFixed(1,)}%`;
    if (key === 'avgViewDuration') {
        const s = Math.round(v,);
        return s < 60 ? `${s}s` : `${Math.floor(s / 60,)}:${String(s % 60,).padStart(2, '0',)}`;
    }
    if (key === 'watchTimeMinutes') return v >= 120 ? `${Math.round(v / 60,).toLocaleString('en-US',)} h` : `${Math.round(v,).toLocaleString('en-US',)} min`;
    if (key === 'followerChange') return `${v > 0 ? '+' : ''}${Math.round(v,).toLocaleString('en-US',)}`;
    if (Math.abs(v,) >= 10_000) return `${(v / 1000).toFixed(v >= 100_000 ? 0 : 1,)}k`;
    return Math.round(v,).toLocaleString('en-US',);
}

/** "▲ 12%" / "▼ 3%" / "–" with its colour. */
export function changeBadge(m: DigestMetric,): { text: string; color: string; bg: string; } {
    if (m.change === null || m.change === 0) return { text: m.change === 0 ? '0%' : 'new', color: MUTED, bg: '#f3f4f6', };
    const up = m.change > 0;
    const pct = m.changePct === null ? '' : ` ${Math.abs(m.changePct * 100,) >= 100 ? Math.round(Math.abs(m.changePct * 100,),) : Math.abs(m.changePct * 100,).toFixed(1,)}%`;
    return { text: `${up ? '▲' : '▼'}${pct || ` ${Math.abs(m.change,).toLocaleString('en-US',)}`}`, color: up ? UP : DOWN, bg: up ? UP_BG : DOWN_BG, };
}

const td = (inner: string, style = '',) => `<td style="font-family:${FONT};${style}">${inner}</td>`;
const row = (inner: string, pad = '0 32px 24px',) => `<tr><td style="padding:${pad}">${inner}</td></tr>`;
const h2 = (t: string,) => `<p style="margin:0 0 10px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${MUTED}">${esc(t,)}</p>`;

function tile(key: string, m: DigestMetric,): string {
    const b = changeBadge(m,);
    return `<td width="33%" valign="top" style="padding:6px">`
        + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px"><tr>`
        + td(`<div style="font-size:22px;font-weight:700;color:${TEXT}">${esc(fmtValue(key, m.value,),)}</div>`
            + `<div style="font-size:12px;color:${MUTED};margin:2px 0 6px">${esc(METRIC_LABELS[key] ?? key,)}</div>`
            + `<span style="display:inline-block;font-size:11px;font-weight:700;color:${b.color};background:${b.bg};border-radius:999px;padding:2px 8px">${esc(b.text,)}</span>`
            + (m.previous !== null ? `<span style="font-size:11px;color:${MUTED}"> from ${esc(fmtValue(key, m.previous,),)}</span>` : ''), 'padding:12px 14px',)
        + `</tr></table></td>`;
}

function tiles(metrics: Record<string, DigestMetric>, keys: string[],): string {
    const present = keys.filter((k,) => metrics[k] && (metrics[k].value !== null || metrics[k].previous !== null),);
    let out = '';
    for (let i = 0; i < present.length; i += 3) {
        const cells = present.slice(i, i + 3,).map((k,) => tile(k, metrics[k],),);
        while (cells.length < 3) cells.push('<td width="33%"></td>',);
        out += `<tr>${cells.join('',)}</tr>`;
    }
    return out ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 -6px">${out}</table>` : '';
}

/** Daily values as a bar strip (table cells), with the first/last date. */
export function barStrip(points: Array<{ date: string; value: number; }>, color = ACCENT,): string {
    if (points.length < 2) return '';
    const vals = points.map((p,) => p.value,);
    const max = Math.max(...vals, 0,);
    const min = Math.min(...vals, 0,);
    const span = max - min || 1;
    const H = 48;
    const bars = points.slice(-60,).map((p,) => {
        const h = Math.max(2, Math.round(((p.value - min) / span) * H,),);
        return `<td valign="bottom" style="padding:0 1px"><div title="${esc(p.date,)}: ${esc(String(p.value,),)}" style="height:${h}px;background:${color};border-radius:2px 2px 0 0;font-size:0;line-height:0">&nbsp;</div></td>`;
    },).join('',);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="height:${H}px"><tr>${bars}</tr></table>`
        + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${td(esc(periodLabel(points[0].date, points[0].date,),), `font-size:11px;color:${MUTED}`,)}${td(esc(periodLabel(points[points.length - 1].date, points[points.length - 1].date,),), `font-size:11px;color:${MUTED};text-align:right`,)}</tr></table>`;
}

function platformBlock(p: DigestData['platforms'][number], withTrends: boolean, note: string | null,): string {
    const rows = METRIC_ORDER.filter((k,) => p.metrics[k],).map((k,) => [k, p.metrics[k],] as const).map(([k, m,],) => {
        const b = changeBadge(m,);
        return `<tr>${td(esc(METRIC_LABELS[k] ?? k,), `padding:6px 0;font-size:13px;color:${TEXT};border-top:1px solid ${BORDER}`,)}`
            + td(esc(fmtValue(k, m.value,),), `padding:6px 8px;font-size:13px;font-weight:700;text-align:right;border-top:1px solid ${BORDER}`,)
            + td(esc(fmtValue(k, m.previous,),), `padding:6px 8px;font-size:12px;color:${MUTED};text-align:right;border-top:1px solid ${BORDER}`,)
            + td(`<span style="color:${b.color};font-weight:700">${esc(b.text,)}</span>`, `padding:6px 0;font-size:12px;text-align:right;border-top:1px solid ${BORDER}`,)
            + `</tr>`;
    },).join('',);
    const trend = withTrends && p.series.views?.length
        ? `<p style="margin:12px 0 4px;font-family:${FONT};font-size:12px;color:${MUTED}">Views per day</p>${barStrip(p.series.views,)}`
        : '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;margin:0 0 12px"><tr><td style="padding:14px 16px">`
        + `<p style="margin:0 0 4px;font-family:${FONT};font-size:16px;font-weight:700;color:${TEXT}">${esc(p.label,)}</p>`
        + (note ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:13px;color:${TEXT}">${esc(note,)}</p>` : '')
        + (p.statusMessage ? `<p style="margin:0 0 8px;font-family:${FONT};font-size:12px;color:${MUTED}">${esc(p.statusMessage,)}</p>` : '')
        + (rows
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${td('', 'font-size:11px',)}${td('Now', `font-size:11px;color:${MUTED};text-align:right;padding:0 8px`,)}${td('Before', `font-size:11px;color:${MUTED};text-align:right;padding:0 8px`,)}${td('Change', `font-size:11px;color:${MUTED};text-align:right`,)}</tr>${rows}</table>`
            : `<p style="margin:0;font-family:${FONT};font-size:13px;color:${MUTED}">No data for this period yet.</p>`)
        + trend
        + `</td></tr></table>`;
}

const TYPE_LABELS: Record<string, string> = {
    REEL: 'Reels', POST: 'Posts', FEED: 'Posts', STORY: 'Stories', CAROUSEL_CONTAINER: 'Carousels', AD: 'Ads',
    FOLLOWER: 'Followers', NON_FOLLOWER: 'Non-followers', UNKNOWN: 'Unknown', F: 'Women', M: 'Men', U: 'Unknown',
};
const bucketLabel = (k: string,) => TYPE_LABELS[k] ?? k;

/** A labelled bar per bucket (share of the total), email-safe. */
export function shareBars(buckets: AudienceBucket[], max = 5,): string {
    return buckets.slice(0, max,).map((b,) => {
        const pct = Math.round(b.share * 100,);
        return `<tr>${td(esc(bucketLabel(b.key,),), `padding:3px 8px 3px 0;font-size:12px;color:${TEXT};white-space:nowrap;width:30%`,)}`
            + `<td style="padding:3px 0;width:55%"><div style="height:10px;width:${Math.max(2, pct,)}%;background:${ACCENT};border-radius:5px;font-size:0;line-height:0">&nbsp;</div></td>`
            + td(`${pct}%`, `padding:3px 0 3px 8px;font-size:12px;color:${MUTED};text-align:right`,)
            + `</tr>`;
    },).join('',);
}

function miniTable(title: string, rows: string,): string {
    if (!rows) return '';
    return `<p style="margin:10px 0 4px;font-family:${FONT};font-size:12px;font-weight:700;color:${MUTED}">${esc(title,)}</p>`
        + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`;
}

/** Hour → "7 PM". */
export function hourLabel(h: number,): string {
    const am = h < 12;
    const v = h % 12 === 0 ? 12 : h % 12;
    return `${v} ${am ? 'AM' : 'PM'}`;
}

function audienceBlock(a: SocialAudience, label: string,): string {
    const f = a.demographics.followers ?? a.demographics.engaged ?? a.demographics.reached;
    const parts: string[] = [];
    if (f) {
        parts.push(miniTable('Followers by age', shareBars(f.age, 6,),),);
        parts.push(miniTable('Gender', shareBars(f.gender, 3,),),);
        parts.push(miniTable('Top countries', shareBars(f.country, 5,),),);
    }
    if (a.onlineHours.length) {
        const best = [...a.onlineHours,].sort((x, y,) => y.value - x.value,).slice(0, 3,).map((h,) => hourLabel(h.hour,),);
        parts.push(`<p style="margin:10px 0 0;font-family:${FONT};font-size:13px;color:${TEXT}"><strong>Best time to post:</strong> ${esc(best.join(', ',),)} <span style="color:${MUTED}">(when most followers are online)</span></p>`,);
    }
    if (a.breakdowns.viewsByType.length) parts.push(miniTable('Views by content type', shareBars(a.breakdowns.viewsByType,),),);
    if (a.breakdowns.viewsByFollow.length) parts.push(miniTable('Views: followers vs non-followers', shareBars(a.breakdowns.viewsByFollow, 3,),),);
    if (a.stories.count) {
        parts.push(`<p style="margin:10px 0 0;font-family:${FONT};font-size:13px;color:${TEXT}"><strong>Stories:</strong> ${a.stories.count}`
            + `${a.stories.views !== null ? ` · ${esc(fmtValue('views', a.stories.views,),)} views` : ''}${a.stories.replies !== null ? ` · ${esc(fmtValue('comments', a.stories.replies,),)} replies` : ''}</p>`,);
    }
    if (a.hashtags.length) {
        const tags = a.hashtags.slice(0, 6,).map((h,) => `${esc(h.tag,)}${h.avgViews !== null ? ` <span style="color:${MUTED}">(${esc(fmtValue('views', h.avgViews,),)} avg)</span>` : ''}`,);
        parts.push(`<p style="margin:10px 0 0;font-family:${FONT};font-size:13px;color:${TEXT}"><strong>Top hashtags:</strong> ${tags.join(', ',)}</p>`,);
    }
    if (a.benchmarks.length) {
        const rows = a.benchmarks.slice(0, 6,).map((b,) => `<tr>${td(`@${esc(b.username,)}`, `padding:5px 0;font-size:13px;border-top:1px solid ${BORDER}`,)}`
            + td(esc(fmtValue('followers', b.followers,),), `padding:5px 8px;font-size:13px;text-align:right;border-top:1px solid ${BORDER}`,)
            + td(esc(fmtValue('engagementRate', b.engagementRate,),), `padding:5px 8px;font-size:12px;color:${MUTED};text-align:right;border-top:1px solid ${BORDER}`,)
            + td(b.postsPerWeek !== null ? `${b.postsPerWeek}/wk` : '—', `padding:5px 0;font-size:12px;color:${MUTED};text-align:right;border-top:1px solid ${BORDER}`,)
            + `</tr>`,).join('',);
        parts.push(miniTable('Benchmarks (followers · engagement · posts per week)', rows,),);
    }
    if (!parts.length) return '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${BORDER};border-radius:8px;margin:0 0 12px"><tr><td style="padding:14px 16px">`
        + `<p style="margin:0 0 2px;font-family:${FONT};font-size:16px;font-weight:700;color:${TEXT}">${esc(label,)}</p>`
        + parts.join('',) + `</td></tr></table>`;
}

function postRow(p: SocialPostAnalytics, why: string | undefined, rank: number,): string {
    const title = esc(p.title || '(no text)',);
    const link = p.url ? `<a href="${esc(p.url,)}" style="color:${TEXT};text-decoration:none;font-weight:700">${title}</a>` : `<strong>${title}</strong>`;
    const thumb = p.thumbnailUrl
        ? `<img src="${esc(p.thumbnailUrl,)}" width="88" height="50" alt="" style="display:block;width:88px;height:50px;object-fit:cover;border-radius:6px;border:0">`
        : `<div style="width:88px;height:50px;background:#f3f4f6;border-radius:6px"></div>`;
    const stats = [
        `${fmtValue('views', p.viewsInPeriod,)} views this period`,
        p.views !== null ? `${fmtValue('views', p.views,)} total` : '',
        p.likes !== null ? `${fmtValue('likes', p.likes,)} likes` : '',
        p.engagementRate !== null ? `${fmtValue('engagementRate', p.engagementRate,)} engagement` : '',
    ].filter(Boolean,).join(' · ',);
    return `<tr>${td(`<span style="font-size:13px;font-weight:700;color:${MUTED}">${rank}</span>`, 'padding:10px 8px 10px 0;vertical-align:top',)}`
        + `<td width="96" style="padding:10px 8px 10px 0;vertical-align:top">${thumb}</td>`
        + td(`<div style="font-size:14px;line-height:1.35">${link}</div>`
            + `<div style="font-size:12px;color:${MUTED};margin-top:3px">${esc(p.platform,)}${p.kind ? ` · ${esc(p.kind,)}` : ''} · ${esc(stats,)}</div>`
            + (why ? `<div style="font-size:12px;color:${TEXT};margin-top:4px;font-style:italic">${esc(why,)}</div>` : ''), `padding:10px 0;vertical-align:top;border-top:1px solid ${BORDER}`,)
        + `</tr>`;
}

function button(href: string, label: string,): string {
    return `<a href="${esc(href,)}" style="display:inline-block;background:${ACCENT};color:#ffffff;font-family:${FONT};font-size:14px;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:6px">${esc(label,)}</a>`;
}

const FREQ: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', manual: 'Social', };

export function digestTitle(d: Pick<SocialAnalyticsDigest, 'frequency' | 'from' | 'to'>,): string {
    return `${FREQ[d.frequency] ?? 'Social'} social analytics · ${periodLabel(d.from, d.to,)}`;
}

/**
 * Render a stored digest as an email. `summary` = headline, totals, top 3
 * posts and the button; `full` = every section the digest includes.
 */
export function renderDigestEmail(
    digest: SocialAnalyticsDigest,
    layout: BrandLayout,
    opts: { format: 'full' | 'summary'; viewUrl: string; settingsUrl: string; },
): string {
    const data = digest.data;
    const title = digestTitle(digest,);
    if (!data) return brandedEmail(row(`<p style="font-family:${FONT}">This digest has no data.</p>`, '24px 32px',), layout, { title, },);
    const full = opts.format === 'full';
    const has = (s: string,) => data.sections.includes(s as never,);
    const ins = data.ai.insights;
    const parts: string[] = [];

    parts.push(row(
        `<p style="margin:0;font-family:${FONT};font-size:22px;font-weight:700;color:${TEXT}">${esc(title,)}</p>`
        + `<p style="margin:4px 0 0;font-family:${FONT};font-size:13px;color:${MUTED}">Compared with ${esc(periodLabel(data.previousFrom, data.previousTo,),)}</p>`,
        '24px 32px 16px',
    ),);

    if (has('ai',) && ins) {
        parts.push(row(
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border-left:4px solid ${ACCENT};border-radius:6px"><tr>`
            + td(`<div style="font-size:16px;font-weight:700;color:${TEXT};line-height:1.4">${esc(ins.headline,)}</div>`
                + (full && ins.highlights.length ? `<ul style="margin:10px 0 0;padding-left:18px;font-size:14px;line-height:1.5;color:${TEXT}">${ins.highlights.map((h,) => `<li style="margin:0 0 4px">${esc(h,)}</li>`,).join('',)}</ul>` : ''), 'padding:14px 16px',)
            + `</tr></table>`,
        ),);
    }

    if (has('totals',)) {
        const keys = full ? ['followers', 'followerChange', 'views', 'likes', 'comments', 'shares', 'posts', 'watchTimeMinutes', 'engagementRate',] : ['followers', 'views', 'engagementRate',];
        const t = tiles(data.totals, keys,);
        if (t) parts.push(row(h2('All platforms',) + t,),);
    }

    if (full && has('platforms',) && data.platforms.length) {
        const notes = new Map((ins?.platforms ?? []).map((p,) => [p.platform.toLowerCase(), p.summary,]),);
        parts.push(row(h2('By platform',) + data.platforms.map((p,) => platformBlock(p, has('trends',), notes.get(p.label.toLowerCase(),) ?? notes.get(p.platform,) ?? null,),).join('',),),);
    }

    if (full && has('audience',) && data.audience?.length) {
        const labels = new Map(data.platforms.map((p,) => [p.platform, p.label,]),);
        const blocks = data.audience.map((a,) => audienceBlock(a, labels.get(a.platform,) ?? a.platform,),).join('',);
        if (blocks) parts.push(row(h2('Audience',) + blocks,),);
    }

    if (has('topPosts',) && data.topPosts.length) {
        const why = new Map((ins?.topPosts ?? []).map((p,) => [p.id, p.why,]),);
        const list = full ? data.topPosts : data.topPosts.slice(0, 3,);
        parts.push(row(h2('Top posts',)
            + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${list.map((p, i,) => postRow(p, full ? why.get(p.id,) : undefined, i + 1,),).join('',)}</table>`,),);
    }

    if (full && has('ai',) && ins?.suggestions.length) {
        parts.push(row(h2('Next steps',)
            + `<ol style="margin:0;padding-left:18px;font-family:${FONT};font-size:14px;line-height:1.5;color:${TEXT}">${ins.suggestions.map((s,) => `<li style="margin:0 0 4px">${esc(s,)}</li>`,).join('',)}</ol>`,),);
    }
    if (has('ai',) && data.ai.status === 'failed' && full) {
        parts.push(row(`<p style="margin:0;font-family:${FONT};font-size:12px;color:${MUTED}">AI insights were not available: ${esc(data.ai.error ?? 'unknown error',)}</p>`,),);
    }
    if (full && data.definitionChanges.length) {
        parts.push(row(`<p style="margin:0;font-family:${FONT};font-size:12px;color:${MUTED}">${data.definitionChanges.map((c,) => esc(`${c.platform} changed how views are counted on ${c.date}: ${c.note}`,),).join('<br>',)}</p>`,),);
    }

    parts.push(row(
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding-top:4px">${button(opts.viewUrl, full ? 'Open in the dashboard' : 'See the full digest',)}`
        + `<p style="margin:12px 0 0;font-family:${FONT};font-size:12px;color:${MUTED}"><a href="${esc(opts.settingsUrl,)}" style="color:${MUTED}">Digest settings</a></p></td></tr></table>`,
        '8px 32px 28px',
    ),);

    return brandedEmail(parts.join('',), layout, { title, preheader: ins?.headline ?? title, },);
}
