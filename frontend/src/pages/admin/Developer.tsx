import { Title, } from '@solidjs/meta';
import { Component, createResource, For, Show, } from 'solid-js';
import { fetchCrons, } from '../../services/api';

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

const AdminDeveloper: Component = () => {
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
        if (job.lastResult === 'error') return 'badge--danger';
        return 'badge--secondary';
    };

    const statusLabel = (job: CronJob,) => {
        if (job.isRunning) return 'Running';
        if (job.lastResult === 'success') return 'OK';
        if (job.lastResult === 'error') return 'Error';
        return 'Pending';
    };

    return (
        <div class="admin-developer">
            <Title>Developer - Admin - Surge Media</Title>

            <div class="admin-header">
                <h1>Developer Tools</h1>
                <p class="admin-header__subtitle">System internals and scheduled jobs.</p>
            </div>

            <div class="admin-section">
                <div class="admin-section__header">
                    <h2>Scheduled Jobs</h2>
                    <button class="btn btn--small btn--secondary" onClick={() => refetch()}>
                        Refresh
                    </button>
                </div>

                <Show
                    when={!crons.loading}
                    fallback={<p class="text-muted">Loading cron jobs...</p>}
                >
                    <Show
                        when={crons()?.length}
                        fallback={<p class="text-muted">No cron jobs registered.</p>}
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
                                                <td>
                                                    <code>{job.schedule}</code>
                                                </td>
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
        </div>
    );
};

export default AdminDeveloper;
