import { A, useNavigate, useParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, For, Show, } from 'solid-js';
import { primaryRoleOptions, roleLabel, } from '../../components/admin/users/assignableRoles';
import { FormField, } from '../../components/admin/forms';
import ConfirmModal from '../../components/admin/common/ConfirmModal';
import { useAuth, } from '../../stores/auth';
import UserRolesPanel from '../../components/admin/users/UserRolesPanel';
import Toggle from '../../components/admin/common/Toggle';
import { cms, } from '../../services/cmsClient';
import { getRoleBadgeClass, } from '../../utils/badges';
import { isFeatureEnabled, } from '../../stores/siteSettings';
import './UserDetail.scss';
import AdminTitle from '../../components/admin/common/AdminTitle';
import UserSubscriptionPanel from '../../components/admin/subscriptions/UserSubscriptionPanel';
import UserMessagesPanel from '../../components/admin/users/UserMessagesPanel';
import UserApplicationsPanel from '../../components/admin/applications/UserApplicationsPanel';

/** Text fields commit on BLUR (and Enter), never per keystroke (ADMIN_STYLES.md). */
const commitOnBlur = (set: (v: string,) => void,) => (e: FocusEvent & { currentTarget: HTMLInputElement; },) => set(e.currentTarget.value.trim(),);
const blurOnEnter = (e: KeyboardEvent & { currentTarget: HTMLInputElement; },) => {
    if (e.key === 'Enter') e.currentTarget.blur();
};

const AdminUserDetail: Component = () => {
    const params = useParams<{ id: string, }>();
    const navigate = useNavigate();

    const [userData, { refetch, },] = createResource(() => params.id, async (id,) => {
        try {
            return await cms.users.getById(id,) as any;
        } catch {
            return null;
        }
    },);

    // Activity (comments + forum) via the public member profile — staff see
    // hidden pages too. Zeros when the member has no handle yet.
    const discussionsOn = () => isFeatureEnabled('comments',) || isFeatureEnabled('forum',);
    const [memberProfile,] = createResource(
        () => (discussionsOn() ? (userData()?.user as { handle?: string | null; } | undefined)?.handle ?? null : null),
        (handle,) => cms.members.profile(handle,).catch(() => null),
    );

    // Editable fields
    const [displayName, setDisplayName,] = createSignal('',);
    /** Public member handle (/members/:handle). */
    const [handle, setHandle,] = createSignal('',);
    const [role, setRole,] = createSignal('member',);
    const [roles,] = createResource(() => cms.roles.list().catch(() => [],),);
    const auth = useAuth();
    const callerIsSysadmin = () => auth.user?.role === 'sysadmin';
    /** Main-role choices (sysadmin only for a sysadmin) — always including the user's current role. */
    const roleChoices = () => {
        const opts = primaryRoleOptions(roles(), auth.user?.role,);
        const cur = (roles() ?? []).find((r,) => r.key === role(),);
        return cur && !opts.some((r,) => r.key === cur.key,) ? [...opts, cur,] : opts;
    };
    const [confirmDelete, setConfirmDelete,] = createSignal(false,);
    const [deleting, setDeleting,] = createSignal(false,);
    /** Additional roles (`users.extra_roles`) — kept when the membership changes. */
    const [extraRoles, setExtraRoles,] = createSignal<string[]>([],);
    const [isActive, setIsActive,] = createSignal(true,);

    // Password change
    const [showPassword, setShowPassword,] = createSignal(false,);
    const [newPassword, setNewPassword,] = createSignal('',);
    const [passwordSaving, setPasswordSaving,] = createSignal(false,);

    // Ban form
    const [showBanForm, setShowBanForm,] = createSignal(false,);
    const [banReason, setBanReason,] = createSignal('',);
    const [banExpiry, setBanExpiry,] = createSignal('',);

    // UI state
    const [saving, setSaving,] = createSignal(false,);
    const [success, setSuccess,] = createSignal('',);
    const [error, setError,] = createSignal('',);

    // Avatar upload
    let avatarInput: HTMLInputElement | undefined;

    createEffect(() => {
        const data = userData();
        if (!data?.user) return;
        const u = data.user;
        setDisplayName(u.displayName || '',);
        setHandle(u.handle || '',);
        setRole(u.role || 'member',);
        setExtraRoles(u.extraRoles ?? [],);
        setIsActive(u.isActive ?? true,);
    },);

    const user = () => userData()?.user;
    const membership = () => userData()?.membership;

    const clearMessages = () => { setError('',); setSuccess('',); };

    const handleSave = async () => {
        setSaving(true,);
        clearMessages();
        try {
            await cms.users.update(params.id, {
                displayName: displayName(),
                role: role(),
                isActive: isActive(),
                // Only sent when set: an empty field must not blank a handle
                // (the server validates format + uniqueness; 409 when taken).
                ...(handle().trim() ? { handle: handle().trim(), } : {}),
            } as any,);
            setSuccess('Profile updated.',);
            refetch();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to update',);
        } finally {
            setSaving(false,);
        }
    };

    const handleAvatarUpload = async (e: Event,) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        clearMessages();
        try {
            await cms.users.uploadAvatar(params.id, file,);
            input.value = '';
            setSuccess('Avatar updated.',);
            refetch();
        } catch (err) {
            input.value = '';
            setError(err instanceof Error ? err.message : 'Failed to upload avatar',);
        }
    };

    const handlePasswordChange = async () => {
        if (newPassword().length < 8) {
            setError('Password must be at least 8 characters',);
            return;
        }
        setPasswordSaving(true,);
        clearMessages();
        try {
            await cms.users.setPassword(params.id, { password: newPassword(), } as any,);
            setSuccess('Password changed.',);
            setNewPassword('',);
            setShowPassword(false,);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to change password',);
        } finally {
            setPasswordSaving(false,);
        }
    };

    const handleBan = async () => {
        clearMessages();
        const body: Record<string, unknown> = {};
        if (banReason()) body.reason = banReason();
        if (banExpiry()) body.expiresAt = new Date(banExpiry(),).toISOString();
        try {
            await cms.users.ban(params.id, body as any,);
            setSuccess('User banned.',);
            setShowBanForm(false,);
            setBanReason('',);
            setBanExpiry('',);
            refetch();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to ban user',);
        }
    };

    /** Email verification (support): send a new link, or mark the address verified. */
    const resendVerificationLink = async () => {
        clearMessages();
        try {
            const r = await cms.users.resendVerification(params.id,);
            setSuccess(r.sent ? 'A new verification link was sent.' : 'This email address is already verified.',);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not send the link.',);
        }
    };
    const markVerified = async () => {
        clearMessages();
        try {
            await cms.users.markEmailVerified(params.id,);
            setSuccess('Email marked as verified.',);
            refetch();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not mark the email verified.',);
        }
    };

    const handleUnban = async () => {
        clearMessages();
        try {
            await cms.users.unban(params.id,);
            setSuccess('User unbanned.',);
            refetch();
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to unban user',);
        }
    };

    const handleDelete = async () => {
        setDeleting(true,);
        try {
            await cms.users.remove(params.id,);
            navigate('/admin/users',);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to delete user',);
        } finally {
            setDeleting(false,);
            setConfirmDelete(false,);
        }
    };

    const formatDate = (d: string | Date | undefined,) => {
        if (!d) return '—';
        return new Date(d,).toLocaleString();
    };

    const statusInfo = () => {
        const u = user();
        if (!u) return { cls: '', label: '', };
        if (u.isBanned) return { cls: 'badge--error', label: 'Banned', };
        if (u.isActive) return { cls: 'badge--success', label: 'Active', };
        return { cls: 'badge--muted', label: 'Inactive', };
    };

    const roleBadge = getRoleBadgeClass;

    return (
        <div class="user-detail">
            <AdminTitle>{user()?.displayName || 'User'}</AdminTitle>

            <div class="admin-header">
                <A href="/admin/users" class="admin-header__back">&larr; All Users</A>
                <h1>{user()?.displayName || user()?.email || 'User'}</h1>
                <Show when={user()}>
                    <div class="admin-header__actions">
                        <button type="button" class="ui-button ui-button--danger" onClick={() => setConfirmDelete(true,)}>
                            Delete Account
                        </button>
                        <button
                            type="button"
                            class="ui-button ui-button--primary"
                            disabled={saving()}
                            onClick={handleSave}
                        >
                            {saving() ? 'Saving...' : 'Save Profile'}
                        </button>
                    </div>
                </Show>
            </div>

            <Show when={success()}>
                <div class="alert alert--success">{success()}</div>
            </Show>
            <Show when={error()}>
                <div class="alert alert--error">{error()}</div>
            </Show>

            <Show when={user()} fallback={<div class="user-detail__loading">Loading user...</div>}>
                {/* ─── Top: Avatar + Identity ─── */}
                <div class="user-detail__header">
                    <div
                        class="user-detail__avatar"
                        onClick={() => avatarInput?.click()}
                        title="Click to change avatar"
                    >
                        <Show
                            when={user()?.avatarUrl}
                            fallback={
                                <div class="user-detail__avatar-placeholder">
                                    {(user()?.displayName || user()?.email || '?').charAt(0,).toUpperCase()}
                                </div>
                            }
                        >
                            <img src={user()!.avatarUrl} alt="" />
                        </Show>
                        <div class="user-detail__avatar-overlay">
                            <span>Change</span>
                        </div>
                        <input
                            ref={avatarInput}
                            type="file"
                            accept="image/*"
                            class="user-detail__avatar-input"
                            onChange={handleAvatarUpload}
                        />
                    </div>
                    <div class="user-detail__identity">
                        <p class="user-detail__name">{user()?.displayName || '(no name)'}</p>
                        <p class="user-detail__email">{user()?.email}</p>
                        <div class="user-detail__badges">
                            <span class={`badge ${statusInfo().cls}`}>{statusInfo().label}</span>
                            <Show when={user()?.emailVerified === false}>
                                <span class="badge badge--warning" title="This account has not confirmed its email address yet">Email not verified</span>
                            </Show>
                            <span class={`badge ${roleBadge(user()?.role || '',)}`}>{roleLabel(roles(), user()?.role || '',)}</span>
                            <For each={user()?.extraRoles ?? []}>
                                {(r,) => <span class="badge badge--info" title="Additional role">+ {roleLabel(roles(), r,)}</span>}
                            </For>
                            <Show when={user()?.authProvider}>
                                <span class="badge badge--muted">{user()?.authProvider}</span>
                            </Show>
                            <Show when={user()?.patreonTier}>
                                <span class="badge badge--info">{user()?.patreonTier}</span>
                            </Show>
                        </div>
                    </div>
                </div>

                <div class="user-detail__grid">
                    {/* ─── Left: Profile Edit ─── */}
                    <div class="user-detail__panel">
                        <h2 class="user-detail__panel-title">Profile</h2>

                        <div class="admin-form-row">
                            <FormField label="Display Name">
                                <input type="text" class="user-detail__field--name" value={displayName()} onBlur={commitOnBlur(setDisplayName,)} onKeyDown={blurOnEnter} />
                            </FormField>
                            <FormField
                                label="Handle"
                                hint={`3–40 characters: lowercase letters, numbers, - and _. Public page: ${handle().trim() ? `/members/${handle().trim().toLowerCase()}` : '—'}`}
                            >
                                <div class="user-detail__handle">
                                    <span class="user-detail__handle-prefix">@</span>
                                    <input
                                        type="text"
                                        class="user-detail__field--handle"
                                        maxLength={40}
                                        value={handle()}
                                        placeholder="member-handle"
                                        onBlur={commitOnBlur(setHandle,)}
                                        onKeyDown={blurOnEnter}
                                    />
                                </div>
                            </FormField>
                        </div>
                        <div class="admin-form-row">
                            <FormField label="Role" hint={role() === 'sysadmin' && !callerIsSysadmin() ? 'Only a sysadmin can change a sysadmin.' : undefined}>
                                <select
                                    class="user-detail__field--role"
                                    value={role()}
                                    disabled={role() === 'sysadmin' && !callerIsSysadmin()}
                                    onChange={(e,) => setRole(e.currentTarget.value,)}
                                >
                                    {/* Built-in + custom roles (Settings → Permissions → Roles); sysadmin only for a sysadmin. */}
                                    <For each={roleChoices()}>{(r,) => <option value={r.key} selected={role() === r.key}>{r.label}</option>}</For>
                                </select>
                            </FormField>
                            <FormField label="Active">
                                <Toggle
                                    checked={isActive()}
                                    onChange={setIsActive}
                                    label={isActive() ? 'Enabled' : 'Disabled'}
                                />
                            </FormField>
                        </div>
                    </div>

                    {/* ─── Right: Info ─── */}
                    <div class="user-detail__panel user-detail__panel--info">
                        <h2 class="user-detail__panel-title">Information</h2>

                        <div class="user-detail__info-grid">
                            <div class="user-detail__info-item">
                                <span class="user-detail__info-label">Email</span>
                                <span class="user-detail__info-value">{user()?.email}</span>
                            </div>
                            <div class="user-detail__info-item">
                                <span class="user-detail__info-label">Provider</span>
                                <span class="user-detail__info-value">{user()?.authProvider || '—'}</span>
                            </div>
                            <div class="user-detail__info-item">
                                <span class="user-detail__info-label">Joined</span>
                                <span class="user-detail__info-value">{formatDate(user()?.createdAt,)}</span>
                            </div>
                            <div class="user-detail__info-item">
                                <span class="user-detail__info-label">Last Login</span>
                                <span class="user-detail__info-value">{formatDate(user()?.lastLoginAt,)}</span>
                            </div>
                            <div class="user-detail__info-item">
                                <span class="user-detail__info-label">Updated</span>
                                <span class="user-detail__info-value">{formatDate(user()?.updatedAt,)}</span>
                            </div>
                            <Show when={user()?.patreonId}>
                                <div class="user-detail__info-item">
                                    <span class="user-detail__info-label">Patreon ID</span>
                                    <span class="user-detail__info-value user-detail__info-value--mono">{user()?.patreonId}</span>
                                </div>
                            </Show>
                        </div>

                        <Show when={membership()}>
                            <h3 class="user-detail__section-title">Patreon Membership</h3>
                            <div class="user-detail__info-grid">
                                <div class="user-detail__info-item">
                                    <span class="user-detail__info-label">Status</span>
                                    <span class={`badge ${membership()?.patronStatus === 'active_patron' ? 'badge--success' : 'badge--muted'}`}>
                                        {membership()?.patronStatus}
                                    </span>
                                </div>
                                <Show when={membership()?.lifetimeSupportCents}>
                                    <div class="user-detail__info-item">
                                        <span class="user-detail__info-label">Lifetime Support</span>
                                        <span class="user-detail__info-value">
                                            ${((membership()?.lifetimeSupportCents || 0) / 100).toFixed(2,)}
                                        </span>
                                    </div>
                                </Show>
                                <Show when={membership()?.lastChargeDate}>
                                    <div class="user-detail__info-item">
                                        <span class="user-detail__info-label">Last Charge</span>
                                        <span class="user-detail__info-value">{formatDate(membership()?.lastChargeDate,)}</span>
                                    </div>
                                </Show>
                            </div>
                        </Show>
                    </div>
                </div>

                <UserRolesPanel
                    userId={params.id}
                    role={user()?.role || 'member'}
                    extraRoles={extraRoles()}
                    roles={roles()}
                    onChanged={() => refetch()}
                />
                <UserSubscriptionPanel userId={params.id} onChanged={() => refetch()} />

                <UserApplicationsPanel userId={params.id} onChanged={() => refetch()} />

                {/* ─── Activity (comments + forum) + public member page ─── */}
                <div class="user-detail__panel user-detail__panel--activity">
                    <h2 class="user-detail__panel-title">Activity</h2>
                    <Show when={discussionsOn()}>
                        <div class="user-detail__info-grid">
                            <div class="user-detail__info-item">
                                <span class="user-detail__info-label">Total posts</span>
                                <span class="user-detail__info-value">{(memberProfile()?.activity.total ?? 0).toLocaleString()}</span>
                            </div>
                            <div class="user-detail__info-item">
                                <span class="user-detail__info-label">Comments</span>
                                <span class="user-detail__info-value">{(memberProfile()?.activity.comments ?? 0).toLocaleString()}</span>
                            </div>
                            <div class="user-detail__info-item">
                                <span class="user-detail__info-label">Forum threads</span>
                                <span class="user-detail__info-value">{(memberProfile()?.activity.forumThreads ?? 0).toLocaleString()}</span>
                            </div>
                            <div class="user-detail__info-item">
                                <span class="user-detail__info-label">Forum replies</span>
                                <span class="user-detail__info-value">{(memberProfile()?.activity.forumReplies ?? 0).toLocaleString()}</span>
                            </div>
                            <div class="user-detail__info-item">
                                <span class="user-detail__info-label">Last active</span>
                                <span class="user-detail__info-value">{formatDate(memberProfile()?.activity.lastActiveAt ?? undefined,)}</span>
                            </div>
                        </div>
                    </Show>
                    <div class="user-detail__info-grid">
                        <div class="user-detail__info-item">
                            <span class="user-detail__info-label">Member page</span>
                            <span class="user-detail__info-value">
                                <Show when={user()?.handle} fallback={'No handle yet (assigned on their next sign-in)'}>
                                    <a href={`/members/${user()!.handle}`} target="_blank" rel="noopener">/members/{user()!.handle}</a>
                                    <Show when={user()?.profilePublic === false}> (hidden by the member)</Show>
                                </Show>
                            </span>
                        </div>
                    </div>
                    <Show when={discussionsOn()}>
                        <div class="user-detail__activity-links">
                            <Show when={user()?.handle}>
                                <a class="ui-button ui-button--sm ui-button--secondary" href={`/members/${user()!.handle}?tab=comments`} target="_blank" rel="noopener">
                                    Public comments
                                </a>
                            </Show>
                            <A class="ui-button ui-button--sm ui-button--secondary" href={`/admin/comments?authorId=${params.id}`}>
                                Moderate their comments
                            </A>
                        </div>
                    </Show>
                </div>

                <UserMessagesPanel userId={params.id} />

                {/* ─── Actions Panel ─── */}
                <div class="user-detail__panel user-detail__panel--actions">
                    <h2 class="user-detail__panel-title">Account Actions</h2>

                    <div class="user-detail__actions-row">
                        {/* Password */}
                        <div class="user-detail__action-group">
                            <Show
                                when={showPassword()}
                                fallback={
                                    <button
                                        class="ui-button ui-button--secondary ui-button--sm"
                                        onClick={() => setShowPassword(true,)}
                                    >
                                        Change Password
                                    </button>
                                }
                            >
                                <div class="user-detail__inline-form">
                                    <input
                                        type="password"
                                        placeholder="New password (min 8 chars)"
                                        value={newPassword()}
                                        onInput={(e,) => setNewPassword(e.currentTarget.value,)}
                                        class="settings-field__input user-detail__field--password"
                                    />
                                    <button
                                        class="ui-button ui-button--primary ui-button--sm"
                                        disabled={passwordSaving() || newPassword().length < 8}
                                        onClick={handlePasswordChange}
                                    >
                                        {passwordSaving() ? 'Saving...' : 'Set Password'}
                                    </button>
                                    <button
                                        class="ui-button ui-button--secondary ui-button--sm"
                                        onClick={() => { setShowPassword(false,); setNewPassword('',); }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </Show>
                        </div>

                        {/* Email verification (only while unverified) */}
                        <Show when={user()?.emailVerified === false}>
                            <div class="user-detail__action-group">
                                <button class="ui-button ui-button--secondary ui-button--sm" onClick={() => void resendVerificationLink()}>
                                    Resend verification
                                </button>
                                <button class="ui-button ui-button--secondary ui-button--sm" onClick={() => void markVerified()}>
                                    Mark email verified
                                </button>
                            </div>
                        </Show>

                        {/* Ban / Unban */}
                        <div class="user-detail__action-group">
                            <Show
                                when={!user()?.isBanned}
                                fallback={
                                    <button class="ui-button ui-button--secondary ui-button--sm" onClick={handleUnban}>
                                        Unban User
                                    </button>
                                }
                            >
                                <Show
                                    when={showBanForm()}
                                    fallback={
                                        <button
                                            class="ui-button ui-button--danger ui-button--sm"
                                            onClick={() => setShowBanForm(true,)}
                                        >
                                            Suspend User
                                        </button>
                                    }
                                >
                                    <div class="user-detail__inline-form">
                                        <input
                                            type="text"
                                            placeholder="Reason (optional)"
                                            value={banReason()}
                                            onInput={(e,) => setBanReason(e.currentTarget.value,)}
                                            class="settings-field__input user-detail__field--reason"
                                        />
                                        <input
                                            class="settings-field__input"
                                            type="datetime-local"
                                            value={banExpiry()}
                                            onInput={(e,) => setBanExpiry(e.currentTarget.value,)}
                                            title="Expiry (leave empty for permanent)"
                                        />
                                        <button class="ui-button ui-button--danger ui-button--sm" onClick={handleBan}>
                                            Confirm Ban
                                        </button>
                                        <button
                                            class="ui-button ui-button--secondary ui-button--sm"
                                            onClick={() => setShowBanForm(false,)}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </Show>
                            </Show>
                        </div>
                    </div>
                </div>
            </Show>

            <ConfirmModal
                open={confirmDelete()}
                title="Permanently delete this user?"
                message="This cannot be undone. Their authored content stays, without an author."
                confirmLabel="Delete account"
                busyLabel="Deleting…"
                loading={deleting()}
                danger
                onConfirm={() => void handleDelete()}
                onCancel={() => setConfirmDelete(false,)}
            />
        </div>
    );
};

export default AdminUserDetail;
