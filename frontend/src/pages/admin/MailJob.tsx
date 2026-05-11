/**
 * Live send-job status page. Polls every 2s while running. Shows
 * progress, status badge, action buttons (Retry failed / Cancel),
 * and a paginated recipients table with status filter tabs.
 */
import { Title, } from '@solidjs/meta';
import { A, useParams, } from '@solidjs/router';
import {
    Component, createResource, createSignal, For, onCleanup, onMount, Show,
} from 'solid-js';
import type { MailSendJob, MailSendRecipient, } from '@rw/shared';
import { mailSendApi, } from '../../services/api';

type StatusFilter = 'all' | 'pending' | 'sent' | 'failed';

const MailJob: Component = () => {
    const params = useParams<{ id: string; }>();
    const [job, setJob,] = createSignal<MailSendJob | null>(null,);
    const [filter, setFilter,] = createSignal<StatusFilter>('all',);
    const [busy, setBusy,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);

    const fetchJob = async (): Promise<void> => {
        const r = await mailSendApi.job(params.id,);
        if (r.success && r.data) setJob(r.data as MailSendJob,);
    };

    const [recipients, { refetch: refetchRecipients, },] = createResource(
        () => ({ id: params.id, status: filter() === 'all' ? undefined : filter(), }),
        async (args,) => {
            const r = await mailSendApi.recipients(args.id, { status: args.status, limit: 100, },);
            return r.success
                ? (r.data as { items: MailSendRecipient[]; total: number; })
                : { items: [], total: 0, };
        },
    );

    let pollHandle: ReturnType<typeof setInterval> | null = null;
    onMount(async () => {
        await fetchJob();
        pollHandle = setInterval(async () => {
            const j = job();
            if (j && (j.status === 'pending' || j.status === 'running')) {
                await fetchJob();
                refetchRecipients();
            } else if (pollHandle) {
                clearInterval(pollHandle,);
                pollHandle = null;
            }
        }, 2000,);
    },);
    onCleanup(() => { if (pollHandle) clearInterval(pollHandle,); },);

    const progress = (): number => {
        const j = job();
        if (!j || j.totalRecipients === 0) return 0;
        return Math.min(100, Math.round(((j.sentCount + j.failedCount) / j.totalRecipients) * 100,),);
    };

    const statusBadge = (): string => {
        const j = job();
        if (!j) return '';
        switch (j.status) {
            case 'completed': return 'badge--success';
            case 'failed':
            case 'cancelled': return 'badge--danger';
            case 'running':
            case 'pending': return 'badge--info';
            default: return '';
        }
    };

    const handleRetry = async (): Promise<void> => {
        setBusy(true,);
        setError(null,);
        try {
            const r = await mailSendApi.retry(params.id,);
            if (!r.success) setError(typeof r.error === 'string' ? r.error : 'Retry failed.',);
            await fetchJob();
            refetchRecipients();
        } finally { setBusy(false,); }
    };

    const handleCancel = async (): Promise<void> => {
        if (!confirm('Cancel this send? In-flight deliveries will finish; remaining recipients will not be contacted.',)) return;
        setBusy(true,);
        await mailSendApi.cancel(params.id,);
        await fetchJob();
        setBusy(false,);
    };

    return (
        <div class="mail-job-page mailing-list-edit-page">
            <Title>Send Job - Admin</Title>

            <div class="admin-header">
                <A href="/admin/mailing-lists" class="admin-header__back">← Mailing Lists</A>
                <h1>Send Job</h1>
                <div class="admin-header__actions">
                    <Show when={job()?.status === 'running' || job()?.status === 'pending'}>
                        <button type="button" class="btn btn--danger" onClick={handleCancel} disabled={busy()}>Cancel</button>
                    </Show>
                    <Show when={(job()?.failedCount ?? 0) > 0 && (job()?.status === 'completed' || job()?.status === 'failed')}>
                        <button type="button" class="btn btn--secondary" onClick={handleRetry} disabled={busy()}>Retry failed</button>
                    </Show>
                </div>
            </div>

            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            <Show when={job()} fallback={<p>Loading…</p>}>
                {(j,) => (
                    <>
                        <section class="admin-section">
                            <div class="job-summary">
                                <div><strong>Subject:</strong> {j().subject}</div>
                                <div><strong>Status:</strong> <span class={`badge ${statusBadge()}`}>{j().status}</span></div>
                                <div><strong>Recipients:</strong> {j().totalRecipients}</div>
                                <div><strong>Sent:</strong> {j().sentCount} · <strong>Failed:</strong> {j().failedCount}</div>
                                <Show when={j().startedAt}>
                                    <div><strong>Started:</strong> {new Date(j().startedAt!,).toLocaleString()}</div>
                                </Show>
                                <Show when={j().completedAt}>
                                    <div><strong>Completed:</strong> {new Date(j().completedAt!,).toLocaleString()}</div>
                                </Show>
                            </div>

                            <div class="progress-bar" aria-label="Send progress">
                                <div class="progress-bar__fill" style={{ width: `${progress()}%`, }} />
                                <span class="progress-bar__label">{progress()}%</span>
                            </div>

                            <Show when={j().error}>
                                <div class="alert alert--error">Job error: {j().error}</div>
                            </Show>
                        </section>

                        <section class="admin-section">
                            <header class="admin-section__header">
                                <h2>Recipients ({recipients()?.total ?? 0})</h2>
                                <div class="status-tabs">
                                    <For each={['all', 'pending', 'sent', 'failed',] as StatusFilter[]}>
                                        {(s,) => (
                                            <button
                                                type="button"
                                                class={`status-tabs__tab ${filter() === s ? 'is-active' : ''}`}
                                                onClick={() => setFilter(s,)}
                                            >
                                                {s.charAt(0,).toUpperCase() + s.slice(1,)}
                                            </button>
                                        )}
                                    </For>
                                </div>
                            </header>
                            <Show when={!recipients.loading} fallback={<p>Loading…</p>}>
                                <Show
                                    when={(recipients()?.items ?? []).length > 0}
                                    fallback={<div class="empty-state"><em>No recipients match.</em></div>}
                                >
                                    <div class="admin-table-container">
                                        <table class="admin-table">
                                            <thead>
                                                <tr>
                                                    <th>Email</th>
                                                    <th>Status</th>
                                                    <th>Attempts</th>
                                                    <th>Sent at</th>
                                                    <th>Error</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <For each={recipients()?.items ?? []}>
                                                    {(r,) => (
                                                        <tr>
                                                            <td>{r.email}</td>
                                                            <td><span class={`badge badge--${r.status === 'sent' ? 'success' : r.status === 'failed' ? 'danger' : 'muted'}`}>{r.status}</span></td>
                                                            <td>{r.attemptCount}</td>
                                                            <td>{r.sentAt ? new Date(r.sentAt,).toLocaleString() : '—'}</td>
                                                            <td class="job-recipient-error" title={r.error}>{r.error ? `${r.error.slice(0, 60,)}…` : ''}</td>
                                                        </tr>
                                                    )}
                                                </For>
                                            </tbody>
                                        </table>
                                    </div>
                                </Show>
                            </Show>
                        </section>
                    </>
                )}
            </Show>
        </div>
    );
};

export default MailJob;
