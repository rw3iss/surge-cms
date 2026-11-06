/**
 * One analytics digest "in the browser" — rendered from the snapshot the digest
 * stored, so it reads the same months later. Same visual language as the email
 * (KPI tiles, ▲▼ deltas, tables) plus charts, collapsible platform cards and
 * the AI notes beside the posts they explain.
 */
import type { DigestData, DigestMetric, DigestPlatform, SocialAnalyticsDigest, } from '@sitesurge/types';
import { A, useNavigate, useParams, } from '@solidjs/router';
import { type Component, createEffect, createMemo, createResource, createSignal, For, type JSX, onCleanup, Show, } from 'solid-js';
import LineChart from '../../../../components/admin/charts/LineChart';
import AdminTitle from '../../../../components/admin/common/AdminTitle';
import ConfirmModal from '../../../../components/admin/common/ConfirmModal';
import { StableSuspense, } from '../../../../components/common/StableSuspense';
import { useToast, } from '../../../../components/common/toast';
import { cms, } from '../../../../services/cmsClient';
import AnalyticsNav from './AnalyticsNav';
import { StatusBadge, } from './DigestsPage';
import { deltaText, deltaTone, fmtMetric, fmtNum, fmtPct, metricLabel, orderedMetricKeys, periodLabel, } from './digestFormat';

const when = (iso: string | null,) => (iso ? new Date(iso,).toLocaleString() : '—');

/** A ▲▼ delta, colored by direction. */
export const Delta: Component<{ k: string; m: DigestMetric | undefined; }> = (p,) => (
    <Show when={deltaText(p.k, p.m,)}>
        <span class={`digest-delta digest-delta--${deltaTone(p.m,)}`}>{deltaText(p.k, p.m,)}</span>
    </Show>
);

const Kpi: Component<{ k: string; m: DigestMetric; }> = (p,) => (
    <div class="digest-kpi">
        <div class="digest-kpi__label">{metricLabel(p.k,)}</div>
        <div class="digest-kpi__value">{fmtMetric(p.k, p.m.value,)}</div>
        <div class="digest-kpi__foot">
            <Delta k={p.k} m={p.m} />
            <Show when={p.m.previous !== null}>
                <span class="digest-kpi__prev">was {fmtMetric(p.k, p.m.previous,)}</span>
            </Show>
        </div>
    </div>
);

/** A collapsible card with a controlled open state. */
const Card: Component<{ title: JSX.Element; aside?: JSX.Element; open: boolean; onToggle: () => void; children: JSX.Element; class?: string; }> = (p,) => (
    <section class={`digest-card${p.open ? ' is-open' : ''} ${p.class ?? ''}`}>
        <header class="digest-card__head">
            <button type="button" class="digest-card__toggle" aria-expanded={p.open} onClick={p.onToggle}>
                <span class="digest-card__chevron" aria-hidden="true">▸</span>
                <span class="digest-card__title">{p.title}</span>
            </button>
            <Show when={p.aside}><div class="digest-card__aside">{p.aside}</div></Show>
        </header>
        <Show when={p.open}>
            <div class="digest-card__body">{p.children}</div>
        </Show>
    </section>
);

const PlatformTrends: Component<{ platform: DigestPlatform; data: DigestData; }> = (p,) => {
    const keys = () => Object.keys(p.platform.series,).filter((k,) => (p.platform.series[k] ?? []).length);
    const [metric, setMetric,] = createSignal('',);
    const current = () => (keys().includes(metric(),) ? metric() : keys().includes('views',) ? 'views' : keys()[0] ?? '');
    const markers = () => p.data.definitionChanges.filter((c,) => c.platform === p.platform.platform).map((c,) => ({ date: c.date, label: c.note, }));
    return (
        <Show when={keys().length} fallback={<p class="form-help-muted">No daily series for this period.</p>}>
            <div class="digest-trends">
                <div class="digest-trends__switch" role="tablist">
                    <For each={keys()}>
                        {(k,) => (
                            <button type="button" role="tab" aria-selected={current() === k} class={`digest-chip${current() === k ? ' is-active' : ''}`} onClick={() => setMetric(k,)}>
                                {metricLabel(k,)}
                            </button>
                        )}
                    </For>
                </div>
                <LineChart
                    height={180}
                    points={p.platform.series[current()] ?? []}
                    markers={markers()}
                    format={(v,) => fmtMetric(current(), v,)}
                />
            </div>
        </Show>
    );
};

const DigestBody: Component<{ digest: SocialAnalyticsDigest; data: DigestData; }> = (props,) => {
    const has = (s: DigestData['sections'][number],) => props.data.sections.includes(s,);
    const ids = createMemo(() => ['ai', 'totals', ...props.data.platforms.map((p,) => `p:${p.platform}`), 'topPosts', 'notes',],);
    const [open, setOpen,] = createSignal<Record<string, boolean>>(Object.fromEntries(ids().map((id,) => [id, true,]),),);
    const isOpen = (id: string,) => open()[id] !== false;
    const toggle = (id: string,) => setOpen((cur,) => ({ ...cur, [id]: !isOpen(id,), }));
    const setAll = (v: boolean,) => setOpen(Object.fromEntries(ids().map((id,) => [id, v,]),),);
    const insights = () => props.data.ai.insights;
    const why = (postId: string,) => insights()?.topPosts.find((t,) => t.id === postId)?.why ?? null;
    const platformNote = (platform: string,) => insights()?.platforms.find((x,) => x.platform.toLowerCase() === platform.toLowerCase())?.summary ?? null;

    return (
        <>
            <div class="digest-view__expand">
                <button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={() => setAll(true,)}>Expand all</button>
                <button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={() => setAll(false,)}>Collapse all</button>
            </div>

            {/* ── AI insights ── */}
            <Show when={has('ai',)}>
                <Card
                    class="digest-card--ai"
                    title="AI insights"
                    aside={<Show when={props.data.ai.provider}><span class="form-help-muted">{props.data.ai.provider}{props.data.ai.pool ? ` · ${props.data.ai.pool}` : ''}</span></Show>}
                    open={isOpen('ai',)}
                    onToggle={() => toggle('ai',)}
                >
                    <Show
                        when={props.data.ai.status === 'ok' && insights()}
                        fallback={
                            <>
                                <p class={props.data.ai.status === 'failed' ? 'digest-ai__error' : 'form-help-muted'}>
                                    {props.data.ai.status === 'failed'
                                        ? props.data.ai.error ?? 'The AI insights could not be written.'
                                        : props.data.ai.error ?? 'AI insights were not requested for this digest.'}
                                </p>
                                <Show when={props.data.ai.status === 'failed'}>
                                    <p class="digest-ai__links">
                                        <A href="/admin/plugins/claude-broker">Claude Broker setup →</A>
                                        <A href="/admin/settings?tab=ai">AI settings →</A>
                                    </p>
                                </Show>
                            </>
                        }
                    >
                        {(ins,) => (
                            <div class="digest-ai">
                                <p class="digest-ai__headline">{ins().headline}</p>
                                <Show when={ins().highlights.length}>
                                    <h4>What changed</h4>
                                    <ul class="digest-ai__list"><For each={ins().highlights}>{(h,) => <li>{h}</li>}</For></ul>
                                </Show>
                                <Show when={ins().platforms.length}>
                                    <h4>By platform</h4>
                                    <dl class="digest-ai__platforms">
                                        <For each={ins().platforms}>{(x,) => <><dt>{x.platform}</dt><dd>{x.summary}</dd></>}</For>
                                    </dl>
                                </Show>
                                <Show when={ins().suggestions.length}>
                                    <h4>Next steps</h4>
                                    <ol class="digest-ai__list"><For each={ins().suggestions}>{(h,) => <li>{h}</li>}</For></ol>
                                </Show>
                            </div>
                        )}
                    </Show>
                </Card>
            </Show>

            {/* ── Totals ── */}
            <Show when={has('totals',)}>
                <Card title="Totals" aside={<span class="form-help-muted">all platforms</span>} open={isOpen('totals',)} onToggle={() => toggle('totals',)}>
                    <Show when={orderedMetricKeys(props.data.totals,).length} fallback={<p class="form-help-muted">No data for this period.</p>}>
                        <div class="digest-kpis">
                            <For each={orderedMetricKeys(props.data.totals,)}>{(k,) => <Kpi k={k} m={props.data.totals[k]!} />}</For>
                        </div>
                    </Show>
                </Card>
            </Show>

            {/* ── Per platform (+ trends) ── */}
            <Show when={has('platforms',) || has('trends',)}>
                <Show when={props.data.platforms.length} fallback={<p class="form-help-muted">No platform had data for this period.</p>}>
                    <For each={props.data.platforms}>
                        {(p,) => (
                            <Card
                                title={<>{p.label}<Show when={p.status !== 'ready'}><span class={`digest-platform-state digest-platform-state--${p.status}`}>{p.status === 'off' ? 'not connected' : 'partial'}</span></Show></>}
                                aside={<span class="form-help-muted">{p.since ? `data since ${p.since}` : 'no data yet'}</span>}
                                open={isOpen(`p:${p.platform}`,)}
                                onToggle={() => toggle(`p:${p.platform}`,)}
                            >
                                <Show when={platformNote(p.label,) || platformNote(p.platform,)}>
                                    <p class="digest-platform__note">{platformNote(p.label,) || platformNote(p.platform,)}</p>
                                </Show>
                                <Show when={p.statusMessage}><p class="form-help-muted">{p.statusMessage}</p></Show>
                                <Show when={has('platforms',)}>
                                    <Show when={orderedMetricKeys(p.metrics,).length} fallback={<p class="form-help-muted">No numbers for this period.</p>}>
                                        <div class="digest-table-wrap">
                                            <table class="digest-table">
                                                <thead><tr><th>Metric</th><th>This period</th><th>Previous</th><th>Change</th></tr></thead>
                                                <tbody>
                                                    <For each={orderedMetricKeys(p.metrics,)}>
                                                        {(k,) => (
                                                            <tr>
                                                                <td>{metricLabel(k,)}</td>
                                                                <td class="num">{fmtMetric(k, p.metrics[k]!.value,)}</td>
                                                                <td class="num">{fmtMetric(k, p.metrics[k]!.previous,)}</td>
                                                                <td class="num"><Delta k={k} m={p.metrics[k]} /></td>
                                                            </tr>
                                                        )}
                                                    </For>
                                                </tbody>
                                            </table>
                                        </div>
                                    </Show>
                                </Show>
                                <Show when={has('trends',)}>
                                    <PlatformTrends platform={p} data={props.data} />
                                </Show>
                            </Card>
                        )}
                    </For>
                </Show>
            </Show>

            {/* ── Top posts ── */}
            <Show when={has('topPosts',)}>
                <Card title={`Top posts (${props.data.topPosts.length})`} aside={<span class="form-help-muted">by views gained in the period</span>} open={isOpen('topPosts',)} onToggle={() => toggle('topPosts',)}>
                    <Show when={props.data.topPosts.length} fallback={<p class="form-help-muted">No post had metrics in this period.</p>}>
                        <ol class="digest-posts">
                            <For each={props.data.topPosts}>
                                {(post, i,) => (
                                    <li class="digest-post">
                                        <span class="digest-post__rank">{i() + 1}</span>
                                        <Show when={post.thumbnailUrl} fallback={<span class="digest-post__thumb digest-post__thumb--empty" />}>
                                            <img class="digest-post__thumb" src={post.thumbnailUrl!} alt="" loading="lazy" />
                                        </Show>
                                        <div class="digest-post__main">
                                            <div class="digest-post__title">
                                                <Show when={post.url} fallback={post.title || '(no text)'}>
                                                    <a href={post.url!} target="_blank" rel="noopener noreferrer">{post.title || '(no text)'}</a>
                                                </Show>
                                            </div>
                                            <div class="digest-post__meta">
                                                {post.platform}{post.kind ? ` · ${post.kind}` : ''}{post.publishedAt ? ` · ${new Date(post.publishedAt,).toLocaleDateString()}` : ''}
                                            </div>
                                            <Show when={why(post.id,)}><p class="digest-post__why">💡 {why(post.id,)}</p></Show>
                                        </div>
                                        <dl class="digest-post__stats">
                                            <div><dt>In period</dt><dd>{fmtNum(post.viewsInPeriod,)}</dd></div>
                                            <div><dt>Views</dt><dd>{fmtNum(post.views,)}</dd></div>
                                            <div><dt>Day 7</dt><dd>{fmtNum(post.viewsDay7,)}</dd></div>
                                            <div><dt>Likes</dt><dd>{fmtNum(post.likes,)}</dd></div>
                                            <div><dt>Comments</dt><dd>{fmtNum(post.comments,)}</dd></div>
                                            <div><dt>Eng.</dt><dd>{fmtPct(post.engagementRate,)}</dd></div>
                                        </dl>
                                    </li>
                                )}
                            </For>
                        </ol>
                    </Show>
                </Card>
            </Show>

            <Show when={props.data.definitionChanges.length}>
                <Card title="Notes" open={isOpen('notes',)} onToggle={() => toggle('notes',)}>
                    <ul class="digest-notes">
                        <For each={props.data.definitionChanges}>{(c,) => <li><strong>{c.date}</strong> · {c.platform}: {c.note}</li>}</For>
                    </ul>
                </Card>
            </Show>
        </>
    );
};

const DigestView: Component = () => {
    const params = useParams<{ id: string; }>();
    const navigate = useNavigate();
    const toast = useToast();
    const [digest, { refetch, mutate, },] = createResource(() => params.id, (id,) => cms.socialAnalytics.digest(id,),);

    // A new digest comes back 'generating' (AI insights can take up to a minute):
    // poll every 3 s until it is ready or failed. `mutate` swaps the value in place,
    // so the page does not flash a loading state on each poll.
    let poll: ReturnType<typeof setTimeout> | undefined;
    createEffect(() => {
        const d = digest();
        clearTimeout(poll,);
        if (!d || d.status !== 'generating') return;
        poll = setTimeout(async () => {
            try {
                mutate(await cms.socialAnalytics.digest(d.id,),);
            } catch { /* transient — the next tick tries again */ }
        }, 3000,);
    },);
    onCleanup(() => clearTimeout(poll,),);
    const [emailFormat, setEmailFormat,] = createSignal<'full' | 'summary'>('full',);
    const [sending, setSending,] = createSignal(false,);
    const [confirmDelete, setConfirmDelete,] = createSignal(false,);
    const [deleting, setDeleting,] = createSignal(false,);

    const send = async () => {
        setSending(true,);
        try {
            const r = await cms.socialAnalytics.sendDigest(params.id,);
            toast.success(r.sent ? `Emailed to ${r.sent} recipient${r.sent === 1 ? '' : 's'}` : 'No recipients — add them in Settings',);
            refetch();
        } catch (e) {
            toast.error(`Could not email it: ${(e as Error).message}`,);
        } finally {
            setSending(false,);
        }
    };

    const remove = async () => {
        setDeleting(true,);
        try {
            await cms.socialAnalytics.deleteDigest(params.id,);
            toast.success('Digest deleted',);
            navigate('/admin/social/analytics/digests',);
        } catch (e) {
            toast.error(`Could not delete it: ${(e as Error).message}`,);
            setDeleting(false,);
        }
    };

    const openEmail = () => window.open(cms.socialAnalytics.digestEmailUrl(params.id, emailFormat(),), '_blank', 'noopener',);

    return (
        <section class="digest-view">
            <AdminTitle>Analytics Digest</AdminTitle>
            <AnalyticsNav
                actions={
                    <div class="digest-view__toolbar">
                        <A href="/admin/social/analytics/digests" class="ui-button ui-button--ghost ui-button--sm">← All digests</A>
                        <span class="digest-view__email-version">
                            <select value={emailFormat()} onChange={(e,) => setEmailFormat(e.currentTarget.value as 'full' | 'summary',)} aria-label="Email version">
                                <option value="full">Full email</option>
                                <option value="summary">Summary email</option>
                            </select>
                            <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={openEmail}>Open email version</button>
                        </span>
                        <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => window.print()}>Print</button>
                        <button type="button" class="ui-button ui-button--secondary ui-button--sm" disabled={sending() || digest()?.status !== 'ready'} onClick={send}>
                            {sending() ? 'Sending…' : 'Email again'}
                        </button>
                        <button type="button" class="ui-button ui-button--danger ui-button--sm" onClick={() => setConfirmDelete(true,)}>Delete</button>
                    </div>
                }
            />

            <StableSuspense fallback={<p class="form-help-muted">Loading the digest…</p>}>
                <Show when={digest()} fallback={<Show when={digest.error}><div class="alert alert--error">{(digest.error as Error)?.message}</div></Show>}>
                    {(d,) => (
                        <article class="digest-doc">
                            <header class="digest-doc__head">
                                <div class="digest-doc__eyebrow">Social analytics digest</div>
                                <h2 class="digest-doc__title">{periodLabel(d().from, d().to,)}</h2>
                                <div class="digest-doc__meta">
                                    <StatusBadge status={d().status} />
                                    <Show when={d().data}>
                                        {(data,) => <span>compared with {periodLabel(data().previousFrom, data().previousTo,)}</span>}
                                    </Show>
                                    <span>{d().trigger === 'schedule' ? `Scheduled (${d().frequency})` : 'Generated by hand'} · {when(d().createdAt,)}</span>
                                    <Show when={d().emailedAt}><span>Emailed to {d().emailCount} · {when(d().emailedAt,)}</span></Show>
                                </div>
                                <Show when={d().error}><div class="alert alert--error">{d().error}</div></Show>
                            </header>
                            <Show
                                when={d().data}
                                fallback={
                                    <Show when={d().status === 'generating'} fallback={<p class="form-help-muted">This digest has no data.</p>}>
                                        <div class="digest-doc__generating"><span class="digest-doc__spinner" aria-hidden="true" />Generating the digest — collecting the numbers and writing the AI insights (up to a minute)…</div>
                                    </Show>
                                }
                            >
                                {(data,) => <DigestBody digest={d()} data={data()} />}
                            </Show>
                        </article>
                    )}
                </Show>
            </StableSuspense>

            <ConfirmModal
                open={confirmDelete()}
                title="Delete this digest?"
                message="The digest and its data snapshot are deleted. The analytics data itself is kept."
                confirmLabel="Delete"
                busyLabel="Deleting…"
                loading={deleting()}
                danger
                onConfirm={remove}
                onCancel={() => setConfirmDelete(false,)}
            />
        </section>
    );
};

export default DigestView;
