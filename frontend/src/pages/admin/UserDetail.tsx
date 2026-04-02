import { Title, } from '@solidjs/meta';
import { A, useNavigate, useParams, } from '@solidjs/router';
import { Component, createEffect, createResource, createSignal, Show, } from 'solid-js';
import { api, } from '../../services/api';
import './UserDetail.scss';

const AdminUserDetail: Component = () => {
    const params = useParams();
    const navigate = useNavigate();

    const [userData, { refetch, },] = createResource(() => params.id, async (id,) => {
        const response = await api.get(`/users/${id}`,);
        return response.success ? (response as any).data : null;
    },);

    // Editable fields
    const [displayName, setDisplayName,] = createSignal('',);
    const [role, setRole,] = createSignal('member',);
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
        setRole(u.role || 'member',);
        setIsActive(u.isActive ?? true,);
    },);

    const user = () => userData()?.user;
    const membership = () => userData()?.membership;

    const clearMessages = () => { setError('',); setSuccess('',); };

    const handleSave = async () => {
        setSaving(true,);
        clearMessages();
        const response = await api.put(`/users/${params.id}`, {
            displayName: displayName(),
            role: role(),
            isActive: isActive(),
        },);
        setSaving(false,);
        if (response.success) {
            setSuccess('Profile updated.',);
            refetch();
        } else {
            setError((response as any).error?.message || 'Failed to update',);
        }
    };

    const handleAvatarUpload = async (e: Event,) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        clearMessages();
        const response = await api.upload(`/users/${params.id}/avatar`, file, 'avatar',);
        input.value = '';

        if (response.success) {
            setSuccess('Avatar updated.',);
            refetch();
        } else {
            setError((response as any).error?.message || 'Failed to upload avatar',);
        }
    };

    const handlePasswordChange = async () => {
        if (newPassword().length < 8) {
            setError('Password must be at least 8 characters',);
            return;
        }
        setPasswordSaving(true,);
        clearMessages();
        const response = await api.post(`/users/${params.id}/password`, { password: newPassword(), },);
        setPasswordSaving(false,);
        if (response.success) {
            setSuccess('Password changed.',);
            setNewPassword('',);
            setShowPassword(false,);
        } else {
            setError((response as any).error?.message || 'Failed to change password',);
        }
    };

    const handleBan = async () => {
        clearMessages();
        const body: Record<string, unknown> = {};
        if (banReason()) body.reason = banReason();
        if (banExpiry()) body.expiresAt = new Date(banExpiry(),).toISOString();
        const response = await api.post(`/users/${params.id}/ban`, body,);
        if (response.success) {
            setSuccess('User banned.',);
            setShowBanForm(false,);
            setBanReason('',);
            setBanExpiry('',);
            refetch();
        } else {
            setError((response as any).error?.message || 'Failed to ban user',);
        }
    };

    const handleUnban = async () => {
        clearMessages();
        const response = await api.post(`/users/${params.id}/unban`, {},);
        if (response.success) {
            setSuccess('User unbanned.',);
            refetch();
        } else {
            setError((response as any).error?.message || 'Failed to unban user',);
        }
    };

    const handleDelete = async () => {
        if (!confirm('Permanently delete this user? This cannot be undone.',)) return;
        const response = await api.delete(`/users/${params.id}`,);
        if (response.success) navigate('/admin/users',);
        else setError((response as any).error?.message || 'Failed to delete user',);
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

    const roleBadge = (r: string,) => {
        switch (r) {
            case 'sysadmin': return 'badge--error';
            case 'admin': return 'badge--error';
            case 'member': return 'badge--success';
            default: return 'badge--muted';
        }
    };

    return (
        <div class="user-detail">
            <Title>{user()?.displayName || 'User'} - Admin - Surge Media</Title>

            <A href="/admin/users" class="user-detail__back">&larr; All Users</A>

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
                            style={{ display: 'none', }}
                            onChange={handleAvatarUpload}
                        />
                    </div>
                    <div class="user-detail__identity">
                        <h1>{user()?.displayName || '(no name)'}</h1>
                        <p class="user-detail__email">{user()?.email}</p>
                        <div class="user-detail__badges">
                            <span class={`badge ${statusInfo().cls}`}>{statusInfo().label}</span>
                            <span class={`badge ${roleBadge(user()?.role || '',)}`}>{user()?.role}</span>
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

                        <div class="settings-fields">
                            <div class="settings-field">
                                <label class="settings-field__label">Display Name</label>
                                <input
                                    class="settings-field__input"
                                    style={{ width: '240px', }}
                                    type="text"
                                    value={displayName()}
                                    onInput={(e,) => setDisplayName(e.currentTarget.value,)}
                                />
                            </div>
                            <div class="settings-field">
                                <label class="settings-field__label">Role</label>
                                <select
                                    class="settings-field__input"
                                    style={{ width: '140px', }}
                                    value={role()}
                                    onChange={(e,) => setRole(e.currentTarget.value,)}
                                >
                                    <option value="anonymous">Anonymous</option>
                                    <option value="member">Member</option>
                                    <option value="admin">Admin</option>
                                    <option value="sysadmin">System Admin</option>
                                </select>
                            </div>
                            <div class="settings-field">
                                <label class="settings-field__label">Active</label>
                                <label class="checkbox-label">
                                    <input
                                        type="checkbox"
                                        checked={isActive()}
                                        onChange={(e,) => setIsActive(e.currentTarget.checked,)}
                                    />
                                    <span>{isActive() ? 'Enabled' : 'Disabled'}</span>
                                </label>
                            </div>
                            <div class="settings-field">
                                <label class="settings-field__label" />
                                <button
                                    class="btn btn--primary btn--small"
                                    disabled={saving()}
                                    onClick={handleSave}
                                >
                                    {saving() ? 'Saving...' : 'Save Profile'}
                                </button>
                            </div>
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
                                        class="btn btn--secondary btn--small"
                                        onClick={() => setShowPassword(true,)}
                                    >
                                        Change Password
                                    </button>
                                }
                            >
                                <div class="user-detail__inline-form">
                                    <input
                                        class="settings-field__input"
                                        type="password"
                                        placeholder="New password (min 8 chars)"
                                        value={newPassword()}
                                        onInput={(e,) => setNewPassword(e.currentTarget.value,)}
                                        style={{ width: '220px', }}
                                    />
                                    <button
                                        class="btn btn--primary btn--small"
                                        disabled={passwordSaving() || newPassword().length < 8}
                                        onClick={handlePasswordChange}
                                    >
                                        {passwordSaving() ? 'Saving...' : 'Set Password'}
                                    </button>
                                    <button
                                        class="btn btn--secondary btn--small"
                                        onClick={() => { setShowPassword(false,); setNewPassword('',); }}
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </Show>
                        </div>

                        {/* Ban / Unban */}
                        <div class="user-detail__action-group">
                            <Show
                                when={!user()?.isBanned}
                                fallback={
                                    <button class="btn btn--secondary btn--small" onClick={handleUnban}>
                                        Unban User
                                    </button>
                                }
                            >
                                <Show
                                    when={showBanForm()}
                                    fallback={
                                        <button
                                            class="btn btn--danger btn--small"
                                            onClick={() => setShowBanForm(true,)}
                                        >
                                            Suspend User
                                        </button>
                                    }
                                >
                                    <div class="user-detail__inline-form">
                                        <input
                                            class="settings-field__input"
                                            type="text"
                                            placeholder="Reason (optional)"
                                            value={banReason()}
                                            onInput={(e,) => setBanReason(e.currentTarget.value,)}
                                            style={{ width: '180px', }}
                                        />
                                        <input
                                            class="settings-field__input"
                                            type="datetime-local"
                                            value={banExpiry()}
                                            onInput={(e,) => setBanExpiry(e.currentTarget.value,)}
                                            title="Expiry (leave empty for permanent)"
                                        />
                                        <button class="btn btn--danger btn--small" onClick={handleBan}>
                                            Confirm Ban
                                        </button>
                                        <button
                                            class="btn btn--secondary btn--small"
                                            onClick={() => setShowBanForm(false,)}
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </Show>
                            </Show>
                        </div>

                        {/* Delete */}
                        <div class="user-detail__action-group">
                            <button class="btn btn--ghost btn--small" onClick={handleDelete} style={{ color: '#dc3545', }}>
                                Delete Account
                            </button>
                        </div>
                    </div>
                </div>
            </Show>
        </div>
    );
};

export default AdminUserDetail;
