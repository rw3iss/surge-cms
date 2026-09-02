import { Title, } from '@solidjs/meta';
import { A, useNavigate, } from '@solidjs/router';
import { Component, createEffect, createSignal, For, Show, } from 'solid-js';
import { formatDateShort as formatDate, } from '@sitesurge/types';
import DataTable from '../../components/admin/common/DataTable';
import UserPermissionsModal from '../../components/admin/users/UserPermissionsModal';
import { FormField, } from '../../components/admin/forms';
import { usePaginatedList, } from '../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../hooks/useSearchFilter';
import { cms, } from '../../services/cmsClient';
import { getRoleBadgeClass, getUserStatusBadge, } from '../../utils/badges';

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
    /** The user whose permissions modal is open. */
    const [permUser, setPermUser,] = createSignal<any>(null,);
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
        try {
            await cms.users.create({
                email: formEmail(), displayName: formName(),
                password: formPassword(), role: formRole(),
            } as any,);
            resetForm(); setShowForm(false,); list.refetch();
        } catch (e) {
            setFormError(e instanceof Error ? e.message : 'Failed to create user',);
        } finally {
            setFormSaving(false,);
        }
    };

    const roleBadge = getRoleBadgeClass;
    const statusBadge = getUserStatusBadge;

    return (
        <div>
            <Title>Users - Admin - RW</Title>
            <div class="admin-header">
                <h1>Users</h1>
                <div class="admin-header__actions">
                    <A href="/admin/users/settings" class="ui-button ui-button--secondary">Settings</A>
                    <button
                        class="ui-button ui-button--primary"
                        onClick={() => { setShowForm(!showForm(),); if (!showForm()) resetForm(); }}
                    >
                        {showForm() ? 'Cancel' : 'Add User'}
                    </button>
                </div>
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
                                <FormField label="Email" class="form-group--grow">
                                    <input type="email" value={formEmail()} onInput={(e,) => setFormEmail(e.currentTarget.value,)} placeholder="user@example.com" required />
                                </FormField>
                                <FormField label="Display Name" class="form-group--grow">
                                    <input type="text" value={formName()} onInput={(e,) => setFormName(e.currentTarget.value,)} placeholder="Full name" required />
                                </FormField>
                            </div>
                            <div class="form-row">
                                <FormField label="Password" class="form-group--grow">
                                    <input type="password" value={formPassword()} onInput={(e,) => setFormPassword(e.currentTarget.value,)} placeholder="At least 8 characters" required minLength={8} />
                                </FormField>
                                <FormField label="Role">
                                    <select value={formRole()} onChange={(e,) => setFormRole(e.currentTarget.value,)}>
                                        <option value="member">Member</option>
                                        <option value="editor">Editor</option>
                                        <option value="admin">Admin</option>
                                        <option value="sysadmin">System Admin</option>
                                    </select>
                                </FormField>
                            </div>
                            <div class="form-actions">
                                <button type="submit" class="ui-button ui-button--primary" disabled={formSaving()}>
                                    {formSaving() ? 'Creating...' : 'Create User'}
                                </button>
                                <button type="button" class="ui-button ui-button--secondary" onClick={() => { setShowForm(false,); resetForm(); }}>
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
                    <option value="editor">Editor</option>
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

            <DataTable
                items={list.items()}
                loading={list.loading()}
                emptyMessage="No users found."
                sort={{ current: currentSort(), onSort: handleSort, }}
                onRowClick={(user: any,) => navigate(`/admin/users/${user.id}`,)}
                pagination={{ page: list.page(), totalPages: list.totalPages(), total: list.total(), limit: list.limit(), onPageChange: list.setPage, }}
                columns={[
                    { header: 'Email', sortField: 'email', cell: (user: any,) => user.email, },
                    { header: 'Name', sortField: 'display_name', cell: (user: any,) => user.displayName || '—', },
                    { header: 'Role', sortField: 'role', cell: (user: any,) => <span class={`badge ${roleBadge(user.role,)}`}>{user.role}</span>, },
                    { header: 'Provider', cell: (user: any,) => user.authProvider, },
                    {
                        header: 'Subscription',
                        cell: (user: any,) =>
                            user.subscription
                                ? (
                                    <span class={`badge ${user.subscription.status === 'active' ? 'badge--success' : 'badge--muted'}`}>
                                        {user.subscription.planName}
                                    </span>
                                )
                                : '—',
                    },
                    { header: 'Status', cell: (user: any,) => { const s = statusBadge(user,); return <span class={`badge ${s.class}`}>{s.label}</span>; }, },
                    { header: 'Joined', sortField: 'created_at', cell: (user: any,) => formatDate(user.createdAt,), },
                    {
                        header: 'Permissions',
                        cell: (user: any,) => (
                            <button
                                type="button"
                                class="ui-button ui-button--secondary ui-button--sm"
                                // The row itself navigates to the user detail page, so a
                                // button inside it has to stop the click bubbling.
                                onClick={(e,) => { e.stopPropagation(); setPermUser(user,); }}
                            >
                                Manage
                            </button>
                        ),
                    },
                ]}
            />

            <UserPermissionsModal
                open={permUser() !== null}
                user={permUser()}
                onClose={() => setPermUser(null,)}
            />
        </div>
    );
};

export default AdminUsers;
