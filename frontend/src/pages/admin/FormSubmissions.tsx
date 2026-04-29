import { Title, } from '@solidjs/meta';
import { A, useParams, } from '@solidjs/router';
import { Component, createResource, For, Show, } from 'solid-js';
import { api, } from '../../services/api';

const FormSubmissions: Component = () => {
    const params = useParams();

    const [form,] = createResource(() => params.id, async (id,) => {
        const res = await api.get(`/forms/${id}`,);
        return res.success ? (res as any).data : null;
    },);

    const [submissions,] = createResource(() => params.id, async (id,) => {
        const res = await api.get(`/forms/${id}/submissions?limit=200`,);
        return res.success ? (res as any).data : [];
    },);

    const formatDate = (d: string,) => new Date(d,).toLocaleString();

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
                const sorted = [...nums,].sort((a, b,) => a - b);
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
                                    <span style={{ 'font-size': '0.8rem', color: '#888', }}>{q.responses} response{q.responses !== 1 ? 's' : ''}</span>

                                    <Show when={q.type === 'choice'}>
                                        <div style={{ 'margin-top': '0.5rem', }}>
                                            <For each={q.options}>
                                                {(opt: any,) => (
                                                    <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'margin-bottom': '4px', }}>
                                                        <span style={{ 'min-width': '100px', 'font-size': '0.85rem', }}>{opt.value}</span>
                                                        <div style={{ flex: '1', height: '18px', background: '#f0f0f0', 'border-radius': '4px', overflow: 'hidden', }}>
                                                            <div style={{ width: `${opt.percentage}%`, height: '100%', background: 'var(--site-primary, #e63946)', 'border-radius': '4px', transition: 'width 0.3s', }} />
                                                        </div>
                                                        <span style={{ 'min-width': '40px', 'text-align': 'right', 'font-size': '0.85rem', 'font-weight': '600', }}>{opt.percentage}%</span>
                                                    </div>
                                                )}
                                            </For>
                                        </div>
                                    </Show>

                                    <Show when={q.type === 'number'}>
                                        <div style={{ display: 'flex', gap: '1rem', 'margin-top': '0.5rem', 'flex-wrap': 'wrap', }}>
                                            <div style={{ padding: '4px 12px', background: '#f8f9fa', 'border-radius': '6px', 'text-align': 'center', }}>
                                                <div style={{ 'font-size': '0.75rem', color: '#888', }}>Min</div>
                                                <div style={{ 'font-weight': '600', }}>{q.min}</div>
                                            </div>
                                            <div style={{ padding: '4px 12px', background: '#f8f9fa', 'border-radius': '6px', 'text-align': 'center', }}>
                                                <div style={{ 'font-size': '0.75rem', color: '#888', }}>Max</div>
                                                <div style={{ 'font-weight': '600', }}>{q.max}</div>
                                            </div>
                                            <div style={{ padding: '4px 12px', background: '#f8f9fa', 'border-radius': '6px', 'text-align': 'center', }}>
                                                <div style={{ 'font-size': '0.75rem', color: '#888', }}>Avg</div>
                                                <div style={{ 'font-weight': '600', }}>{q.avg}</div>
                                            </div>
                                            <div style={{ padding: '4px 12px', background: '#f8f9fa', 'border-radius': '6px', 'text-align': 'center', }}>
                                                <div style={{ 'font-size': '0.75rem', color: '#888', }}>Median</div>
                                                <div style={{ 'font-weight': '600', }}>{q.median}</div>
                                            </div>
                                        </div>
                                    </Show>

                                    <Show when={q.type === 'text'}>
                                        <div style={{ 'font-size': '0.85rem', color: '#888', 'margin-top': '0.25rem', }}>
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
            <Show when={(submissions() || []).length > 0} fallback={
                <div class="empty-state">No submissions yet.</div>
            }>
                <div class="admin-table-container">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Submitted</th>
                                <For each={form()?.questions || []}>
                                    {(q: any,) => <th>{q.question}</th>}
                                </For>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={submissions() || []}>
                                {(sub: any, idx,) => (
                                    <tr>
                                        <td>{idx() + 1}</td>
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
                                    </tr>
                                )}
                            </For>
                        </tbody>
                    </table>
                </div>
            </Show>
        </div>
    );
};

export default FormSubmissions;
