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
import type { MailSendJob, MailSendRecipient, } from '@rw/cms-shared';
import { cms, } from '../../services/cmsClient';

type StatusFilter = 'all' | 'pending' | 'sent' | 'failed';

const MailJob: Component = () => {
    const params = useParams<{ id: string; }>();
    const [job, setJob,] = createSignal<MailSendJob | null>(null,);
    const [filter, setFilter,] = createSignal<StatusFilter>('all',);
    const [busy, setBusy,] = createSignal(false,);
    const [error, setError,] = createSignal<string | null>(null,);

    const fetchJob = async (): Promise<void> => {
        try {
            setJob(await cms.mailSend.getJob(params.id,) as MailSendJob,);
        } catch {
            /* error toasted by the bus */
        }
    };

    const [recipients, { refetch: refetchRecipients, },] = createResource(
        () => ({ id: params.id, status: filter() === 'all' ? undefined : filter(), }),
        async (args,) => {
            try {
                return await cms.mailSend.jobRecipients(args.id, { status: args.status, limit: 100, } as any,) as { items: MailSendRecipient[]; total: number; };
            } catch {
                return { items: [], total: 0, };
            }
        },
    );

    let pollHandle: ReturnType<typeof setInterval> | null = null;
    const startPolling = (): void => {
        if (pollHandle) return;
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
    };
    onMount(async () => {
        await fetchJob();
        startPolling();
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
            case 'cancelled': return 'badge--error';
            case 'running':
            case 'pending': return 'badge--info';
            default: return '';
        }
    };

    const handleRetry = async (): Promise<void> => {
        setBusy(true,);
        setError(null,);
        try {
            await cms.mailSend.retryJob(params.id,);
            await fetchJob();
            refetchRecipients();
            // The worker just started a fresh run — re-arm polling so
            // progress updates appear live.
            startPolling();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Retry failed.',);
        } finally { setBusy(false,); }
    };

    const handleCancel = async (): Promise<void> => {
        if (!confirm('Cancel this send? In-flight deliveries will finish; remaining recipients will not be contacted.',)) return;
        setBusy(true,);
        await cms.mailSend.cancelJob(params.id,);
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
                        <button type="button" class="btn btn--danger" onClick={handleCancel} disabled={busy()}>
                            {job()?.status === 'pending' ? 'Stop' : 'Cancel'}
                        </button>
                    </Show>
                    <Show when={job()?.status === 'cancelled'}>
                        <button type="button" class="btn btn--primary" onClick={handleRetry} disabled={busy()}>
                            Resume
                        </button>
                    </Show>
                    <Show when={(job()?.failedCount ?? 0) > 0 && (job()?.status === 'completed' || job()?.status === 'failed')}>
                        <button type="button" class="btn btn--secondary" onClick={handleRetry} disabled={busy()}>
                            Retry failed
                        </button>
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
                            <div
                                class="progress-bar"
                                role="progressbar"
                                aria-label="Send progress"
                                aria-valuenow={progress()}
                                aria-valuemin={0}
                                aria-valuemax={100}
                            >
                                <div class="progress-bar__fill" style={{ width: `${progress()}%`, }} />
                                <span class="progress-bar__label">
                                    {j().sentCount + j().failedCount} / {j().totalRecipients} ({progress()}%)
                                </span>
                            </div>
                        </section>

                        <section class="admin-section">
                            <div class="job-summary">
                                {/* Row 1 — list + total recipients */}
                                <div class="job-summary__row job-summary__row--header">
                                    <div class="job-summary__field">
                                        <span class="job-summary__label">List</span>
                                        <span class="job-summary__value job-summary__value--strong">
                                            {j().listName ?? <em class="form-help-muted">(deleted)</em>}
                                        </span>
                                    </div>
                                    <div class="job-summary__field job-summary__field--end">
                                        <span class="job-summary__label">Recipients</span>
                                        <span class="job-summary__value job-summary__value--strong">{j().totalRecipients}</span>
                                    </div>
                                </div>

                                {/* Row 2 — template + subject sub-label */}
                                <div class="job-summary__row job-summary__row--template">
                                    <div class="job-summary__template">
                                        <Show
                                            when={j().templateName}
                                            fallback={<em class="form-help-muted">Custom (no template)</em>}
                                        >
                                            {j().templateName}
                                            <Show when={j().templateWasModified}>
                                                {' '}<span class="job-summary__custom-tag">(custom)</span>
                                            </Show>
                                        </Show>
                                    </div>
                                    <div class="job-summary__subject">{j().subject}</div>
                                </div>

                                {/* Row 3 — counts (left) + timestamps (right) */}
                                <div class="job-summary__row job-summary__row--stats">
                                    <dl class="job-summary__stats">
                                        <div>
                                            <dt>Status</dt>
                                            <dd><span class={`badge ${statusBadge()}`}>{j().status}</span></dd>
                                        </div>
                                        <div>
                                            <dt>Sent</dt>
                                            <dd>{j().sentCount}</dd>
                                        </div>
                                        <div>
                                            <dt>Failed</dt>
                                            <dd>{j().failedCount}</dd>
                                        </div>
                                    </dl>
                                    <dl class="job-summary__stats">
                                        <div>
                                            <dt>Started</dt>
                                            <dd>
                                                <Show when={j().startedAt} fallback={<em class="form-help-muted">—</em>}>
                                                    {new Date(j().startedAt!,).toLocaleString()}
                                                </Show>
                                            </dd>
                                        </div>
                                        <div>
                                            <dt>Completed</dt>
                                            <dd>
                                                <Show when={j().completedAt} fallback={<em class="form-help-muted">—</em>}>
                                                    {new Date(j().completedAt!,).toLocaleString()}
                                                </Show>
                                            </dd>
                                        </div>
                                    </dl>
                                </div>
                            </div>

                            <Show when={j().error}>
                                <div class="alert alert--error">Job error: {j().error}</div>
                            </Show>
                        </section>

                        <section class="admin-section admin-section--wide">
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
                                        <table class="admin-table job-recipients-table">
                                            <thead>
                                                <tr>
                                                    <th class="job-recipients-table__email">Email</th>
                                                    <th class="job-recipients-table__status">Status</th>
                                                    <th class="job-recipients-table__attempts">Attempts</th>
                                                    <th class="job-recipients-table__sent-at">Sent at</th>
                                                    <th class="job-recipients-table__error">Error</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <For each={recipients()?.items ?? []}>
                                                    {(r,) => (
                                                        <tr>
                                                            <td>{r.email}</td>
                                                            <td><span class={`badge badge--${r.status === 'sent' ? 'success' : r.status === 'failed' ? 'error' : 'muted'}`}>{r.status}</span></td>
                                                            <td>{r.attemptCount}</td>
                                                            <td>{r.sentAt ? new Date(r.sentAt,).toLocaleString() : '—'}</td>
                                                            <td class="job-recipient-error" title={r.error}>{r.error ?? ''}</td>
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
