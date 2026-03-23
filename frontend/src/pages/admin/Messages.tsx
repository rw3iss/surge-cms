import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createResource, For, Show, } from 'solid-js';
import { api, } from '../../services/api';

const AdminMessages: Component = () => {
    const [messages,] = createResource(async () => {
        const response = await api.get('/messages',);
        return response.success ? (response as any).data : [];
    },);

    const statusBadge = (status: string,) => {
        switch (status) {
            case 'unread':
                return 'badge--info';
            case 'read':
                return 'badge--muted';
            case 'replied':
                return 'badge--success';
            case 'archived':
                return 'badge--muted';
            case 'spam':
                return 'badge--error';
            default:
                return 'badge--muted';
        }
    };

    return (
        <div>
            <Title>Messages - Admin - Surge Media</Title>
            <div class="admin-header">
                <h1>Contact Messages</h1>
            </div>
            <Show when={messages()?.length} fallback={<div class="empty-state">No messages yet.</div>}>
                <div class="admin-table-container">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Email</th>
                                <th>Subject</th>
                                <th>Status</th>
                                <th>Date</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={messages()}>
                                {(m: any,) => (
                                    <tr>
                                        <td>{m.name}</td>
                                        <td>{m.email}</td>
                                        <td>{m.subject || '(no subject)'}</td>
                                        <td>
                                            <span class={`badge ${statusBadge(m.status,)}`}>{m.status}</span>
                                        </td>
                                        <td>{new Date(m.createdAt,).toLocaleDateString()}</td>
                                        <td>
                                            <A href={`/admin/messages/${m.id}`} class="btn btn--small btn--secondary">
                                                View
                                            </A>
                                        </td>
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

export default AdminMessages;
