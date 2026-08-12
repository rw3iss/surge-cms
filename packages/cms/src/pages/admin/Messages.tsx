import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createResource, } from 'solid-js';
import DataTable from '../../components/admin/common/DataTable';
import { cms, } from '../../services/cmsClient';
import { getStatusBadgeClass, } from '../../utils/badges';

const AdminMessages: Component = () => {
    const [messages,] = createResource(async () => {
        try {
            const res = await cms.messages.list();
            return res.data;
        } catch {
            return [];
        }
    },);

    const statusBadge = getStatusBadgeClass;

    return (
        <div>
            <Title>Messages - Admin - RW</Title>
            <div class="admin-header">
                <h1>Contact Messages</h1>
            </div>
            <DataTable
                items={messages() ?? []}
                loading={messages.loading}
                emptyMessage="No messages yet."
                columns={[
                    { header: 'Name', cell: (m: any,) => m.name, },
                    { header: 'Email', cell: (m: any,) => m.email, },
                    { header: 'Subject', cell: (m: any,) => m.subject || '(no subject)', },
                    { header: 'Status', cell: (m: any,) => <span class={`badge ${statusBadge(m.status,)}`}>{m.status}</span>, },
                    { header: 'Date', cell: (m: any,) => new Date(m.createdAt,).toLocaleDateString(), },
                    { header: '', cell: (m: any,) => <A href={`/admin/messages/${m.id}`} class="ui-button ui-button--sm ui-button--secondary">View</A>, },
                ]}
            />
        </div>
    );
};

export default AdminMessages;
