import { A, } from '@solidjs/router';
import { type Component, createEffect, createMemo, createResource, createSignal, For, on, Show, } from 'solid-js';
import {
    type AiResult,
    SOCIAL_METRICS,
    type SocialAccountSummary,
    type SocialAnalyticsPostsQuery,
    type SocialPostAnalytics,
} from '@sitesurge/types';
import LineChart, { type ChartMarker, } from '../../../components/admin/charts/LineChart';
import Pagination from '../../../components/admin/common/Pagination';
import SortTh from '../../../components/admin/common/SortTh';
import Toggle from '../../../components/admin/common/Toggle';
import Markdown from '../../../components/common/Markdown';
import { StableSuspense, } from '../../../components/common/StableSuspense';
import { useToast, } from '../../../components/common/toast';
import { cms, } from '../../../services/cmsClient';
import AnalyticsNav from './analytics/AnalyticsNav';
import AudiencePanel from './analytics/audience/AudiencePanel';
import { audienceHasData, kindLabel, kindsPresent, } from './analytics/audience/audienceFormat';

/**
 * Social → Analytics. Everything shown is read from the CMS's own daily
 * snapshots (collected by the `social-analytics` cron or "Collect now"), so a
 * platform's history starts the day it was first collected.
 */

const PERIODS = [
    { days: 7, label: 'Last 7 days', },
    { days: 28, label: 'Last 28 days', },
    { days: 90, label: 'Last 90 days', },
    { days: 365, label: 'Last 12 months', },
];

const CHART_METRICS = [
    'followers', 'views', 'engagedViews', 'watchTimeMinutes', 'avgViewDuration', 'likes', 'comments', 'shares',
    'subscribersGained', 'subscribersLost', 'impressions', 'reach',
];

const day = (d: Date,) => d.toISOString().slice(0, 10,);

function rangeFor(days: number,): { from: string; to: string; } {
    const to = new Date();
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - (days - 1),);
    return { from: day(from,), to: day(to,), };
}

const fmtNum = (v: number | null | undefined,): string => (v === null || v === undefined ? '—' : Math.round(v,).toLocaleString());
const fmtSigned = (v: number | null | undefined,): string => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${Math.round(v,).toLocaleString()}`);
const fmtPct = (v: number | null | undefined,): string => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1,)}%`);

function fmtDuration(seconds: number | null | undefined,): string {
    if (seconds === null || seconds === undefined) return '—';
    const s = Math.round(seconds,);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60,);
    if (m < 60) return `${m}:${String(s % 60,).padStart(2, '0',)}`;
    return `${Math.floor(m / 60,)}h ${m % 60}m`;
}

function fmtMinutes(min: number | null | undefined,): string {
    if (min === null || min === undefined) return '—';
    return min >= 120 ? `${Math.round(min / 60,).toLocaleString()} h` : `${Math.round(min,).toLocaleString()} min`;
}

function metricFormatter(metric: string,): (v: number,) => string {
    if (metric === 'avgViewDuration') return (v,) => fmtDuration(v,);
    if (metric === 'watchTimeMinutes') return (v,) => fmtMinutes(v,);
    return (v,) => Math.round(v,).toLocaleString();
}

const when = (iso: string | null,) => (iso ? new Date(iso,).toLocaleString() : '—');

/** The account metrics a card shows (only those the platform gave). */
const CARD_METRICS: Array<{ key: keyof SocialAccountSummary; format: (v: number,) => string; }> = [
    { key: 'followers', format: fmtNum, },
    { key: 'followerChange', format: fmtSigned, },
    { key: 'views', format: fmtNum, },
    { key: 'engagedViews', format: fmtNum, },
    { key: 'watchTimeMinutes', format: fmtMinutes, },
    { key: 'avgViewDuration', format: fmtDuration, },
    { key: 'likes', format: fmtNum, },
    { key: 'comments', format: fmtNum, },
    { key: 'shares', format: fmtNum, },
    { key: 'posts', format: fmtNum, },
    { key: 'avgViewsPerPost', format: fmtNum, },
    { key: 'engagementRate', format: fmtPct, },
];

const Metric: Component<{ k: string; value: string; }> = (p,) => (
    <div class="social-analytics__metric" title={SOCIAL_METRICS[p.k]?.description ?? ''}>
        <div class="social-analytics__metric-value">{p.value}</div>
        <div class="social-analytics__metric-label">{SOCIAL_METRICS[p.k]?.label ?? p.k}</div>
    </div>
);

const PostHistory: Component<{ id: string; range: { from: string; to: string; }; }> = (p,) => {
    const [data,] = createResource(() => ({ id: p.id, ...p.range, }), (k,) => cms.socialAnalytics.post(k.id, { from: k.from, to: k.to, },),);
    return (
        <Show when={data()} fallback={<div class="form-help-muted">Loading…</div>}>
            {(d,) => (
                <LineChart
                    height={140}
                    points={d().points.filter((x,) => x.views !== null).map((x,) => ({ date: x.date, value: x.views ?? 0, }))}
                    emptyText="No views recorded for this post in the period."
                />
            )}
        </Show>
    );
};

const SocialAnalyticsPanel: Component = () => {
    const toast = useToast();
    const [days, setDays,] = createSignal(28,);
    const range = createMemo(() => rangeFor(days(),),);
    const [collecting, setCollecting,] = createSignal(false,);

    const [overview, { refetch: refetchOverview, },] = createResource(range, (r,) => cms.socialAnalytics.overview(r,),);

    // ── Chart ──
    const [chartPlatform, setChartPlatform,] = createSignal('',);
    const [chartMetric, setChartMetric,] = createSignal('views',);
    const withData = createMemo(() => (overview()?.accounts ?? []).filter((a,) => a.since || a.lastRun));
    createEffect(on(withData, (list,) => {
        if (!list.find((a,) => a.platform === chartPlatform()) && list[0]) setChartPlatform(list[0].platform,);
    },),);
    const [series,] = createResource(
        () => (chartPlatform() ? { platform: chartPlatform(), metric: chartMetric(), ...range(), } : null),
        (q,) => cms.socialAnalytics.series(q,),
    );
    const markers = createMemo<ChartMarker[]>(() => {
        const o = overview();
        const list: ChartMarker[] = (o?.definitionChanges ?? [])
            .filter((c,) => c.platform === chartPlatform())
            .map((c,) => ({ date: c.date, label: c.note, }));
        const since = o?.accounts.find((a,) => a.platform === chartPlatform())?.since;
        if (since && since > range().from) list.push({ date: since, label: 'Data collected from this day', },);
        return list;
    },);

    // ── Audience & content (Instagram first; any platform that reports it) ──
    const [audiencePlatform, setAudiencePlatform,] = createSignal('',);
    createEffect(on(withData, (list,) => {
        if (list.find((a,) => a.platform === audiencePlatform())) return;
        const ig = list.find((a,) => a.platform === 'instagram');
        if (ig || list[0]) setAudiencePlatform((ig ?? list[0]).platform,);
    },),);
    // An older server without /audience (or a platform with nothing) reads as "no data", not an error.
    const [audience,] = createResource(
        () => (audiencePlatform() ? { platform: audiencePlatform(), ...range(), } : null),
        (q,) => cms.socialAnalytics.audience(q,).catch(() => null),
    );

    // ── Posts table ──
    let postsSection: HTMLElement | undefined;
    const [postKind, setPostKind,] = createSignal('',);
    const [postPlatform, setPostPlatform,] = createSignal('',);
    const [search, setSearch,] = createSignal('',);
    const [inPeriod, setInPeriod,] = createSignal(false,);
    const [sort, setSort,] = createSignal('publishedAt_desc',);
    const [page, setPage,] = createSignal(1,);
    const [open, setOpen,] = createSignal<string | null>(null,);
    const postQuery = createMemo<SocialAnalyticsPostsQuery>(() => {
        const [field, dir,] = sort().split('_',);
        return {
            ...range(),
            platform: postPlatform() || undefined,
            kind: postKind() || undefined,
            search: search() || undefined,
            publishedInPeriod: inPeriod() || undefined,
            sort: field as SocialAnalyticsPostsQuery['sort'],
            dir: dir as 'asc' | 'desc',
            page: page(),
            limit: 25,
        };
    },);
    createEffect(on([postPlatform, postKind, search, inPeriod, sort, days,], () => setPage(1,), { defer: true, },),);
    const [postList, { refetch: refetchPosts, },] = createResource(postQuery, (q,) => cms.socialAnalytics.posts(q,),);

    // Kinds the posts table can filter by: what this period's posts + the audience report contain.
    // Reads `.latest` only once each resource has settled, so this toolbar never suspends a region.
    const kindOptions = createMemo(() => kindsPresent([
        ...(audience.state === 'ready' || audience.state === 'refreshing' ? audience.latest?.contentKinds ?? [] : []).map((k,) => k.kind),
        ...(postList.state === 'ready' || postList.state === 'refreshing' ? postList.latest?.data ?? [] : []).map((p,) => p.kind),
        postKind(),
    ],),);
    const showStories = () => {
        setPostPlatform(audiencePlatform(),);
        setPostKind('story',);
        postsSection?.scrollIntoView({ behavior: 'smooth', block: 'start', },);
    };

    // Search-as-you-type: a genuine filter box, debounced here.
    let searchTimer: ReturnType<typeof setTimeout> | undefined;
    const onSearch = (v: string,) => {
        clearTimeout(searchTimer,);
        searchTimer = setTimeout(() => setSearch(v.trim(),), 300,);
    };

    const collectNow = async () => {
        setCollecting(true,);
        try {
            const runs = await cms.socialAnalytics.collect();
            const failed = runs.filter((r,) => r.status === 'failed');
            if (!runs.length) toast.info('No platform is ready to collect (or a collection is already running).',);
            else if (failed.length) toast.error(`Collected ${runs.length - failed.length} of ${runs.length}; failed: ${failed.map((r,) => r.platform).join(', ',)}`,);
            else toast.success(`Collected ${runs.map((r,) => r.platform).join(', ',)}.`,);
            refetchOverview();
            refetchPosts();
        } catch (e) {
            toast.error(`Could not collect: ${(e as Error).message}`,);
        } finally {
            setCollecting(false,);
        }
    };

    // ── AI summary (AI module: claude-broker by default) ──
    const [summary, setSummary,] = createSignal<AiResult | null>(null,);
    const [summarizing, setSummarizing,] = createSignal(false,);
    const summarize = async () => {
        setSummarizing(true,);
        setSummary(null,);
        try {
            let r = await cms.socialAnalytics.summary(range(),);
            // A long answer comes back still running — keep waiting (≤ ~5 min).
            for (let i = 0; i < 6 && (r.timedOut || r.status === 'pending' || r.status === 'in_progress'); i++) {
                setSummary(r,);
                r = await cms.ai.job(r.id, { wait: 50, },);
            }
            setSummary(r,);
        } catch (e) {
            toast.error(`Could not get a summary: ${(e as Error).message}`,);
        } finally {
            setSummarizing(false,);
        }
    };

    // ── CSV export of the posts table (every page of the current filter) ──
    const [exporting, setExporting,] = createSignal(false,);
    const exportCsv = async () => {
        setExporting(true,);
        try {
            const rows: SocialPostAnalytics[] = [];
            for (let p = 1; p <= 50; p++) {
                const r = await cms.socialAnalytics.posts({ ...postQuery(), page: p, limit: 100, },);
                rows.push(...r.data,);
                if (p >= (r.meta.totalPages ?? 1)) break;
            }
            const cols: Array<keyof SocialPostAnalytics> = ['platform', 'kind', 'title', 'url', 'publishedAt', 'asOf', 'views', 'viewsInPeriod', 'viewsDay7',
                'likes', 'comments', 'shares', 'saves', 'watchTimeS', 'avgWatchS', 'completionRate', 'reach', 'impressions', 'clicks', 'engagementRate',];
            const cell = (v: unknown,) => {
                const t = v === null || v === undefined ? '' : String(v,);
                const safe = /^[=+\-@]/.test(t,) ? `'${t}` : t;
                return /[",\n]/.test(safe,) ? `"${safe.replace(/"/g, '""',)}"` : safe;
            };
            const csv = [cols.join(',',), ...rows.map((r,) => cols.map((c,) => cell(r[c],)).join(',',)),].join('\r\n',);
            const url = URL.createObjectURL(new Blob([`\ufeff${csv}`,], { type: 'text/csv;charset=utf-8', },),);
            const a = document.createElement('a',);
            a.href = url;
            a.download = `social-posts-${range().from}-${range().to}.csv`;
            a.click();
            URL.revokeObjectURL(url,);
        } catch (e) {
            toast.error(`Export failed: ${(e as Error).message}`,);
        } finally {
            setExporting(false,);
        }
    };

    const stateLabel = (s: string,) => (s === 'ready' ? 'Ready' : s === 'partial' ? 'Partial' : 'Not connected');

    return (
        <section class="social-analytics">
            <AnalyticsNav />
            <div class="social-analytics__toolbar">
                <label class="social-analytics__filter">
                    <span>Period</span>
                    <select value={days()} onChange={(e,) => setDays(Number(e.currentTarget.value,),)}>
                        <For each={PERIODS}>{(p,) => <option value={p.days}>{p.label}</option>}</For>
                    </select>
                </label>
                <span class="form-help-muted">{range().from} → {range().to}</span>
                <div class="social-analytics__actions">
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" disabled={summarizing()} onClick={summarize}>
                        {summarizing() ? 'Summarizing…' : 'AI summary'}
                    </button>
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm" disabled={collecting()} onClick={collectNow}>
                        {collecting() ? 'Collecting…' : 'Collect now'}
                    </button>
                </div>
            </div>

            <Show when={summary()}>
                {(r,) => (
                    <section class="social-analytics__summary">
                        <header>
                            <strong>AI summary</strong>
                            <span class="form-help-muted">{r().provider}{r().model ? ` · ${r().model}` : ''} · {r().status}</span>
                            <button type="button" class="btn btn--tiny" onClick={() => setSummary(null,)}>Close</button>
                        </header>
                        <Show when={r().status === 'completed'} fallback={
                            <>
                                <p class={r().status === 'failed' ? 'social-analytics__summary-error' : 'form-help-muted'}>
                                    {r().error ?? (summarizing() ? 'Waiting for the answer…' : 'No answer yet.')}
                                </p>
                                <Show when={r().meta?.reason === 'no_session'}>
                                    <p class="social-analytics__summary-links">
                                        <A href="/admin/plugins/claude-broker">Open Claude Broker setup →</A>
                                        <A href="/admin/settings?tab=ai">AI settings →</A>
                                    </p>
                                </Show>
                            </>
                        }>
                            <Markdown text={r().text} />
                        </Show>
                    </section>
                )}
            </Show>

            <Show when={overview()} fallback={<div class="form-help-muted">Loading analytics…</div>}>
                {(o,) => (
                    <>
                        <div class="social-analytics__totals">
                            <Metric k="followers" value={fmtNum(o().totals.followers,)} />
                            <Metric k="followerChange" value={fmtSigned(o().totals.followerChange,)} />
                            <Metric k="views" value={fmtNum(o().totals.views,)} />
                            <Metric k="likes" value={fmtNum(o().totals.likes,)} />
                            <Metric k="comments" value={fmtNum(o().totals.comments,)} />
                            <Metric k="shares" value={fmtNum(o().totals.shares,)} />
                            <Metric k="posts" value={fmtNum(o().totals.posts,)} />
                        </div>

                        <div class="social-analytics__accounts">
                            <For each={o().accounts}>
                                {(a,) => (
                                    <article class={`social-analytics__account social-analytics__account--${a.status.state}`}>
                                        <header class="social-analytics__account-head">
                                            <h3>{a.label}</h3>
                                            <span class={`social-analytics__state social-analytics__state--${a.status.state}`}>{stateLabel(a.status.state,)}</span>
                                        </header>
                                        <Show when={a.status.message}>
                                            <p class="social-analytics__message">{a.status.message}</p>
                                        </Show>
                                        <Show when={a.since || a.lastRun}>
                                            <div class="social-analytics__metrics">
                                                <For each={CARD_METRICS.filter((m,) => a[m.key] !== null && a[m.key] !== undefined)}>
                                                    {(m,) => <Metric k={m.key} value={m.format(a[m.key] as number,)} />}
                                                </For>
                                            </div>
                                        </Show>
                                        <footer class="social-analytics__account-foot">
                                            <span>Data since {a.since ?? '—'}</span>
                                            <Show when={a.lastRun}>
                                                {(r,) => (
                                                    <span title={[r().error, ...r().warnings,].filter(Boolean,).join('\n',)}>
                                                        Last run {when(r().finishedAt ?? r().startedAt,)} · {r().status}
                                                        {r().warnings.length ? ` (${r().warnings.length} note${r().warnings.length > 1 ? 's' : ''})` : ''}
                                                    </span>
                                                )}
                                            </Show>
                                        </footer>
                                        <Show when={a.lastRun && (a.lastRun.error || a.lastRun.warnings.length)}>
                                            <details class="social-analytics__notes">
                                                <summary>Collector notes</summary>
                                                <ul>
                                                    <Show when={a.lastRun!.error}><li class="is-error">{a.lastRun!.error}</li></Show>
                                                    <For each={a.lastRun!.warnings}>{(w,) => <li>{w}</li>}</For>
                                                </ul>
                                            </details>
                                        </Show>
                                    </article>
                                )}
                            </For>
                        </div>
                    </>
                )}
            </Show>

            <section class="admin-section social-analytics__chart">
                <header class="admin-section__header social-analytics__chart-head">
                    <h2>Trend</h2>
                    <div class="social-analytics__chart-controls">
                        <select value={chartPlatform()} onChange={(e,) => setChartPlatform(e.currentTarget.value,)}>
                            <For each={withData()}>{(a,) => <option value={a.platform}>{a.label}</option>}</For>
                        </select>
                        <select value={chartMetric()} onChange={(e,) => setChartMetric(e.currentTarget.value,)}>
                            <For each={CHART_METRICS}>{(m,) => <option value={m}>{SOCIAL_METRICS[m]?.label ?? m.replace(/([A-Z])/g, ' $1',).replace(/^./, (c,) => c.toUpperCase(),)}</option>}</For>
                        </select>
                    </div>
                </header>
                <LineChart
                    points={series()?.points ?? []}
                    markers={markers()}
                    format={metricFormatter(chartMetric(),)}
                    emptyText={chartPlatform() ? 'No data for this metric in the period. Some metrics need more access (see the platform card).' : 'No platform has been collected yet — press Collect now.'}
                />
            </section>

            <section class="admin-section social-analytics__audience">
                <header class="admin-section__header social-analytics__audience-head">
                    <div>
                        <h2>Audience &amp; content</h2>
                        <p class="form-help-muted">Who follows and engages, when they are online, which content types win, hashtags and benchmark accounts.</p>
                    </div>
                    <select value={audiencePlatform()} onChange={(e,) => setAudiencePlatform(e.currentTarget.value,)} aria-label="Platform">
                        <For each={withData()}>{(a,) => <option value={a.platform}>{a.label}</option>}</For>
                    </select>
                </header>
                <StableSuspense fallback={<p class="form-help-muted">Loading audience…</p>}>
                    <Show
                        when={audience()}
                        fallback={<p class="form-help-muted">{audiencePlatform() ? 'No audience data for this platform yet.' : 'No platform has been collected yet — press Collect now.'}</p>}
                    >
                        {(a,) => (
                            <Show when={audienceHasData(a(),) || a().capabilities} fallback={<p class="form-help-muted">No audience or content data for this platform in the period yet.</p>}>
                                <AudiencePanel audience={a()} onShowStories={showStories} />
                            </Show>
                        )}
                    </Show>
                </StableSuspense>
            </section>

            <section class="admin-section" ref={postsSection}>
                <header class="admin-section__header">
                    <h2>Posts</h2>
                    <p class="form-help-muted">Each post's latest numbers. "In period" = views gained between the period's first and last snapshot; "Day 7" = views a week after publishing.</p>
                </header>
                <div class="social-analytics__toolbar">
                    <label class="social-analytics__filter">
                        <span>Platform</span>
                        <select value={postPlatform()} onChange={(e,) => setPostPlatform(e.currentTarget.value,)}>
                            <option value="">All</option>
                            <For each={withData()}>{(a,) => <option value={a.platform}>{a.label}</option>}</For>
                        </select>
                    </label>
                    <Show when={kindOptions().length}>
                        <label class="social-analytics__filter">
                            <span>Kind</span>
                            <select value={postKind()} onChange={(e,) => setPostKind(e.currentTarget.value,)}>
                                <option value="">All</option>
                                <For each={kindOptions()}>{(k,) => <option value={k}>{kindLabel(k,)}</option>}</For>
                            </select>
                        </label>
                    </Show>
                    <label class="social-analytics__filter">
                        <span>Search</span>
                        <input type="search" placeholder="Text in the post" onInput={(e,) => onSearch(e.currentTarget.value,)} />
                    </label>
                    <Toggle checked={inPeriod()} onChange={setInPeriod} label="Published in the period" size="sm" />
                    <button type="button" class="ui-button ui-button--secondary ui-button--sm social-analytics__export" disabled={exporting()} onClick={exportCsv}>
                        {exporting() ? 'Exporting…' : 'Export CSV'}
                    </button>
                </div>
                <div class="social-analytics__table-wrap">
                    <table class="admin-table social-analytics__table">
                        <thead>
                            <tr>
                                <th>Post</th>
                                <SortTh label="Published" field="publishedAt" current={sort()} onSort={setSort} />
                                <SortTh label="Views" field="views" current={sort()} onSort={setSort} />
                                <SortTh label="In period" field="viewsInPeriod" current={sort()} onSort={setSort} />
                                <th title="Views 7 days after publishing">Day 7</th>
                                <SortTh label="Likes" field="likes" current={sort()} onSort={setSort} />
                                <SortTh label="Comments" field="comments" current={sort()} onSort={setSort} />
                                <SortTh label="Shares" field="shares" current={sort()} onSort={setSort} />
                                <SortTh label="Watch time" field="watchTimeS" current={sort()} onSort={setSort} />
                                <th title="Average view duration">Avg view</th>
                                <SortTh label="Impr." field="impressions" current={sort()} onSort={setSort} />
                                <SortTh label="Eng. rate" field="engagementRate" current={sort()} onSort={setSort} />
                            </tr>
                        </thead>
                        <tbody>
                            <Show when={postList()?.data.length} fallback={<tr><td colSpan={12} class="form-help-muted">{postList.loading ? 'Loading…' : 'No post metrics yet.'}</td></tr>}>
                                <For each={postList()!.data}>
                                    {(p: SocialPostAnalytics,) => (
                                        <>
                                            <tr class="social-analytics__row" onClick={() => setOpen(open() === p.id ? null : p.id,)}>
                                                <td class="social-analytics__post">
                                                    <Show when={p.thumbnailUrl} fallback={<span class="social-analytics__thumb social-analytics__thumb--empty" />}>
                                                        <img class="social-analytics__thumb" src={p.thumbnailUrl!} alt="" loading="lazy" />
                                                    </Show>
                                                    <div>
                                                        <div class="social-analytics__post-title">
                                                            <Show when={p.url} fallback={p.title || '(no text)'}>
                                                                <a href={p.url!} target="_blank" rel="noopener noreferrer" onClick={(e,) => e.stopPropagation()}>{p.title || '(no text)'}</a>
                                                            </Show>
                                                        </div>
                                                        <div class="form-help-muted">{p.platform}{p.kind ? ` · ${p.kind}` : ''}</div>
                                                    </div>
                                                </td>
                                                <td>{p.publishedAt ? new Date(p.publishedAt,).toLocaleDateString() : '—'}</td>
                                                <td>{fmtNum(p.views,)}</td>
                                                <td>{fmtNum(p.viewsInPeriod,)}</td>
                                                <td>{fmtNum(p.viewsDay7,)}</td>
                                                <td>{fmtNum(p.likes,)}</td>
                                                <td>{fmtNum(p.comments,)}</td>
                                                <td>{fmtNum(p.shares,)}</td>
                                                <td>{p.watchTimeS === null ? '—' : fmtMinutes(p.watchTimeS / 60,)}</td>
                                                <td>{fmtDuration(p.avgWatchS,)}{p.completionRate !== null ? ` (${fmtPct(p.completionRate,)})` : ''}</td>
                                                <td>{fmtNum(p.impressions,)}</td>
                                                <td>{fmtPct(p.engagementRate,)}</td>
                                            </tr>
                                            <Show when={open() === p.id}>
                                                <tr class="social-analytics__detail">
                                                    <td colSpan={12}><PostHistory id={p.id} range={range()} /></td>
                                                </tr>
                                            </Show>
                                        </>
                                    )}
                                </For>
                            </Show>
                        </tbody>
                    </table>
                </div>
                <Pagination
                    page={page()}
                    totalPages={postList()?.meta.totalPages ?? 1}
                    total={postList()?.meta.total}
                    limit={25}
                    onPageChange={setPage}
                />
            </section>
        </section>
    );
};

export default SocialAnalyticsPanel;
