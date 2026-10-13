import { A, useNavigate, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, Show, } from 'solid-js';
import { formatDateShort as formatDate, } from '@sitesurge/types';
import DataTable from '../../components/admin/common/DataTable';
import UserPermissionsModal from '../../components/admin/users/UserPermissionsModal';
import { FormField, } from '../../components/admin/forms';
import { usePaginatedList, } from '../../hooks/usePaginatedList';
import { useSearchFilter, } from '../../hooks/useSearchFilter';
import { cms, } from '../../services/cmsClient';
import { getRoleBadgeClass, getUserStatusBadge, } from '../../utils/badges';
import AdminTitle from '../../components/admin/common/AdminTitle';
import ExportMenu from '../../components/admin/common/ExportMenu';
import ReplyActions from '../../components/admin/reply/ReplyActions';
import { useReplySummaries, } from '../../components/admin/reply/useReplySummaries';
import ReviewApplicationModal from '../../components/admin/applications/ReviewApplicationModal';
import { approvalBadge, } from '../../components/admin/applications/applicationStatus';
import '../../components/admin/applications/applications.scss';
import { useToast, } from '../../components/common/toast';
import ConfirmModal from '../../components/admin/common/ConfirmModal';
import InviteUserModal from '../../components/admin/users/InviteUserModal';
import InvitesPanel from '../../components/admin/users/InvitesPanel';
import { roleLabel, } from '../../components/admin/users/assignableRoles';

const AdminUsers: Component = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const { searchInput, handleSearchInput, searchParams, setSearchParams, } = useSearchFilter();
    const currentSort = () => searchParams.sort || 'created_at_desc';

    const sortBy = () => {
        const s = currentSort();
        if (s.endsWith('_asc',)) return s.slice(0, -4,);
        if (s.endsWith('_desc',)) return s.slice(0, -5,);
        return s;
    };
    const sortOrder = () => currentSort().endsWith('_asc',) ? 'asc' : 'desc';

    const [roles,] = createResource(() => cms.roles.list().catch(() => [],),);
    // Account invites: the modal, and the collapsible list (refreshKey reloads it).
    const [inviteOpen, setInviteOpen,] = createSignal(false,);
    const [invitesOpen, setInvitesOpen,] = createSignal(false,);
    const [invitesKey, setInvitesKey,] = createSignal(0,);
    const [tiers,] = createResource(() => cms.subscriptionTiers.list().catch(() => [],),);

    const list = usePaginatedList<any>({
        fetch: (p,) => cms.users.list(p,),
        initialLimit: 50,
        params: () => ({
            search: searchParams.search,
            role: searchParams.role,
            status: searchParams.status,
            subscription: searchParams.subscription,
            approval: searchParams.approval as 'pending' | 'approved' | 'rejected' | undefined,
            sortBy: sortBy(),
            sortOrder: sortOrder(),
        }),
    },);

    // Membership applications waiting for review (header pill).
    const [summary, { refetch: refetchPending, },] = createResource(
        () => cms.membershipApplications.summary().catch(() => ({ pending: 0, withoutAccount: 0, })),
    );
    const pending = () => summary()?.pending ?? 0;
    // Applications sent before the applicant signed up have no user row, so the
    // table cannot show them — list them separately.
    const [noAccountOpen, setNoAccountOpen,] = createSignal(false,);
    const [noAccount, { refetch: refetchNoAccount, },] = createResource(
        noAccountOpen,
        () => cms.membershipApplications.list({ status: 'pending', withoutAccount: true, limit: 100, },).then((r,) => r.data,).catch(() => []),
    );
    const togglePendingFilter = () =>
        setSearchParams({ approval: searchParams.approval === 'pending' ? undefined : 'pending', },);

    /** The application open in the review modal. */
    const [reviewId, setReviewId,] = createSignal<string | null>(null,);
    const openReview = async (userId: string,) => {
        try {
            const r = await cms.membershipApplications.list({ status: 'pending', userId, limit: 1, },);
            if (r.data[0]) setReviewId(r.data[0].id,);
            else toast.error('No pending application found for this user.',);
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not load the application.',);
        }
    };
    const messages = useReplySummaries('user', () => (list.items() as any[]).map((u,) => u.id as string),);

    createEffect(() => {
        searchParams.search;
        searchParams.role;
        searchParams.status;
        searchParams.subscription;
        searchParams.approval;
        searchParams.sort;
        list.resetPage();
        setSelected(new Set<string>(),);
    },);

    // ─── Bulk manage ───
    // Selection is per page/filter: cleared whenever either changes.
    const [selected, setSelected,] = createSignal(new Set<string>(),);
    createEffect(() => { list.page(); setSelected(new Set<string>(),); },);
    const toggleSel = (id: string,) => {
        const next = new Set(selected(),);
        if (next.has(id,)) next.delete(id,); else next.add(id,);
        setSelected(next,);
    };
    const allSel = (items: any[],) => items.length > 0 && items.every((u,) => selected().has(u.id,),);
    const toggleAllSel = (items: any[],) => setSelected(allSel(items,) ? new Set<string>() : new Set(items.map((u,) => u.id as string,),),);

    type BulkAction = 'delete' | 'ban' | 'unban' | 'activate' | 'deactivate' | 'role';
    const [bulkAsk, setBulkAsk,] = createSignal<BulkAction | null>(null,);
    const [bulkBusy, setBulkBusy,] = createSignal(false,);
    const [banReason, setBanReason,] = createSignal('',);
    const [bulkRole, setBulkRole,] = createSignal('member',);

    const runBulk = async (action: BulkAction,) => {
        const ids = [...selected(),];
        if (!ids.length) return;
        const value = action === 'ban' ? banReason().trim() || undefined : action === 'role' ? bulkRole() : undefined;
        setBulkBusy(true,);
        try {
            const r = await cms.users.bulk({ ids, action, value, },);
            const reasons = [...new Set(r.skipped.map((s,) => s.reason,),),];
            const msg = `Done: ${r.done} · Skipped: ${r.skipped.length}${reasons.length ? ` (${reasons.join('; ',)})` : ''}`;
            if (r.skipped.length) toast.warning(msg,); else toast.success(msg,);
            setSelected(new Set<string>(),);
            setBulkAsk(null,);
            setBanReason('',);
            list.refetch();
            void refetchPending();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : 'The bulk action failed.',);
        } finally {
            setBulkBusy(false,);
        }
    };
    const n = () => selected().size;
    const people = () => `${n()} user${n() === 1 ? '' : 's'}`;
    const BULK_TEXT: Record<BulkAction, { title: () => string; message: () => string; label: string; danger?: boolean; }> = {
        delete: { title: () => `Delete ${people()} permanently?`, message: () => 'Their accounts and data are removed. This cannot be undone.', label: 'Delete permanently', danger: true, },
        ban: { title: () => `Ban ${people()}?`, message: () => 'They are signed out and cannot sign in until unbanned.', label: 'Ban', danger: true, },
        deactivate: { title: () => `Deactivate ${people()}?`, message: () => 'They cannot sign in until activated again.', label: 'Deactivate', danger: true, },
        role: { title: () => `Change the role of ${people()}?`, message: () => 'Their permissions change to those of the new role.', label: 'Change role', },
        unban: { title: () => `Unban ${people()}?`, message: () => '', label: 'Unban', },
        activate: { title: () => `Activate ${people()}?`, message: () => '', label: 'Activate', },
    };

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
            <AdminTitle>Users</AdminTitle>
            <div class="admin-header">
                <div class="users-title">
                <h1>Users</h1>
                <Show when={(pending() ?? 0) > 0}>
                    <button
                        type="button"
                        class="users-pending-pill"
                        classList={{ 'is-active': searchParams.approval === 'pending', }}
                        title={searchParams.approval === 'pending' ? 'Show all users' : 'Show only users waiting for approval'}
                        onClick={togglePendingFilter}
                    >
                        {pending()} pending application{pending() === 1 ? '' : 's'}
                    </button>
                </Show>
                <Show when={(summary()?.withoutAccount ?? 0) > 0}>
                    <button
                        type="button"
                        class="users-pending-pill users-pending-pill--quiet"
                        classList={{ 'is-active': noAccountOpen(), }}
                        title="Applications sent before the applicant created an account"
                        onClick={() => setNoAccountOpen(!noAccountOpen(),)}
                    >
                        {summary()!.withoutAccount} not signed up yet
                    </button>
                </Show>
                </div>
                <div class="admin-header__actions">
                    <A href="/admin/users/settings" class="ui-button ui-button--secondary">Settings</A>
                    <button type="button" class="ui-button ui-button--secondary" onClick={() => setInvitesOpen(!invitesOpen(),)}>
                        {invitesOpen() ? 'Hide invites' : 'Invites'}
                    </button>
                    <button type="button" class="ui-button ui-button--secondary" onClick={() => setInviteOpen(true,)}>Invite</button>
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
                {/* `selected` on each option, not `value` on the select: the role and
                    subscription options load asynchronously, and a select cannot take a
                    value before the matching option exists — so a refreshed page with
                    ?role=… showed "All roles" while still filtering by it. */}
                <select
                    class="admin-filter-bar__select"
                    onChange={(e,) => setSearchParams({ role: e.currentTarget.value || undefined, },)}
                >
                    <option value="" selected={!searchParams.role}>All roles</option>
                    <For each={(roles() ?? []).filter((r,) => r.key !== 'anonymous',)}>
                        {(r,) => <option value={r.key} selected={searchParams.role === r.key}>{r.label}</option>}
                    </For>
                </select>
                <select
                    class="admin-filter-bar__select"
                    onChange={(e,) => setSearchParams({ status: e.currentTarget.value || undefined, },)}
                >
                    <option value="" selected={!searchParams.status}>All statuses</option>
                    <For each={[['active', 'Active',], ['banned', 'Banned',], ['inactive', 'Inactive',],]}>
                        {([v, label,],) => <option value={v} selected={searchParams.status === v}>{label}</option>}
                    </For>
                </select>
                <select
                    class="admin-filter-bar__select"
                    onChange={(e,) => setSearchParams({ subscription: e.currentTarget.value || undefined, },)}
                >
                    <option value="" selected={!searchParams.subscription}>All memberships</option>
                    <For each={tiers() ?? []}>
                        {(t,) => <option value={t.slug} selected={searchParams.subscription === t.slug}>{t.name}</option>}
                    </For>
                </select>
                <select
                    class="admin-filter-bar__select"
                    onChange={(e,) => setSearchParams({ approval: e.currentTarget.value || undefined, },)}
                >
                    <option value="" selected={!searchParams.approval}>All approvals</option>
                    <For each={[['pending', 'Pending approval',], ['approved', 'Approved',], ['rejected', 'Rejected',],]}>
                        {([v, label,],) => <option value={v} selected={searchParams.approval === v}>{label}</option>}
                    </For>
                </select>
                {/* Every user matching the current search, filters and sort. */}
                <div style={{ 'margin-left': 'auto', }}>
                    <ExportMenu
                        url={(format, query,) => cms.exports.usersUrl(format, query,)}
                        query={() => ({
                            search: searchParams.search, role: searchParams.role, status: searchParams.status,
                            subscription: searchParams.subscription,
                            approval: searchParams.approval,
                            sortBy: sortBy(), sortOrder: sortOrder(),
                        })}
                    />
                </div>
            </div>

            <Show when={invitesOpen()}>
                <InvitesPanel roles={roles() ?? []} refreshKey={invitesKey()} />
            </Show>

            <Show when={noAccountOpen()}>
                <section class="users-no-account">
                    <h3>Applications from people without an account yet</h3>
                    <p class="form-help-muted">They applied before signing up. You can read and reject them now; approve once they create their account and add a card.</p>
                    <Show when={!noAccount.loading} fallback={<p class="form-help-muted">Loading…</p>}>
                        <Show when={(noAccount() ?? []).length} fallback={<p class="form-help-muted">None.</p>}>
                            <ul>
                                <For each={noAccount()}>
                                    {(a,) => (
                                        <li>
                                            <span><strong>{a.contactEmail ?? 'No email'}</strong> · {a.tierName} · {new Date(a.createdAt,).toLocaleDateString()}</span>
                                            <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={() => setReviewId(a.id,)}>Review</button>
                                        </li>
                                    )}
                                </For>
                            </ul>
                        </Show>
                    </Show>
                </section>
            </Show>

            <DataTable
                items={list.items()}
                loading={list.loading()}
                emptyMessage="No users found."
                sort={{ current: currentSort(), onSort: handleSort, }}
                onRowClick={(user: any,) => navigate(`/admin/users/${user.id}`,)}
                bulk={{
                    selectedCount: n,
                    isSelected: (id,) => selected().has(id,),
                    toggle: toggleSel,
                    allSelected: allSel,
                    toggleAll: toggleAllSel,
                    clear: () => setSelected(new Set<string>(),),
                    actions: [
                        { label: 'Ban…', onClick: () => setBulkAsk('ban',), },
                        { label: 'Unban', onClick: () => void runBulk('unban',), },
                        { label: 'Activate', onClick: () => void runBulk('activate',), },
                        { label: 'Deactivate…', onClick: () => setBulkAsk('deactivate',), },
                        { label: 'Change role…', onClick: () => setBulkAsk('role',), },
                        { label: 'Delete permanently…', variant: 'danger', onClick: () => setBulkAsk('delete',), },
                    ],
                }}
                pagination={{ page: list.page(), totalPages: list.totalPages(), total: list.total(), limit: list.limit(), onPageChange: list.setPage, }}
                columns={[
                    { header: 'Email', sortField: 'email', cell: (user: any,) => user.email, },
                    { header: 'Name', sortField: 'display_name', cell: (user: any,) => user.displayName || '—', },
                    {
                        header: 'Role',
                        sortField: 'role',
                        cell: (user: any,) => (
                            <>
                                <span class={`badge ${roleBadge(user.role,)}`}>{user.role}</span>
                                {/* Additional roles (kept when the membership changes). */}
                                <For each={(user.extraRoles ?? []) as string[]}>
                                    {(r,) => <span class="badge badge--info users-extra-role" title="Additional role">+ {roleLabel(roles(), r,)}</span>}
                                </For>
                            </>
                        ),
                    },
                    { header: 'Provider', cell: (user: any,) => user.authProvider, },
                    {
                        header: 'Membership',
                        cell: (user: any,) =>
                            user.subscription
                                ? (
                                    <span class={`badge ${user.subscription.status === 'active' ? 'badge--success' : 'badge--muted'}`}>
                                        {user.subscription.planName}
                                    </span>
                                )
                                : <span class="badge badge--muted">Free</span>,
                    },
                    {
                        header: 'Approval',
                        cell: (user: any,) => (
                            <Show when={approvalBadge(user.approvalStatus,)} fallback={<span class="form-help-muted">—</span>}>
                                {(b,) => (
                                    <span class="users-approval-cell">
                                        <span class={b().cls}>{b().label}</span>
                                        <Show when={user.approvalStatus === 'pending'}>
                                            <button
                                                type="button"
                                                class="ui-button ui-button--primary ui-button--sm"
                                                onClick={(e,) => { e.stopPropagation(); void openReview(user.id,); }}
                                            >
                                                Review
                                            </button>
                                        </Show>
                                    </span>
                                )}
                            </Show>
                        ),
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
                    {
                        header: 'Message',
                        cell: (user: any,) => (
                            // Stop the row's navigate — including clicks inside the
                            // (portalled) modals, which bubble through this span.
                            <span onClick={(e,) => e.stopPropagation()}>
                                <ReplyActions
                                    source="user"
                                    subjectId={user.id}
                                    record={{ userId: user.id, }}
                                    summary={messages.get(user.id,)}
                                    onChanged={messages.refetch}
                                    kind="message"
                                />
                            </span>
                        ),
                    },
                ]}
            />

            <Show when={bulkAsk()}>
                {(action,) => (
                    <ConfirmModal
                        open
                        title={BULK_TEXT[action()].title()}
                        message={BULK_TEXT[action()].message() || undefined}
                        confirmLabel={BULK_TEXT[action()].label}
                        busyLabel="Working…"
                        loading={bulkBusy()}
                        danger={BULK_TEXT[action()].danger}
                        onConfirm={() => void runBulk(action(),)}
                        onCancel={() => setBulkAsk(null,)}
                    >
                        <Show when={action() === 'ban'}>
                            <FormField label="Reason (optional)">
                                <input type="text" maxLength={500} value={banReason()} onBlur={(e,) => setBanReason(e.currentTarget.value,)} />
                            </FormField>
                        </Show>
                        <Show when={action() === 'role'}>
                            <FormField label="New role">
                                <select value={bulkRole()} onChange={(e,) => setBulkRole(e.currentTarget.value,)}>
                                    <For each={(roles() ?? []).filter((r,) => r.key !== 'anonymous',)}>
                                        {(r,) => <option value={r.key}>{r.label}</option>}
                                    </For>
                                </select>
                            </FormField>
                        </Show>
                    </ConfirmModal>
                )}
            </Show>

            <Show when={reviewId()}>
                <ReviewApplicationModal
                    applicationId={reviewId()!}
                    onClose={() => setReviewId(null,)}
                    onDecided={() => { setReviewId(null,); list.refetch(); void refetchPending(); if (noAccountOpen()) void refetchNoAccount(); }}
                />
            </Show>

            <Show when={inviteOpen()}>
                <InviteUserModal
                    roles={roles() ?? []}
                    onClose={() => setInviteOpen(false,)}
                    onDone={() => { setInviteOpen(false,); setInvitesKey(invitesKey() + 1,); list.refetch(); }}
                />
            </Show>

            <UserPermissionsModal
                open={permUser() !== null}
                user={permUser()}
                onClose={() => setPermUser(null,)}
            />
        </div>
    );
};

export default AdminUsers;
