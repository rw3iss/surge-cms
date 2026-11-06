/**
 * Audience & content for one platform — shared by the analytics dashboard and
 * the in-browser digest. Renders only the blocks that have data; the missing
 * ones collapse into one short "not available" list explaining why (from the
 * collector's `capabilities`).
 */
import type { AudienceBucket, AudienceDemographics, SocialAudience, } from '@sitesurge/types';
import { A, } from '@solidjs/router';
import { type Component, createMemo, createSignal, For, type JSX, Show, } from 'solid-js';
import { fmtNum, fmtPct, } from '../digestFormat';
import {
    ageOrder,
    type AudienceBlock,
    bestHours,
    countryName,
    flagEmoji,
    followLabel,
    fullDay,
    genderLabel,
    hasDemographics,
    type HashtagSort,
    hourLabel,
    kindLabel,
    missingNote,
    sortHashtags,
    topN,
    typeLabel,
    withShares,
} from './audienceFormat';

// ── Small charts ─────────────────────────────────────────────────────────────

/** Horizontal bars: label · bar · value · share. */
export const BarList: Component<{ items: AudienceBucket[]; label?: (key: string,) => JSX.Element | string; empty?: string; }> = (p,) => {
    const max = () => Math.max(0, ...p.items.map((b,) => b.value),);
    return (
        <Show when={p.items.length} fallback={<p class="form-help-muted">{p.empty ?? 'No data.'}</p>}>
            <ul class="aud-bars">
                <For each={p.items}>
                    {(b,) => (
                        <li class="aud-bars__row">
                            <span class="aud-bars__label" title={b.key}>{p.label ? p.label(b.key,) : b.key}</span>
                            <span class="aud-bars__track"><span class="aud-bars__fill" style={{ width: `${max() ? (b.value / max()) * 100 : 0}%`, }} /></span>
                            <span class="aud-bars__value">{fmtNum(b.value,)}</span>
                            <span class="aud-bars__share">{fmtPct(b.share, 0,)}</span>
                        </li>
                    )}
                </For>
            </ul>
        </Show>
    );
};

/** One bar split by share (followers vs non-followers, women vs men…). */
export const SplitBar: Component<{ items: AudienceBucket[]; label: (key: string,) => string; title?: string; }> = (p,) => {
    const items = () => withShares(p.items,);
    return (
        <Show when={items().length}>
            <div class="aud-split">
                <Show when={p.title}><div class="aud-split__title">{p.title}</div></Show>
                <div class="aud-split__bar" role="img" aria-label={items().map((b,) => `${p.label(b.key,)} ${fmtPct(b.share, 0,)}`).join(', ',)}>
                    <For each={items()}>
                        {(b, i,) => <span class={`aud-split__seg aud-split__seg--${i() % 4}`} style={{ width: `${b.share * 100}%`, }} title={`${p.label(b.key,)}: ${fmtNum(b.value,)}`} />}
                    </For>
                </div>
                <ul class="aud-split__legend">
                    <For each={items()}>
                        {(b, i,) => (
                            <li><span class={`aud-split__dot aud-split__seg--${i() % 4}`} />{p.label(b.key,)} <strong>{fmtPct(b.share, 0,)}</strong> <span class="form-help-muted">({fmtNum(b.value,)})</span></li>
                        )}
                    </For>
                </ul>
            </div>
        </Show>
    );
};

/** 24 hour columns of average followers online; the best hours highlighted. */
export const HourBars: Component<{ hours: Array<{ hour: number; value: number; }>; }> = (p,) => {
    const day = () => fullDay(p.hours,);
    const best = () => bestHours(p.hours, 3,);
    const max = () => Math.max(0, ...day().map((h,) => h.value),);
    return (
        <div class="aud-hours">
            <div class="aud-hours__chart" role="img" aria-label={`Best hours: ${best().map(hourLabel,).join(', ',)}`}>
                <For each={day()}>
                    {(h,) => (
                        <div class={`aud-hours__col${best().includes(h.hour,) ? ' is-best' : ''}`} title={`${hourLabel(h.hour,)}: ${fmtNum(h.value,)} online`}>
                            <span class="aud-hours__bar" style={{ height: `${max() ? Math.max(2, (h.value / max()) * 100,) : 2}%`, }} />
                            <span class="aud-hours__tick">{h.hour % 3 === 0 ? hourLabel(h.hour,).replace(' ', '',) : ''}</span>
                        </div>
                    )}
                </For>
            </div>
            <p class="aud-hours__best">
                Best hours: <For each={best()}>{(h, i,) => <><strong>{hourLabel(h,)}</strong>{i() < best().length - 1 ? ', ' : ''}</>}</For>
                <span class="form-help-muted"> — hours as reported by Instagram (the account's time zone).</span>
            </p>
        </div>
    );
};

// ── Blocks ───────────────────────────────────────────────────────────────────

const Block: Component<{ title: string; aside?: JSX.Element; children: JSX.Element; wide?: boolean; }> = (p,) => (
    <section class={`aud-block${p.wide ? ' aud-block--wide' : ''}`}>
        <header class="aud-block__head">
            <h3>{p.title}</h3>
            <Show when={p.aside}><div class="aud-block__aside">{p.aside}</div></Show>
        </header>
        {p.children}
    </section>
);

type DemoTab = 'followers' | 'engaged' | 'reached';
const DEMO_TABS: Array<{ key: DemoTab; label: string; }> = [
    { key: 'followers', label: 'Followers', },
    { key: 'engaged', label: 'Engaged', },
    { key: 'reached', label: 'Reached', },
];

const Demographics: Component<{ demographics: SocialAudience['demographics']; }> = (p,) => {
    const tabs = () => DEMO_TABS.filter((t,) => hasDemographics(p.demographics[t.key],));
    const [tab, setTab,] = createSignal<DemoTab>('followers',);
    const current = (): DemoTab => (tabs().some((t,) => t.key === tab()) ? tab() : tabs()[0]?.key ?? 'followers');
    const d = (): AudienceDemographics | null => p.demographics[current()];
    return (
        <Block
            title="Demographics"
            wide
            aside={
                <div class="aud-tabs" role="tablist">
                    <For each={tabs()}>
                        {(t,) => (
                            <button type="button" role="tab" aria-selected={current() === t.key} class={`digest-chip${current() === t.key ? ' is-active' : ''}`} onClick={() => setTab(t.key,)}>
                                {t.label}
                            </button>
                        )}
                    </For>
                </div>
            }
        >
            <Show when={d()}>
                {(demo,) => (
                    <div class="aud-demo">
                        <div>
                            <h4>Age</h4>
                            <BarList items={ageOrder(demo().age,)} empty="No age data." />
                            <h4>Gender</h4>
                            <Show when={demo().gender.length} fallback={<p class="form-help-muted">No gender data.</p>}>
                                <SplitBar items={demo().gender} label={genderLabel} />
                            </Show>
                        </div>
                        <div>
                            <h4>Top countries</h4>
                            <BarList items={topN(demo().country, 10,)} label={(k,) => <>{flagEmoji(k,)} {countryName(k,)}</>} empty="No country data." />
                        </div>
                        <div>
                            <h4>Top cities</h4>
                            <BarList items={topN(demo().city, 10,)} empty="No city data." />
                        </div>
                    </div>
                )}
            </Show>
        </Block>
    );
};

const ContentTypes: Component<{ a: SocialAudience; }> = (p,) => {
    const b = () => p.a.breakdowns;
    const groups = () => [
        { title: 'Views', items: withShares(b().viewsByType,), },
        { title: 'Reach', items: withShares(b().reachByType,), },
        { title: 'Interactions', items: withShares(b().interactionsByType,), },
    ].filter((g,) => g.items.length);
    return (
        <Block title="Content types" wide>
            <Show when={groups().length}>
                <div class="aud-types">
                    <For each={groups()}>
                        {(g,) => (
                            <div>
                                <h4>{g.title}</h4>
                                <BarList items={g.items} label={typeLabel} />
                            </div>
                        )}
                    </For>
                </div>
            </Show>
            <Show when={p.a.contentKinds.length}>
                <div class="aud-table-wrap">
                    <table class="admin-table aud-table">
                        <thead>
                            <tr><th>Kind</th><th>Posts</th><th>Views</th><th>Avg views</th><th>Engagement</th></tr>
                        </thead>
                        <tbody>
                            <For each={[...p.a.contentKinds,].sort((x, y,) => (y.views ?? 0) - (x.views ?? 0))}>
                                {(k,) => (
                                    <tr>
                                        <td>{kindLabel(k.kind,)}</td>
                                        <td>{fmtNum(k.posts,)}</td>
                                        <td>{fmtNum(k.views,)}</td>
                                        <td>{fmtNum(k.avgViews,)}</td>
                                        <td>{fmtPct(k.engagementRate,)}</td>
                                    </tr>
                                )}
                            </For>
                        </tbody>
                    </table>
                </div>
            </Show>
        </Block>
    );
};

const Hashtags: Component<{ rows: SocialAudience['hashtags']; }> = (p,) => {
    const [sort, setSort,] = createSignal<{ field: HashtagSort; dir: 'asc' | 'desc'; }>({ field: 'avgViews', dir: 'desc', },);
    const rows = createMemo(() => sortHashtags(p.rows, sort().field, sort().dir,).slice(0, 25,),);
    const th = (field: HashtagSort, label: string,) => (
        <th class="admin-table__sortable" onClick={() => setSort((s,) => ({ field, dir: s.field === field && s.dir === 'desc' ? 'asc' : 'desc', }))}>
            {label}
            <span class="admin-table__sort-icon">{sort().field === field ? (sort().dir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
        </th>
    );
    return (
        <Block title="Top hashtags" aside={<span class="form-help-muted">{p.rows.length} in posts with metrics</span>}>
            <div class="aud-table-wrap">
                <table class="admin-table aud-table">
                    <thead><tr>{th('tag', 'Hashtag',)}{th('posts', 'Posts',)}{th('avgViews', 'Avg views',)}{th('engagementRate', 'Engagement',)}</tr></thead>
                    <tbody>
                        <For each={rows()}>
                            {(r,) => (
                                <tr>
                                    <td><span class="aud-tag">#{r.tag.replace(/^#/, '',)}</span></td>
                                    <td>{fmtNum(r.posts,)}</td>
                                    <td>{fmtNum(r.avgViews,)}</td>
                                    <td>{fmtPct(r.engagementRate,)}</td>
                                </tr>
                            )}
                        </For>
                    </tbody>
                </table>
            </div>
        </Block>
    );
};

const Benchmarks: Component<{ rows: SocialAudience['benchmarks']; settingsHref: string; }> = (p,) => (
    <Block title="Benchmarks" wide aside={<A href={p.settingsHref}>Edit accounts →</A>}>
        <div class="aud-table-wrap">
            <table class="admin-table aud-table">
                <thead>
                    <tr><th>Account</th><th>Followers</th><th>Posts</th><th>Avg likes</th><th>Avg comments</th><th>Engagement</th><th>Posts / week</th><th>As of</th></tr>
                </thead>
                <tbody>
                    <For each={p.rows}>
                        {(r,) => (
                            <tr>
                                <td><a href={`https://www.instagram.com/${encodeURIComponent(r.username,)}/`} target="_blank" rel="noopener noreferrer">@{r.username}</a></td>
                                <td>
                                    {fmtNum(r.followers,)}
                                    <Show when={r.followerChange !== null && r.followerChange !== 0}>
                                        <span class={`digest-delta digest-delta--${(r.followerChange ?? 0) > 0 ? 'up' : 'down'}`}>
                                            {(r.followerChange ?? 0) > 0 ? '▲' : '▼'} {fmtNum(Math.abs(r.followerChange ?? 0,),)}
                                        </span>
                                    </Show>
                                </td>
                                <td>{fmtNum(r.mediaCount,)}</td>
                                <td>{fmtNum(r.avgLikes,)}</td>
                                <td>{fmtNum(r.avgComments,)}</td>
                                <td>{fmtPct(r.engagementRate, 2,)}</td>
                                <td>{r.postsPerWeek === null ? '—' : r.postsPerWeek.toFixed(1,)}</td>
                                <td class="form-help-muted">{r.asOf ?? '—'}</td>
                            </tr>
                        )}
                    </For>
                </tbody>
            </table>
        </div>
    </Block>
);

// ── Panel ────────────────────────────────────────────────────────────────────

export interface AudiencePanelProps {
    audience: SocialAudience;
    /** Show the posts table filtered to stories (dashboard only). */
    onShowStories?: () => void;
    settingsHref?: string;
}

const AudiencePanel: Component<AudiencePanelProps> = (p,) => {
    const a = () => p.audience;
    const caps = () => a().capabilities;
    const anyDemo = () => hasDemographics(a().demographics.followers,) || hasDemographics(a().demographics.engaged,) || hasDemographics(a().demographics.reached,);
    const anyHours = () => a().onlineHours.some((h,) => h.value > 0);
    const b = () => a().breakdowns;
    const anyTypes = () => b().viewsByType.length > 0 || b().reachByType.length > 0 || b().interactionsByType.length > 0 || a().contentKinds.length > 0;
    const anyFollow = () => b().viewsByFollow.length > 0 || b().reachByFollow.length > 0;
    const anyStories = () => a().stories.count > 0;
    const missing = createMemo(() => {
        const list: Array<{ block: AudienceBlock; title: string; }> = [];
        if (!anyDemo()) list.push({ block: 'demographics', title: 'Demographics', },);
        if (!anyHours()) list.push({ block: 'hours', title: 'Best time to post', },);
        if (!anyTypes()) list.push({ block: 'types', title: 'Content types', },);
        if (!anyFollow()) list.push({ block: 'follow', title: 'Followers vs non-followers', },);
        if (!anyStories()) list.push({ block: 'stories', title: 'Stories', },);
        if (!a().hashtags.length) list.push({ block: 'hashtags', title: 'Hashtags', },);
        if (!a().benchmarks.length) list.push({ block: 'benchmarks', title: 'Benchmarks', },);
        return list;
    },);
    const settingsHref = () => p.settingsHref ?? '/admin/social/analytics/settings';

    return (
        <div class="aud-panel">
            <Show when={a().asOf}>
                <p class="form-help-muted aud-panel__asof">Demographics as of {a().asOf} · splits and stories summed over {a().from} → {a().to}.</p>
            </Show>
            <div class="aud-grid">
                <Show when={anyDemo()}><Demographics demographics={a().demographics} /></Show>

                <Show when={anyHours()}>
                    <Block title="Best time to post" wide><HourBars hours={a().onlineHours} /></Block>
                </Show>

                <Show when={anyTypes()}><ContentTypes a={a()} /></Show>

                <Show when={anyFollow()}>
                    <Block title="Followers vs non-followers">
                        <SplitBar title="Views" items={b().viewsByFollow} label={followLabel} />
                        <SplitBar title="Reach" items={b().reachByFollow} label={followLabel} />
                    </Block>
                </Show>

                <Show when={anyStories()}>
                    <Block
                        title="Stories"
                        aside={<Show when={p.onShowStories}><button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={() => p.onShowStories?.()}>Show stories in Posts ↓</button></Show>}
                    >
                        <dl class="aud-stats">
                            <div><dt>Stories</dt><dd>{fmtNum(a().stories.count,)}</dd></div>
                            <div><dt>Views</dt><dd>{fmtNum(a().stories.views,)}</dd></div>
                            <div><dt>Reach</dt><dd>{fmtNum(a().stories.reach,)}</dd></div>
                            <div><dt>Replies</dt><dd>{fmtNum(a().stories.replies,)}</dd></div>
                        </dl>
                    </Block>
                </Show>

                <Show when={a().hashtags.length}><Hashtags rows={a().hashtags} /></Show>

                <Show when={a().benchmarks.length}><Benchmarks rows={a().benchmarks} settingsHref={settingsHref()} /></Show>
            </div>

            <Show when={missing().length}>
                <details class="aud-missing" open={missing().length === 7}>
                    <summary>Not available yet ({missing().map((m,) => m.title).join(', ',)})</summary>
                    <ul>
                        <For each={missing()}>
                            {(m,) => (
                                <li>
                                    <strong>{m.title}:</strong> {missingNote(m.block, caps(),)}
                                    <Show when={m.block === 'benchmarks'}> <A href={settingsHref()}>Add accounts in Settings →</A></Show>
                                </li>
                            )}
                        </For>
                    </ul>
                </details>
            </Show>
        </div>
    );
};

export default AudiencePanel;
