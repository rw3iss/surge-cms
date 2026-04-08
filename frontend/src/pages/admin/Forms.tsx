import { Title, } from '@solidjs/meta';
import { A, } from '@solidjs/router';
import { Component, createResource, For, Show, } from 'solid-js';
import { api, } from '../../services/api';
import { getStatusBadgeClass, } from '../../utils/badges';

const AdminForms: Component = () => {
    const [forms,] = createResource(async () => {
        const response = await api.get('/forms?all=true',);
        return response.success ? (response as any).data : [];
    },);

    return (
        <div class="admin-forms">
            <Title>Forms - Admin - Surge Media</Title>

            <div class="admin-header">
                <h1>Forms</h1>
                <A href="/admin/forms/new" class="btn btn--primary">New Form</A>
            </div>

            <div class="admin-table-container">
                <table class="admin-table">
                    <thead>
                        <tr>
                            <th>Title</th>
                            <th>Status</th>
                            <th>Submissions</th>
                            <th>Created</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        <Show
                            when={!forms.loading}
                            fallback={
                                <tr>
                                    <td colspan="5">Loading...</td>
                                </tr>
                            }
                        >
                            <For
                                each={forms()}
                                fallback={
                                    <tr>
                                        <td colspan="5">No forms found</td>
                                    </tr>
                                }
                            >
                                {(form: any,) => (
                                    <tr>
                                        <td>
                                            <A href={`/admin/forms/${form.id}`} class="table-link">
                                                {form.title}
                                            </A>
                                        </td>
                                        <td>
                                            <span class={`badge ${getStatusBadgeClass(form.status,)}`}>
                                                {form.status}
                                            </span>
                                        </td>
                                        <td>{form.submissionCount || 0}</td>
                                        <td>{new Date(form.createdAt,).toLocaleDateString()}</td>
                                        <td>
                                            <A href={`/admin/forms/${form.id}`} class="btn btn--small">Edit</A>
                                            <Show when={form.submissionCount > 0}>
                                                <A
                                                    href={`/admin/forms/${form.id}/submissions`}
                                                    class="btn btn--small btn--secondary"
                                                >
                                                    View Responses
                                                </A>
                                            </Show>
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

export default AdminForms;
