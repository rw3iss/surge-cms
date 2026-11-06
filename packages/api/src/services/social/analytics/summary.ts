/**
 * AI summary of a period: a compact digest of our own analytics (overview +
 * top posts) sent through the AI module (claude-broker by default, so no API
 * billing). The AI only sees numbers we already store.
 */
import type { AiResult, AiStatusResponse, } from '@sitesurge/types';
import * as ai from '../../ai';
import { failedResult, } from '../../ai/result';
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
    const target = await summaryTarget();
    if (!target.ok) return failedResult('broker', target.error, { meta: { reason: 'no_session', }, },);
    // ≤ 50 s over HTTP; a longer answer comes back timedOut and the admin polls the job.
    return ai.ask(prompt, { system: SYSTEM, kind: 'ANALYTICS SUMMARY', timeoutSec: 50, ...target.opts, },);
}

/** The claude-broker pool that serves analytics work (start it in Plugins → Claude Broker). */
export const ANALYTICS_POOL = 'analytics';

export const NO_SESSION_MESSAGE = 'No AI session is available for the summary. Start the "analytics" pool (or the default pool) in '
    + 'Plugins → Claude Broker → Setup → Start sessions — or add an Anthropic API key in Settings → AI.';

export type Target = { ok: true; opts: { provider: 'broker' | 'anthropic'; pool?: string; }; } | { ok: false; error: string; };

/**
 * Where the summary runs: the broker's `analytics` pool when it has an attached
 * session, else the broker's default pool, else the Anthropic API when it is
 * set up — else a clear "start a session" error instead of a job that would sit
 * in a queue nobody reads.
 */
export function pickSummaryTarget(st: AiStatusResponse, preferredPool: string = ANALYTICS_POOL,): Target {
    const pools = st.broker.reachable ? st.pools : [];
    const live = (name: string | null | undefined,) => Boolean(name) && pools.some((p,) => p.name === name && p.attached > 0);
    if (live(preferredPool,)) return { ok: true, opts: { provider: 'broker', pool: preferredPool, }, };
    if (preferredPool !== ANALYTICS_POOL && live(ANALYTICS_POOL,)) return { ok: true, opts: { provider: 'broker', pool: ANALYTICS_POOL, }, };
    if (live(st.broker.defaultPool,)) return { ok: true, opts: { provider: 'broker', pool: st.broker.defaultPool!, }, };
    const anthropic = st.providers.find((p,) => p.key === 'anthropic');
    if (anthropic?.available) return { ok: true, opts: { provider: 'anthropic', }, };
    return { ok: false, error: NO_SESSION_MESSAGE, };
}

export async function summaryTarget(preferredPool?: string,): Promise<Target> {
    try {
        return pickSummaryTarget(await ai.status(), preferredPool,);
    } catch (e) {
        return { ok: false, error: `${NO_SESSION_MESSAGE} (${(e as Error).message})`, };
    }
}
