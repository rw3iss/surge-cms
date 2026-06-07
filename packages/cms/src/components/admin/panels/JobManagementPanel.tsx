/**
 * Scheduled-jobs panel — shown under Settings → Admin → Job Management.
 *
 * Lists every cron job registered with the backend's job runner with
 * its schedule, last run, last result, and next run. Read-only; the
 * jobs themselves are wired up server-side. The Refresh button
 * re-fetches the registry without reloading the page.
 */
import { Component, createResource, For, Show, } from 'solid-js';
import { fetchCrons, } from '../../../services/api';

interface CronJob {
    name: string;
    schedule: string;
    description: string;
    lastRun: string | null;
    lastResult: 'success' | 'error' | null;
    lastError: string | null;
    nextRun: string | null;
    isRunning: boolean;
    registeredAt: string;
}

const JobManagementPanel: Component = () => {
    const [crons, { refetch, },] = createResource(async () => {
        const response = await fetchCrons();
        return response.success ? (response as any).data as CronJob[] : [];
    },);

    const formatDate = (iso: string | null,) => {
        if (!iso) return '--';
        return new Date(iso,).toLocaleString();
    };

    const statusBadge = (job: CronJob,) => {
        if (job.isRunning) return 'badge--info';
        if (job.lastResult === 'success') return 'badge--success';
        if (job.lastResult === 'error') return 'badge--error';
        return 'badge--muted';
    };

    const statusLabel = (job: CronJob,) => {
        if (job.isRunning) return 'Running';
        if (job.lastResult === 'success') return 'OK';
        if (job.lastResult === 'error') return 'Error';
        return 'Pending';
    };

    return (
        <div class="settings-card">
            <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', 'margin-bottom': '8px', }}>
                <div class="settings-card__title" style={{ margin: 0, }}>Scheduled Jobs</div>
                <button class="btn btn--small btn--secondary" onClick={() => refetch()}>
                    Refresh
                </button>
            </div>
            <p class="settings-card__lede">
                Background jobs registered with the server's cron runner.
                Token refresh schedules and other recurring tasks live here.
            </p>

            <Show
                when={!crons.loading}
                fallback={<p class="form-help-muted">Loading cron jobs…</p>}
            >
                <Show
                    when={crons()?.length}
                    fallback={<p class="form-help-muted">No cron jobs registered.</p>}
                >
                    <div class="cron-table-wrapper">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Schedule</th>
                                    <th>Description</th>
                                    <th>Status</th>
                                    <th>Last Run</th>
                                    <th>Next Run</th>
                                </tr>
                            </thead>
                            <tbody>
                                <For each={crons()}>
                                    {(job,) => (
                                        <tr>
                                            <td class="cron-name">{job.name}</td>
                                            <td><code>{job.schedule}</code></td>
                                            <td>{job.description}</td>
                                            <td>
                                                <span class={`badge badge--small ${statusBadge(job,)}`}>
                                                    {statusLabel(job,)}
                                                </span>
                                            </td>
                                            <td>
                                                <span class="cron-date">{formatDate(job.lastRun,)}</span>
                                                <Show when={job.lastError}>
                                                    <span class="cron-error" title={job.lastError!}>
                                                        {job.lastError}
                                                    </span>
                                                </Show>
                                            </td>
                                            <td>
                                                <span class="cron-date">{formatDate(job.nextRun,)}</span>
                                            </td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </div>
                </Show>
            </Show>
        </div>
    );
};

export default JobManagementPanel;
