import { Title, } from '@solidjs/meta';
import { useNavigate, } from '@solidjs/router';
import { Component, createEffect, createSignal, For, Show, } from 'solid-js';
import Pagination from '../../components/admin/common/Pagination';
import SortTh from '../../components/admin/common/SortTh';
import { usePaginatedList, } from '../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../hooks/useSearchFilter';
import { api, } from '../../services/api';
import { cms, } from '../../services/cmsClient';
import { getRoleBadgeClass, getUserStatusBadge, } from '../../utils/badges';

function formatDate(iso: string | null | undefined,): string {
    if (!iso) return '—';
    return new Date(iso,).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', },);
}

const AdminUsers: Component = () => {
    const navigate = useNavigate();
    const { searchInput, handleSearchInput, searchParams, setSearchParams, } = useSearchFilter();
    const currentSort = () => searchParams.sort || 'created_at_desc';

    const sortBy = () => {
        const s = currentSort();
        if (s.endsWith('_asc',)) return s.slice(0, -4,);
        if (s.endsWith('_desc',)) return s.slice(0, -5,);
        return s;
    };
    const sortOrder = () => currentSort().endsWith('_asc',) ? 'asc' : 'desc';

    const list = usePaginatedList<any>({
        fetch: (p,) => cms.users.list(p,),
        initialLimit: 50,
        params: () => ({
            search: searchParams.search,
            role: searchParams.role,
            status: searchParams.status,
            sortBy: sortBy(),
            sortOrder: sortOrder(),
        }),
    },);

    createEffect(() => {
        searchParams.search;
        searchParams.role;
        searchParams.status;
        searchParams.sort;
        list.resetPage();
    },);

    const handleSort = (sort: string,) => setSearchParams({ sort, },);

    // Add user form
    const [showForm, setShowForm,] = createSignal(false,);
    const [formEmail, setFormEmail,] = createSignal('',);
    const [formName, setFormName,] = createSignal('',);
    const [formPassword, setFormPassword,] = createSignal('',);
    const [formRole, setFormRole,] = createSignal('member',);
    const [formError, setFormError,] = createSignal('',);
    const [formSaving, setFormSaving,] = createSignal(false,);

    const resetForm = () => {
        setFormEmail('',); setFormName('',); setFormPassword('',);
        setFormRole('member',); setFormError('',);
    };

    const handleAddUser = async (e: Event,) => {
        e.preventDefault();
        setFormError('',);
        if (!formEmail() || !formName() || !formPassword()) {
            setFormError('All fields are required',); return;
        }
        if (formPassword().length < 8) {
            setFormError('Password must be at least 8 characters',); return;
        }
        setFormSaving(true,);
        const response = await api.post('/users', {
            email: formEmail(), displayName: formName(),
            password: formPassword(), role: formRole(),
        },);
        setFormSaving(false,);
        if (response.success) {
            resetForm(); setShowForm(false,); list.refetch();
        } else {
            setFormError((response as any).error?.message || 'Failed to create user',);
        }
    };

    const roleBadge = getRoleBadgeClass;
    const statusBadge = getUserStatusBadge;

    return (
        <div>
            <Title>Users - Admin - RW</Title>
            <div class="admin-header">
                <h1>Users</h1>
                <button
                    class="btn btn--primary"
                    onClick={() => { setShowForm(!showForm(),); if (!showForm()) resetForm(); }}
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
                                    <input type="email" value={formEmail()} onInput={(e,) => setFormEmail(e.currentTarget.value,)} placeholder="user@example.com" required />
                                </div>
                                <div class="form-group form-group--grow">
                                    <label>Display Name</label>
                                    <input type="text" value={formName()} onInput={(e,) => setFormName(e.currentTarget.value,)} placeholder="Full name" required />
                                </div>
                            </div>
                            <div class="form-row">
                                <div class="form-group form-group--grow">
                                    <label>Password</label>
                                    <input type="password" value={formPassword()} onInput={(e,) => setFormPassword(e.currentTarget.value,)} placeholder="At least 8 characters" required minLength={8} />
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
                                <button type="button" class="btn btn--secondary" onClick={() => { setShowForm(false,); resetForm(); }}>
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            </Show>

            <div class="admin-filter-bar">
                <input
                    class="admin-filter-bar__search"
                    type="text"
                    placeholder="Search users..."
                    value={searchInput()}
                    onInput={(e,) => handleSearchInput(e.currentTarget.value,)}
                />
                <select
                    class="admin-filter-bar__select"
                    value={searchParams.role || ''}
                    onChange={(e,) => setSearchParams({ role: e.currentTarget.value || undefined, },)}
                >
                    <option value="">All roles</option>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                    <option value="sysadmin">Sysadmin</option>
                </select>
                <select
                    class="admin-filter-bar__select"
                    value={searchParams.status || ''}
                    onChange={(e,) => setSearchParams({ status: e.currentTarget.value || undefined, },)}
                >
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="banned">Banned</option>
                    <option value="inactive">Inactive</option>
                </select>
            </div>

            <Show
                when={!list.loading()}
                fallback={<div class="empty-state">Loading...</div>}
            >
                <Show
                    when={list.items().length}
                    fallback={<div class="empty-state">No users found.</div>}
                >
                    <div class="admin-table-container">
                        <table class="admin-table">
                            <thead>
                                <tr>
                                    <SortTh label="Email" field="email" current={currentSort()} onSort={handleSort} />
                                    <SortTh label="Name" field="display_name" current={currentSort()} onSort={handleSort} />
                                    <SortTh label="Role" field="role" current={currentSort()} onSort={handleSort} />
                                    <th>Provider</th>
                                    <th>Subscription</th>
                                    <th>Status</th>
                                    <SortTh label="Joined" field="created_at" current={currentSort()} onSort={handleSort} />
                                </tr>
                            </thead>
                            <tbody>
                                <For each={list.items()}>
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
                                                            <span class={`badge ${user.subscription.status === 'active' ? 'badge--success' : 'badge--muted'}`}>
                                                                {user.subscription.planName}
                                                            </span>
                                                        ) :
                                                        '—'}
                                                </td>
                                                <td>
                                                    <span class={`badge ${status.class}`}>{status.label}</span>
                                                </td>
                                                <td>{formatDate(user.createdAt,)}</td>
                                            </tr>
                                        );
                                    }}
                                </For>
                            </tbody>
                        </table>
                    </div>
                    <Pagination
                        page={list.page()}
                        totalPages={list.totalPages()}
                        total={list.total()}
                        limit={list.limit()}
                        onPageChange={list.setPage}
                    />
                </Show>
            </Show>
        </div>
    );
};

export default AdminUsers;
