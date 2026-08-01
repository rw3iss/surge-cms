import { Title, } from '@solidjs/meta';
import { A, useParams, } from '@solidjs/router';
import { Component, createMemo, createResource, createSignal, For, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';
import { useToast, } from '../../components/common/toast';
import ConfirmModal from '../../components/admin/common/ConfirmModal';

/** Number-summary tiles (Min/Max/Avg/Median) — shared styles, tokenized
 *  (were four identical inline objects). */
const STAT_TILE_STYLE = {
    padding: '4px 12px',
    background: 'var(--admin-bg-subtle, #f8f9fa)',
    'border-radius': '6px',
    'text-align': 'center',
} as const;
const STAT_LABEL_STYLE = {
    'font-size': '0.75rem',
    color: 'var(--admin-text-muted, #6b7280)',
} as const;

const FormSubmissions: Component = () => {
    const params = useParams();

    const [form,] = createResource(() => params.id, async (id,) => {
        try {
            return await cms.forms.getById(id,);
        } catch {
            return null;
        }
    },);

    // Fetch the submissions (up to the API's per-page cap) — feeds both the
    // summary aggregation and the client-paginated table below.
    const [submissions, { refetch: refetchSubs, },] = createResource(() => params.id, async (id,) => {
        try {
            const res = await cms.forms.listSubmissions(id, { limit: 500, } as any,);
            return res.data;
        } catch {
            return [];
        }
    },);

    const toast = useToast();
    const formatDate = (d: string,) => new Date(d,).toLocaleString();

    // ── Table pagination (20/page) + selection + delete ────────────────
    const PAGE_SIZE = 20;
    const [page, setPage,] = createSignal(1,);
    const [selectMode, setSelectMode,] = createSignal(false,);
    const [selected, setSelected,] = createSignal<Set<string>>(new Set(),);
    const [pending, setPending,] = createSignal<{ type: 'single'; id: string; } | { type: 'bulk'; } | null>(null,);
    const [deleting, setDeleting,] = createSignal(false,);

    const allSubs = createMemo(() => (submissions() || []) as any[],);
    const totalPages = createMemo(() => Math.max(1, Math.ceil(allSubs().length / PAGE_SIZE,),),);
    const pageSubs = createMemo(() => allSubs().slice((page() - 1) * PAGE_SIZE, page() * PAGE_SIZE,),);

    const toggle = (id: string,) =>
        setSelected((prev,) => { const n = new Set(prev,); n.has(id,) ? n.delete(id,) : n.add(id,); return n; },);
    const selectAll = () => setSelected(new Set(allSubs().map((s,) => s.id,),),);
    const deselectAll = () => setSelected(new Set(),);
    const exitSelect = () => { setSelectMode(false,); deselectAll(); };

    const performDelete = async () => {
        const pd = pending();
        if (!pd) return;
        setDeleting(true,);
        try {
            if (pd.type === 'single') {
                await cms.forms.deleteSubmission(params.id, pd.id,);
                setSelected((prev,) => { const n = new Set(prev,); n.delete(pd.id,); return n; },);
                toast.success('Submission deleted.',);
            } else {
                const ids = [...selected(),];
                const res = await cms.forms.bulkDeleteSubmissions(params.id, ids,);
                toast.success(`Deleted ${res.deleted} submission${res.deleted !== 1 ? 's' : ''}.`,);
                exitSelect();
            }
            await refetchSubs();
            if (page() > totalPages()) setPage(totalPages(),);
        } catch (err: any) {
            toast.error(err?.message || 'Delete failed.',);
        } finally {
            setDeleting(false,);
            setPending(null,);
        }
    };

    // Compute summary stats from submissions
    const stats = () => {
        const subs = submissions() || [];
        const questions = form()?.questions || [];
        if (!subs.length || !questions.length) return null;

        return questions.map((q: any,) => {
            const answers = subs
                .map((s: any,) => {
                    const a = (s.answers || []).find((ans: any,) => ans.questionId === q.id);
                    return a?.value;
                },)
                .filter((v: any,) => v !== undefined && v !== null && v !== '',);

            if (['radio', 'checkbox', 'select',].includes(q.type,) && q.options?.length) {
                const counts: Record<string, number> = {};
                q.options.forEach((opt: string,) => counts[opt] = 0);
                answers.forEach((val: any,) => {
                    if (Array.isArray(val,)) val.forEach((v: string,) => { if (counts[v] !== undefined) counts[v]++; });
                    else if (counts[val] !== undefined) counts[val]++;
                },);
                const total = answers.length || 1;
                return {
                    question: q.question,
                    type: 'choice' as const,
                    responses: answers.length,
                    options: Object.entries(counts,).map(([value, count,],) => ({
                        value,
                        count,
                        percentage: Math.round((count as number) / total * 100,),
                    }),),
                };
            }

            if (q.type === 'number') {
                const nums = answers.map(Number,).filter((n: number,) => !isNaN(n,),);
                const sorted = [...nums,].toSorted((a, b,) => a - b);
                return {
                    question: q.question,
                    type: 'number' as const,
                    responses: nums.length,
                    min: sorted[0] ?? 0,
                    max: sorted[sorted.length - 1] ?? 0,
                    avg: nums.length ? (nums.reduce((a: number, b: number,) => a + b, 0,) / nums.length).toFixed(1,) : '0',
                    median: sorted[Math.floor(sorted.length / 2,)] ?? 0,
                };
            }

            return {
                question: q.question,
                type: 'text' as const,
                responses: answers.length,
            };
        },);
    };

    return (
        <div>
            <Title>Form Submissions - Admin - RW</Title>
            <div class="admin-header">
                <h1>
                    <Show when={form()} fallback="Form Submissions">
                        {form()?.title} — Submissions
                    </Show>
                </h1>
                <div class="admin-header__actions">
                    <A href={`/admin/forms/${params.id}`} class="btn btn--secondary btn--small">Edit Form</A>
                    <A href="/admin/forms" class="btn btn--ghost btn--small">Back to Forms</A>
                </div>
            </div>

            {/* Summary statistics */}
            <Show when={stats()}>
                <div class="admin-form" style={{ 'margin-bottom': '2rem', }}>
                    <div class="form-section">
                        <h2>Summary ({(submissions() || []).length} submission{(submissions() || []).length !== 1 ? 's' : ''})</h2>
                        <For each={stats()!}>
                            {(q: any,) => (
                                <div style={{ 'margin-bottom': '1.5rem', }}>
                                    <h3 style={{ 'font-size': '0.95rem', margin: '0 0 0.5rem', }}>{q.question}</h3>
                                    <span style={{ 'font-size': '0.8rem', color: 'var(--admin-text-muted, #6b7280)', }}>{q.responses} response{q.responses !== 1 ? 's' : ''}</span>

                                    <Show when={q.type === 'choice'}>
                                        <div style={{ 'margin-top': '0.5rem', }}>
                                            <For each={q.options}>
                                                {(opt: any,) => (
                                                    <div class="u-flex-row" style={{ 'margin-bottom': '4px', }}>
                                                        <span style={{ 'min-width': '100px', 'font-size': '0.85rem', }}>{opt.value}</span>
                                                        <div style={{ flex: '1', height: '18px', background: 'var(--admin-bg-subtle, #f0f0f0)', 'border-radius': '4px', overflow: 'hidden', }}>
                                                            <div style={{ width: `${opt.percentage}%`, height: '100%', background: 'var(--site-primary, #3498cf)', 'border-radius': '4px', transition: 'width 0.3s', }} />
                                                        </div>
                                                        <span style={{ 'min-width': '40px', 'text-align': 'right', 'font-size': '0.85rem', 'font-weight': '600', }}>{opt.percentage}%</span>
                                                    </div>
                                                )}
                                            </For>
                                        </div>
                                    </Show>

                                    <Show when={q.type === 'number'}>
                                        <div class="u-flex-row u-gap-md u-flex-wrap" style={{ 'margin-top': '0.5rem', }}>
                                            <For each={[{ label: 'Min', value: q.min, }, { label: 'Max', value: q.max, }, { label: 'Avg', value: q.avg, }, { label: 'Median', value: q.median, },]}>
                                                {(stat,) => (
                                                    <div style={STAT_TILE_STYLE}>
                                                        <div style={STAT_LABEL_STYLE}>{stat.label}</div>
                                                        <div style={{ 'font-weight': '600', }}>{stat.value}</div>
                                                    </div>
                                                )}
                                            </For>
                                        </div>
                                    </Show>

                                    <Show when={q.type === 'text'}>
                                        <div style={{ 'font-size': '0.85rem', color: 'var(--admin-text-muted, #6b7280)', 'margin-top': '0.25rem', }}>
                                            {q.responses} text response{q.responses !== 1 ? 's' : ''}
                                        </div>
                                    </Show>
                                </div>
                            )}
                        </For>
                    </div>
                </div>
            </Show>

            {/* Individual submissions table */}
            <Show when={allSubs().length > 0} fallback={
                <div class="empty-state">No submissions yet.</div>
            }>
                {/* Toolbar — bulk-select toggle + bulk actions */}
                <div class="u-flex-row u-gap-sm u-flex-wrap" style={{ 'align-items': 'center', 'margin-bottom': '0.5rem', }}>
                    <Show
                        when={selectMode()}
                        fallback={
                            <button class="btn btn--secondary btn--small" onClick={() => setSelectMode(true,)}>Edit / select</button>
                        }
                    >
                        <button class="btn btn--ghost btn--small" onClick={exitSelect}>Done</button>
                        <button class="btn btn--ghost btn--small" onClick={selectAll} disabled={selected().size === allSubs().length}>Select all</button>
                        <button class="btn btn--ghost btn--small" onClick={deselectAll} disabled={selected().size === 0}>Deselect all</button>
                        <span style={{ 'font-size': '0.85rem', color: 'var(--admin-text-muted, #6b7280)', }}>{selected().size} selected</span>
                        <button class="btn btn--danger btn--small" disabled={selected().size === 0} onClick={() => setPending({ type: 'bulk', },)}>
                            Delete selected
                        </button>
                    </Show>
                </div>

                <div class="admin-table-container">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <Show when={selectMode()}>
                                    <th style={{ width: '32px', }}>
                                        <input
                                            type="checkbox"
                                            checked={selected().size > 0 && selected().size === allSubs().length}
                                            onChange={(e,) => e.currentTarget.checked ? selectAll() : deselectAll()}
                                        />
                                    </th>
                                </Show>
                                <th>#</th>
                                <th>Submitted</th>
                                <For each={form()?.questions || []}>
                                    {(q: any,) => <th>{q.question}</th>}
                                </For>
                                <th style={{ 'text-align': 'right', }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={pageSubs()}>
                                {(sub: any, idx,) => (
                                    <tr>
                                        <Show when={selectMode()}>
                                            <td>
                                                <input type="checkbox" checked={selected().has(sub.id,)} onChange={() => toggle(sub.id,)} />
                                            </td>
                                        </Show>
                                        <td>{(page() - 1) * PAGE_SIZE + idx() + 1}</td>
                                        <td style={{ 'white-space': 'nowrap', 'font-size': '0.85rem', }}>{formatDate(sub.submittedAt || sub.submitted_at,)}</td>
                                        <For each={form()?.questions || []}>
                                            {(q: any,) => {
                                                const answer = (sub.answers || []).find((a: any,) => a.questionId === q.id);
                                                const val = answer?.value;
                                                return (
                                                    <td style={{ 'font-size': '0.85rem', 'max-width': '200px', overflow: 'hidden', 'text-overflow': 'ellipsis', }}>
                                                        {Array.isArray(val,) ? val.join(', ',) : String(val ?? '—',)}
                                                    </td>
                                                );
                                            }}
                                        </For>
                                        <td style={{ 'text-align': 'right', 'white-space': 'nowrap', }}>
                                            <button
                                                class="btn btn--danger btn--small"
                                                title="Delete submission"
                                                onClick={() => setPending({ type: 'single', id: sub.id, },)}
                                            >
                                                Delete
                                            </button>
                                        </td>
                                    </tr>
                                )}
                            </For>
                        </tbody>
                    </table>
                </div>

                {/* Pager (pages of 20) */}
                <Show when={totalPages() > 1}>
                    <div class="u-flex-row u-gap-sm" style={{ 'align-items': 'center', 'justify-content': 'center', 'margin-top': '1rem', }}>
                        <button class="btn btn--ghost btn--small" disabled={page() <= 1} onClick={() => setPage((p,) => Math.max(1, p - 1,),)}>← Prev</button>
                        <span style={{ 'font-size': '0.85rem', }}>Page {page()} of {totalPages()}</span>
                        <button class="btn btn--ghost btn--small" disabled={page() >= totalPages()} onClick={() => setPage((p,) => Math.min(totalPages(), p + 1,),)}>Next →</button>
                    </div>
                </Show>
            </Show>

            <ConfirmModal
                open={pending() !== null}
                title={pending()?.type === 'bulk' ? 'Delete selected submissions' : 'Delete submission'}
                message={pending()?.type === 'bulk'
                    ? `Permanently delete ${selected().size} selected submission${selected().size !== 1 ? 's' : ''}? This cannot be undone.`
                    : 'Permanently delete this submission? This cannot be undone.'}
                confirmLabel={deleting() ? 'Deleting…' : 'Delete'}
                danger
                onConfirm={performDelete}
                onCancel={() => setPending(null,)}
            />
        </div>
    );
};

export default FormSubmissions;
