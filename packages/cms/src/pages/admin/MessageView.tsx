import { Title, } from '@solidjs/meta';
import { A, useParams, } from '@solidjs/router';
import { Component, createResource, Show, } from 'solid-js';
import { cms, } from '../../services/cmsClient';

const AdminMessageView: Component = () => {
    const params = useParams();

    const [message,] = createResource(() => params.id, async (id,) => {
        try {
            return await cms.messages.getById(id,);
        } catch {
            return null;
        }
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

    const handleStatusChange = async (status: string,) => {
        await cms.messages.updateStatus(params.id, { status, } as any,);
        window.location.reload();
    };

    return (
        <div>
            <Title>Message - Admin - RW</Title>
            <div class="admin-header">
                <A href="/admin/messages" class="btn btn--secondary">&larr; Back to Messages</A>
            </div>

            <Show when={message()} fallback={<div class="empty-state">Loading...</div>}>
                {(m: any,) => (
                    <div class="admin-form">
                        <div class="form-section">
                            <div
                                style={{
                                    display: 'flex',
                                    'justify-content': 'space-between',
                                    'align-items': 'center',
                                    'margin-bottom': '1rem',
                                }}
                            >
                                <h2 style={{ margin: '0', }}>{m().subject || '(No Subject)'}</h2>
                                <span class={`badge ${statusBadge(m().status,)}`}>{m().status}</span>
                            </div>

                            <div
                                style={{
                                    display: 'grid',
                                    'grid-template-columns': '1fr 1fr',
                                    gap: '1rem',
                                    'margin-bottom': '1.5rem',
                                }}
                            >
                                <div>
                                    <label style={{ 'font-weight': '600', 'font-size': '0.85rem', color: '#64748b', }}>
                                        From
                                    </label>
                                    <p style={{ margin: '0.25rem 0 0', }}>{m().name}</p>
                                </div>
                                <div>
                                    <label style={{ 'font-weight': '600', 'font-size': '0.85rem', color: '#64748b', }}>
                                        Email
                                    </label>
                                    <p style={{ margin: '0.25rem 0 0', }}>
                                        <a href={`mailto:${m().email}`}>{m().email}</a>
                                    </p>
                                </div>
                                <div>
                                    <label style={{ 'font-weight': '600', 'font-size': '0.85rem', color: '#64748b', }}>
                                        Date
                                    </label>
                                    <p style={{ margin: '0.25rem 0 0', }}>
                                        {new Date(m().createdAt,).toLocaleString()}
                                    </p>
                                </div>
                                <div>
                                    <label style={{ 'font-weight': '600', 'font-size': '0.85rem', color: '#64748b', }}>
                                        IP Address
                                    </label>
                                    <p style={{ margin: '0.25rem 0 0', }}>{m().ipAddress || '—'}</p>
                                </div>
                            </div>

                            <div style={{ 'margin-bottom': '1.5rem', }}>
                                <label style={{ 'font-weight': '600', 'font-size': '0.85rem', color: '#64748b', }}>
                                    Message
                                </label>
                                <div
                                    style={{
                                        'margin-top': '0.5rem',
                                        padding: '1rem',
                                        background: '#f8fafc',
                                        'border-radius': '6px',
                                        'border': '1px solid #e2e8f0',
                                        'white-space': 'pre-wrap',
                                        'line-height': '1.6',
                                    }}
                                >
                                    {m().message}
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '0.5rem', }}>
                                <Show when={m().status !== 'replied'}>
                                    <button class="btn btn--primary" onClick={() => handleStatusChange('replied',)}>
                                        Mark as Replied
                                    </button>
                                </Show>
                                <Show when={m().status !== 'archived'}>
                                    <button class="btn btn--secondary" onClick={() => handleStatusChange('archived',)}>
                                        Archive
                                    </button>
                                </Show>
                                <Show when={m().status !== 'spam'}>
                                    <button class="btn btn--secondary" onClick={() => handleStatusChange('spam',)}>
                                        Mark as Spam
                                    </button>
                                </Show>
                            </div>
                        </div>
                    </div>
                )}
            </Show>
        </div>
    );
};

export default AdminMessageView;
