/**
 * /admin/posts?view=contributions — contributor posts and their payouts.
 *
 * Summary cards, a state filter bar (with counts), search, an AUTHOR chip
 * (click an author's name), a sortable + paginated table with the review /
 * payout actions, and the Payouts section. Every filter lives in the URL
 * (`state`, `author`, `q`, `sort`, `page`) so links and Back work.
 */
import { A, useSearchParams, } from '@solidjs/router';
import type { Contribution, ContributionState, ContributionSummary, } from '@sitesurge/types';
import { formatDateShort as formatDate, } from '@sitesurge/types';
import { Component, createEffect, createResource, createSignal, For, on, onCleanup, Show, } from 'solid-js';
import ConfirmModal from '../common/ConfirmModal';
import DataTable from '../common/DataTable';
import { useToast, } from '../../common/toast';
import { cms, } from '../../../services/cmsClient';
import ChangePayoutModal from './ChangePayoutModal';
import ContributorPayouts from './ContributorPayouts';
import { formatMoney, } from './money';
import './contributions.scss';

type StateFilter = ContributionState | 'all';

const STATES: { value: StateFilter; label: string; }[] = [
    { value: 'all', label: 'All', },
    { value: 'pending_review', label: 'Waiting for review', },
    { value: 'returned', label: 'Returned', },
    { value: 'approved', label: 'Approved', },
    { value: 'paid', label: 'Paid', },
    { value: 'revoked', label: 'Revoked', },
];

const STATE_LABEL: Record<ContributionState, string> = {
    pending_review: 'Waiting for review', returned: 'Returned', approved: 'Approved', paid: 'Paid', revoked: 'Revoked',
};
const STATE_BADGE: Record<ContributionState, string> = {
    pending_review: 'badge--info', returned: 'badge--warning', approved: 'badge--success', paid: 'badge--success', revoked: 'badge--muted',
};
const EARNING_LABEL = { pending: 'holding', available: 'payable', paid: 'paid', revoked: 'revoked', } as const;

type Params = { view?: string; state?: string; author?: string; q?: string; sort?: string; page?: string; };

const ContributionsView: Component<{
    /** After any change (review, payout, revoke): the host refreshes its own counts (the tab's "N waiting"). */
    onChanged?: () => void;
}> = (props,) => {
    const toast = useToast();
    const [params, setParams,] = useSearchParams<Params>();
    const state = (): StateFilter => (STATES.some((s,) => s.value === params.state,) ? params.state as StateFilter : 'all');
    const sort = () => params.sort || 'submitted_desc';
    const page = () => Math.max(1, Number(params.page,) || 1,);

    const [summary, { refetch: refetchSummary, },] = createResource(() => cms.contributions.summary().catch(() => null as ContributionSummary | null),);
    const [settings,] = createResource(() => cms.contributions.settings().catch(() => null,),);
    const currency = () => summary.latest?.currency ?? settings.latest?.currency ?? 'usd';

    const [listError, setListError,] = createSignal('',);
    // `.latest` below (not `list()`): a refetch (filter, page, action) must not
    // suspend the admin page — the table keeps its rows until the new ones land.
    const [list, { refetch: refetchList, },] = createResource(
        () => ({ state: state(), authorId: params.author, search: params.q, sort: sort(), page: page(), }),
        (q,) => {
            setListError('',);
            return cms.contributions.list({ ...q, limit: 20, },).catch((e,) => {
                setListError(e instanceof Error ? e.message : 'The contributions could not be loaded.',);
                return null;
            },);
        },
    );
    const refresh = () => { void refetchList(); void refetchSummary(); props.onChanged?.(); };

    // Search box: search-as-you-type (debounced into the URL).
    const [search, setSearch,] = createSignal(params.q ?? '',);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onSearch = (v: string,) => {
        setSearch(v,);
        clearTimeout(timer,);
        timer = setTimeout(() => setParams({ q: v.trim() || undefined, page: undefined, },), 300,);
    };
    onCleanup(() => clearTimeout(timer,),);
    createEffect(on(() => params.q, (q,) => { if ((q ?? '') !== search().trim()) setSearch(q ?? '',); }, { defer: true, },),);

    const authorName = () => {
        const id = params.author;
        if (!id) return '';
        const c = summary.latest?.contributors.find((x,) => x.userId === id,);
        if (c) return c.name || c.email;
        return list.latest?.data.find((x,) => x.author?.id === id,)?.author?.name ?? 'Author';
    };
    const filterAuthor = (id: string,) => setParams({ author: id, page: undefined, },);
    const hasFilters = () => state() !== 'all' || !!params.author || !!params.q;
    const clearFilters = () => { setSearch('',); setParams({ state: undefined, author: undefined, q: undefined, page: undefined, },); };

    const count = (s: StateFilter,) => {
        const c = summary.latest?.counts;
        if (!c) return null;
        return s === 'all' ? Object.values(c,).reduce((a, b,) => a + b, 0,) : c[s];
    };

    // ── Row actions ──
    const [editing, setEditing,] = createSignal<Contribution | null>(null,);
    const [confirm, setConfirm,] = createSignal<{ kind: 'revoke' | 'unpublish'; row: Contribution; } | null>(null,);
    const [busy, setBusy,] = createSignal(false,);

    const run = async (fn: () => Promise<unknown>, ok: string,) => {
        setBusy(true,);
        try {
            await fn();
            toast.success(ok,);
            refresh();
            return true;
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'That did not work.',);
            return false;
        } finally {
            setBusy(false,);
        }
    };

    const savePayout = async (cents: number,) => {
        const row = editing();
        if (!row) return;
        if (await run(() => cms.contributions.setPayout(row.postId, cents,), `Payout set to ${formatMoney(cents, currency(),)}.`,)) setEditing(null,);
    };
    const doConfirm = async () => {
        const c = confirm();
        if (!c) return;
        const ok = c.kind === 'revoke'
            ? await run(() => cms.contributions.revoke(c.row.postId,), 'Payout revoked.',)
            : await run(() => cms.contributions.unpublish(c.row.postId,), 'Post unpublished (back to draft).',);
        if (ok) setConfirm(null,);
    };

    const canChange = (r: Contribution,) => r.state !== 'pending_review' && r.state !== 'returned' && r.earning?.status !== 'paid';

    return (
        <div class="contributions">
            {/* ── Summary ── */}
            <div class="contributions__cards">
                <div class="contributions__card"><span>Waiting for review</span><strong>{summary.latest?.counts.pending_review ?? '—'}</strong></div>
                <div class="contributions__card"><span>Approved</span><strong>{summary.latest?.counts.approved ?? '—'}</strong></div>
                <div class="contributions__card"><span>Paid</span><strong>{summary.latest?.counts.paid ?? '—'}</strong></div>
                <div class="contributions__card"><span>Owed</span><strong>{summary.latest ? formatMoney(summary.latest!.owedCents, currency(),) : '—'}</strong></div>
                <div class="contributions__card"><span>Payable now</span><strong>{summary.latest ? formatMoney(summary.latest!.payableCents, currency(),) : '—'}</strong></div>
                <div class="contributions__card"><span>Paid out</span><strong>{summary.latest ? formatMoney(summary.latest!.paidCents, currency(),) : '—'}</strong></div>
            </div>
            <Show when={settings.latest && !settings.latest!.enabled}>
                <p class="form-help-muted contributions__off">
                    Contributor payouts are off — approving a post publishes it without a payout.{' '}
                    <A href="/admin/posts/settings?tab=contributions">Turn them on in Posts → Settings → Contributions</A>.
                </p>
            </Show>

            {/* ── Filters ── */}
            <div class="contributions__states" role="group" aria-label="Filter by state">
                <For each={STATES}>
                    {(s,) => (
                        <button
                            type="button"
                            class={`contributions__state ${state() === s.value ? 'is-active' : ''}`}
                            onClick={() => setParams({ state: s.value === 'all' ? undefined : s.value, page: undefined, },)}
                        >
                            {s.label}
                            <Show when={count(s.value,) !== null}><span class="contributions__state-count">{count(s.value,)}</span></Show>
                        </button>
                    )}
                </For>
            </div>
            <div class="admin-filter-bar contributions__filters">
                <input
                    type="text"
                    placeholder="Search title or author..."
                    value={search()}
                    onInput={(e,) => onSearch(e.currentTarget.value,)}
                />
                <Show when={params.author}>
                    <span class="contributions__chip">
                        Author: {authorName()}
                        <button type="button" aria-label="Remove the author filter" onClick={() => setParams({ author: undefined, page: undefined, },)}>×</button>
                    </span>
                </Show>
                <Show when={hasFilters()}>
                    <button type="button" class="ui-button ui-button--ghost ui-button--sm" onClick={clearFilters}>Clear filters</button>
                </Show>
            </div>

            {/* ── Table ── */}
            <DataTable<Contribution>
                items={list.latest?.data ?? []}
                loading={list.loading}
                getRowId={(r,) => r.postId}
                emptyMessage={listError() || (hasFilters() ? 'No contributions match these filters.' : 'No contributions yet.')}
                sort={{ current: sort(), onSort: (s,) => setParams({ sort: s, page: undefined, },), }}
                pagination={{
                    page: page(),
                    totalPages: list.latest?.meta.totalPages ?? 1,
                    total: list.latest?.meta.total,
                    limit: list.latest?.meta.limit,
                    onPageChange: (p,) => setParams({ page: p > 1 ? String(p,) : undefined, },),
                }}
                columns={[
                    { header: 'Title', sortField: 'title', cell: (r,) => <A href={`/admin/posts/${r.postId}`} class="table-link">{r.title || 'Untitled'}</A>, },
                    {
                        header: 'Author',
                        sortField: 'author',
                        cell: (r,) => (
                            <Show when={r.author} fallback={<span class="form-help-muted">—</span>}>
                                <button type="button" class="contributions__author-link" title="Show only this author's contributions" onClick={() => filterAuthor(r.author!.id,)}>
                                    {r.author!.name || r.author!.email}
                                </button>
                            </Show>
                        ),
                    },
                    { header: 'State', cell: (r,) => <span class={`badge ${STATE_BADGE[r.state]}`}>{STATE_LABEL[r.state]}</span>, },
                    { header: 'Submitted', sortField: 'submitted', cell: (r,) => (r.submittedAt ? formatDate(r.submittedAt,) : '—'), },
                    {
                        header: 'Payout',
                        sortField: 'amount',
                        cell: (r,) => (
                            <Show when={r.earning} fallback={<span class="form-help-muted">—</span>}>
                                <span class={r.earning!.status === 'revoked' ? 'contributions__revoked' : ''}>{formatMoney(r.earning!.amountCents, r.earning!.currency,)}</span>
                                <span class="form-help-muted contributions__sub"> {EARNING_LABEL[r.earning!.status]}</span>
                            </Show>
                        ),
                    },
                    {
                        header: 'Actions',
                        cell: (r,) => (
                            <div class="contributions__actions">
                                <Show when={r.state === 'pending_review'}>
                                    <A href={`/admin/posts/${r.postId}`} class="ui-button ui-button--sm ui-button--primary">Review</A>
                                </Show>
                                <Show when={canChange(r,)}>
                                    <button type="button" class="ui-button ui-button--sm ui-button--secondary" disabled={busy()} onClick={() => setEditing(r,)}>
                                        {r.earning ? 'Change payout' : 'Add payout'}
                                    </button>
                                </Show>
                                <Show when={r.earning && r.earning.status !== 'paid' && r.earning.status !== 'revoked'}>
                                    <button type="button" class="ui-button ui-button--sm ui-button--ghost" disabled={busy()} onClick={() => setConfirm({ kind: 'revoke', row: r, },)}>Revoke</button>
                                </Show>
                                <Show when={r.postStatus === 'published'}>
                                    <button type="button" class="ui-button ui-button--sm ui-button--ghost" disabled={busy()} onClick={() => setConfirm({ kind: 'unpublish', row: r, },)}>Unpublish</button>
                                </Show>
                            </div>
                        ),
                    },
                ]}
            />

            <ContributorPayouts
                contributors={summary.latest?.contributors ?? []}
                currency={currency()}
                onFilterAuthor={(id,) => { filterAuthor(id,); window.scrollTo({ top: 0, behavior: 'smooth', },); }}
                onPaid={refresh}
            />

            <ChangePayoutModal
                open={editing() !== null}
                title={editing()?.title ?? ''}
                amountCents={editing()?.earning?.amountCents ?? settings.latest?.defaultPayoutCents ?? 0}
                currency={editing()?.earning?.currency ?? currency()}
                busy={busy()}
                onSave={(c,) => void savePayout(c,)}
                onClose={() => setEditing(null,)}
            />
            <ConfirmModal
                open={confirm() !== null}
                title={confirm()?.kind === 'revoke' ? 'Revoke this payout?' : 'Unpublish this post?'}
                message={confirm()?.kind === 'revoke'
                    ? `${formatMoney(confirm()?.row.earning?.amountCents, confirm()?.row.earning?.currency,)} will not be paid to ${confirm()?.row.author?.name || 'the contributor'}. You can add a payout again later.`
                    : `“${confirm()?.row.title ?? ''}” goes back to draft and leaves the site. Its payout is not changed — revoke it separately.`}
                confirmLabel={confirm()?.kind === 'revoke' ? 'Revoke payout' : 'Unpublish'}
                busyLabel="Working…"
                loading={busy()}
                danger
                onConfirm={() => void doConfirm()}
                onCancel={() => setConfirm(null,)}
            />
        </div>
    );
};

export default ContributionsView;
