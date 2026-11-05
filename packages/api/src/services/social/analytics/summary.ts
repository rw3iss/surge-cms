/**
 * AI summary of a period: a compact digest of our own analytics (overview +
 * top posts) sent through the AI module (claude-broker by default, so no API
 * billing). The AI only sees numbers we already store.
 */
import type { AiResult, } from '@sitesurge/types';
import * as ai from '../../ai';
import { overview, posts, resolveRange, } from './read';

const SYSTEM = 'You are a social media analyst for a news/media organisation. Write in plain, short American English. '
    + 'Use only the numbers given; never invent figures. Note when a platform has little or no data.';

/** The digest the model sees (exported for tests / previews). */
export async function summaryDigest(range: { from?: string; to?: string; },): Promise<string> {
    const r = resolveRange(range.from, range.to,);
    const o = await overview(r,);
    const top = await posts({ ...r, sort: 'viewsInPeriod', dir: 'desc', limit: 10, },);
    const accounts = o.accounts
        .filter((a,) => a.since || a.lastRun)
        .map((a,) => ({
            platform: a.label,
            dataSince: a.since,
            followers: a.followers,
            followerChange: a.followerChange,
            views: a.views,
            engagedViews: a.engagedViews,
            watchTimeMinutes: a.watchTimeMinutes,
            avgViewDurationSec: a.avgViewDuration,
            likes: a.likes,
            comments: a.comments,
            shares: a.shares,
            postsPublished: a.posts,
            avgViewsPerPost: a.avgViewsPerPost,
            engagementRate: a.engagementRate,
            collectorNote: a.status.message,
        }));
    const topPosts = top.data.map((p,) => ({
        platform: p.platform,
        kind: p.kind,
        title: p.title,
        published: p.publishedAt?.slice(0, 10,),
        views: p.views,
        viewsInPeriod: p.viewsInPeriod,
        viewsDay7: p.viewsDay7,
        likes: p.likes,
        comments: p.comments,
        shares: p.shares,
        avgWatchSec: p.avgWatchS,
        engagementRate: p.engagementRate,
    }));
    return JSON.stringify({ period: r, accounts, topPosts, definitionChanges: o.definitionChanges, },);
}

export async function summarize(range: { from?: string; to?: string; },): Promise<AiResult> {
    const digest = await summaryDigest(range,);
    const prompt = [
        'Summarize this social media performance for the period in Markdown:',
        '1. **Headline** — one sentence.',
        '2. **What changed** — 3–5 bullets (growth, views, engagement, per platform).',
        '3. **Top posts** — the 3 best and why they may have worked (format, topic, timing).',
        '4. **Next steps** — 2–3 concrete suggestions.',
        '',
        'Data (JSON):',
        digest,
    ].join('\n',);
    // ≤ 50 s over HTTP; a longer answer comes back timedOut and the admin polls the job.
    return ai.ask(prompt, { system: SYSTEM, kind: 'ANALYTICS SUMMARY', timeoutSec: 50, },);
}
