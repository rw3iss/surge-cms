import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createResource, For, Show, } from 'solid-js';
import { api, } from '../../services/api';
import { getStatusBadgeClass, } from '../../utils/badges';

const AdminCampaigns: Component = () => {
    const [campaigns,] = createResource(async () => {
        const response = await api.get('/campaigns?all=true',);
        return response.success ? (response as any).data : [];
    },);

    const formatDate = (d: string | null | undefined,) => {
        if (!d) return null;
        return new Date(d,).toLocaleDateString();
    };

    const formatCurrency = (cents: number | null,) => {
        if (cents === null || cents === undefined) return 'Open Fund';
        return `$${(cents / 100).toLocaleString()}`;
    };

    return (
        <div class="admin-campaigns">
            <Title>Campaigns - Admin - Surge Media</Title>

            <div class="admin-header">
                <h1>Campaigns</h1>
                <A href="/admin/campaigns/new" class="btn btn--primary">New Campaign</A>
            </div>

            <div class="admin-table-container">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Title</th>
                            <th>Goal</th>
                            <th>Raised</th>
                            <th>Donors</th>
                            <th>Dates</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <Show
                            when={!campaigns.loading}
                            fallback={
                                <tr>
                                    <td colspan="7">Loading...</td>
                                </tr>
                            }
                        >
                            <For
                                each={campaigns()}
                                fallback={
                                    <tr>
                                        <td colspan="7">No campaigns found</td>
                                    </tr>
                                }
                            >
                                {(campaign: any,) => (
                                    <tr>
                                        <td>
                                            <A href={`/admin/campaigns/${campaign.id}`} class="table-link">
                                                {campaign.title}
                                            </A>
                                        </td>
                                        <td>{formatCurrency(campaign.goalAmountCents,)}</td>
                                        <td>{formatCurrency(campaign.currentAmountCents,)}</td>
                                        <td>{campaign.donorCount || 0}</td>
                                        <td>
                                            <Show when={formatDate(campaign.startDate,) || formatDate(campaign.endDate,)}>
                                                <div style={{ 'font-size': '0.8rem', 'line-height': '1.4', }}>
                                                    <Show when={formatDate(campaign.startDate,)}>
                                                        <div>Start: {formatDate(campaign.startDate,)}</div>
                                                    </Show>
                                                    <Show when={formatDate(campaign.endDate,)}>
                                                        <div>End: {formatDate(campaign.endDate,)}</div>
                                                    </Show>
                                                </div>
                                            </Show>
                                            <Show when={!formatDate(campaign.startDate,) && !formatDate(campaign.endDate,)}>
                                                <span style={{ color: '#999', 'font-size': '0.8rem', }}>Open</span>
                                            </Show>
                                        </td>
                                        <td>
                                            <span class={`badge ${getStatusBadgeClass(campaign.status,)}`}>
                                                {campaign.status}
                                            </span>
                                        </td>
                                        <td>
                                            <A href={`/admin/campaigns/${campaign.id}`} class="btn btn--small">Edit</A>
                                        </td>
                                    </tr>
                                )}
                            </For>
                        </Show>
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default AdminCampaigns;
