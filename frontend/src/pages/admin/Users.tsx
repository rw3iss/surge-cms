import { Title, } from '@solidjs/meta';
import { useNavigate, } from '@solidjs/router';
import { Component, createResource, createSignal, For, Show, } from 'solid-js';
import { api, } from '../../services/api';

const AdminUsers: Component = () => {
    const navigate = useNavigate();
    const [users, { refetch, },] = createResource(async () => {
        const response = await api.get('/users',);
        return response.success ? (response as any).data : [];
    },);

    const [showForm, setShowForm,] = createSignal(false,);
    const [formEmail, setFormEmail,] = createSignal('',);
    const [formName, setFormName,] = createSignal('',);
    const [formPassword, setFormPassword,] = createSignal('',);
    const [formRole, setFormRole,] = createSignal('member',);
    const [formError, setFormError,] = createSignal('',);
    const [formSaving, setFormSaving,] = createSignal(false,);

    const resetForm = () => {
        setFormEmail('',);
        setFormName('',);
        setFormPassword('',);
        setFormRole('member',);
        setFormError('',);
    };

    const handleAddUser = async (e: Event,) => {
        e.preventDefault();
        setFormError('',);

        if (!formEmail() || !formName() || !formPassword()) {
            setFormError('All fields are required',);
            return;
        }

        if (formPassword().length < 8) {
            setFormError('Password must be at least 8 characters',);
            return;
        }

        setFormSaving(true,);
        const response = await api.post('/users', {
            email: formEmail(),
            displayName: formName(),
            password: formPassword(),
            role: formRole(),
        },);
        setFormSaving(false,);

        if (response.success) {
            resetForm();
            setShowForm(false,);
            refetch();
        } else {
            setFormError((response as any).error?.message || 'Failed to create user',);
        }
    };

    const roleBadge = (role: string,) => {
        switch (role) {
            case 'sysadmin':
                return 'badge--error';
            case 'admin':
                return 'badge--error';
            case 'member':
                return 'badge--success';
            default:
                return 'badge--muted';
        }
    };

    const statusBadge = (user: any,) => {
        if (user.isBanned) return { class: 'badge--error', label: 'Banned', };
        if (user.isActive) return { class: 'badge--success', label: 'Active', };
        return { class: 'badge--muted', label: 'Inactive', };
    };

    return (
        <div>
            <Title>Users - Admin - Surge Media</Title>
            <div class="admin-header">
                <h1>Users</h1>
                <button
                    class="btn btn--primary"
                    onClick={() => {
                        setShowForm(!showForm(),);
                        if (!showForm()) resetForm();
                    }}
                >
                    {showForm() ? 'Cancel' : 'Add User'}
                </button>
            </div>

            <Show when={showForm()}>
                <div class="admin-form" style={{ 'margin-bottom': '24px', }}>
                    <div class="form-section">
                        <h2>Add New User</h2>
                        <Show when={formError()}>
                            <div class="alert alert--error">{formError()}</div>
                        </Show>
                        <form onSubmit={handleAddUser}>
                            <div class="form-row">
                                <div class="form-group form-group--grow">
                                    <label>Email</label>
                                    <input
                                        type="email"
                                        value={formEmail()}
                                        onInput={(e,) => setFormEmail(e.currentTarget.value,)}
                                        placeholder="user@example.com"
                                        required
                                    />
                                </div>
                                <div class="form-group form-group--grow">
                                    <label>Display Name</label>
                                    <input
                                        type="text"
                                        value={formName()}
                                        onInput={(e,) => setFormName(e.currentTarget.value,)}
                                        placeholder="Full name"
                                        required
                                    />
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-group form-group--grow">
                                    <label>Password</label>
                                    <input
                                        type="password"
                                        value={formPassword()}
                                        onInput={(e,) => setFormPassword(e.currentTarget.value,)}
                                        placeholder="At least 8 characters"
                                        required
                                        minLength={8}
                                    />
                                </div>
                                <div class="form-group">
                                    <label>Role</label>
                                    <select value={formRole()} onChange={(e,) => setFormRole(e.currentTarget.value,)}>
                                        <option value="member">Member</option>
                                        <option value="admin">Admin</option>
                                        <option value="sysadmin">System Admin</option>
                                    </select>
                                </div>
                            </div>
                            <div class="form-actions">
                                <button type="submit" class="btn btn--primary" disabled={formSaving()}>
                                    {formSaving() ? 'Creating...' : 'Create User'}
                                </button>
                                <button
                                    type="button"
                                    class="btn btn--secondary"
                                    onClick={() => {
                                        setShowForm(false,);
                                        resetForm();
                                    }}
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </Show>

            <Show when={users()?.length} fallback={<div class="empty-state">No users yet.</div>}>
                <div class="admin-table-container">
                    <table class="admin-table">
                        <thead>
                            <tr>
                                <th>Email</th>
                                <th>Name</th>
                                <th>Role</th>
                                <th>Provider</th>
                                <th>Subscription</th>
                                <th>Status</th>
                                <th>Joined</th>
                            </tr>
                        </thead>
                        <tbody>
                            <For each={users()}>
                                {(user: any,) => {
                                    const status = statusBadge(user,);
                                    return (
                                        <tr
                                            style={{ cursor: 'pointer', }}
                                            onClick={() => navigate(`/admin/users/${user.id}`,)}
                                        >
                                            <td>{user.email}</td>
                                            <td>{user.displayName || '—'}</td>
                                            <td>
                                                <span class={`badge ${roleBadge(user.role,)}`}>{user.role}</span>
                                            </td>
                                            <td>{user.authProvider}</td>
                                            <td>
                                                {user.subscription ?
                                                    (
                                                        <span
                                                            class={`badge ${
                                                                user.subscription.status === 'active' ?
                                                                    'badge--success' :
                                                                    'badge--muted'
                                                            }`}
                                                        >
                                                            {user.subscription.planName}
                                                        </span>
                                                    ) :
                                                    '—'}
                                            </td>
                                            <td>
                                                <span class={`badge ${status.class}`}>{status.label}</span>
                                            </td>
                                            <td>{new Date(user.createdAt,).toLocaleDateString()}</td>
                                        </tr>
                                    );
                                }}
                            </For>
                        </tbody>
                    </table>
                </div>
            </Show>
        </div>
    );
};

export default AdminUsers;
