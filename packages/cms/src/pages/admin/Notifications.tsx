/**
 * /admin/notifications — every in-app notification of the signed-in user:
 * All / Unread + a type filter, mark read, clear, pagination, and the user's
 * desktop-notifications switch. Same data as the sidebar widget
 * (`cms.notifications.mine`); actions refresh the shared unread count.
 */
import type { UserNotification, UserNotificationsResponse, } from '@sitesurge/types';
import { NOTIFICATION_TYPES, } from '@sitesurge/types';
import { useNavigate, } from '@solidjs/router';
import { createEffect, createResource, createSignal, For, on, Show, type Component, } from 'solid-js';
import AdminTitle from '../../components/admin/common/AdminTitle';
import ConfirmModal from '../../components/admin/common/ConfirmModal';
import Pagination from '../../components/admin/common/Pagination';
import { FormField, } from '../../components/admin/forms';
import NotificationDesktopToggle from '../../components/admin/notifications/NotificationDesktopToggle';
import { actOn, timeAgo, typeLabel, } from '../../components/admin/notifications/NotificationWidgetActions';
import { Tabs, } from '../../components/ui/Tabs';
import { cms, } from '../../services/cmsClient';
import { notificationsVersion, refreshNotifications, } from '../../stores/notifications';
import './styles/_notifications-page.scss';

type View = 'all' | 'unread';
const LIMIT = 25;

const AdminNotifications: Component = () => {
    const navigate = useNavigate();
    const [view, setView,] = createSignal<View>('all',);
    const [type, setType,] = createSignal('',);
    const [page, setPage,] = createSignal(1,);
    const [confirmClear, setConfirmClear,] = createSignal(false,);
    const [busy, setBusy,] = createSignal(false,);

    // Filters reset to page 1.
    createEffect(on([view, type,], () => setPage(1,), { defer: true, },),);

    const [data, { refetch, },] = createResource(
        () => ({ unread: view() === 'unread', type: type(), page: page(), v: notificationsVersion(), }),
        (q,): Promise<UserNotificationsResponse> =>
            cms.notifications.mine({ unread: q.unread, type: q.type || undefined, page: q.page, limit: LIMIT, },),
    );

    const totalPages = () => Math.max(1, Math.ceil((data()?.total ?? 0) / LIMIT,),);
    const unread = () => data()?.unread ?? 0;

    const after = async () => {
        await refreshNotifications(); // bumps the version → refetch
        void refetch();
    };
    const markRead = async (n: UserNotification, e: Event,) => {
        e.stopPropagation();
        await cms.notifications.markRead([n.id,],).catch(() => undefined,);
        await after();
    };
    const clearOne = async (n: UserNotification, e: Event,) => {
        e.stopPropagation();
        await cms.notifications.clear([n.id,],).catch(() => undefined,);
        await after();
    };
    const markAll = async () => {
        setBusy(true,);
        await cms.notifications.markRead('all',).catch(() => undefined,);
        await after();
        setBusy(false,);
    };
    const clearAll = async () => {
        setBusy(true,);
        await cms.notifications.clear('all',).catch(() => undefined,);
        setConfirmClear(false,);
        await after();
        setBusy(false,);
    };

    return (
        <div class="admin-notifications">
            <AdminTitle>Notifications</AdminTitle>
            <div class="admin-header">
                <h1>Notifications</h1>
                <div class="admin-header__actions">
                    <button type="button" class="ui-button ui-button--secondary" disabled={busy() || !unread()} onClick={() => void markAll()}>
                        Mark all read
                    </button>
                    <button type="button" class="ui-button ui-button--danger" disabled={busy() || !data()?.total} onClick={() => setConfirmClear(true,)}>
                        Clear all
                    </button>
                </div>
            </div>

            <Show when={data() && !data()!.enabled}>
                <div class="alert alert--warning">
                    In-app notifications are turned off for this site. An administrator can turn them on in Settings → Notifications.
                </div>
            </Show>

            <section class="admin-section">
                <header class="admin-section__header">
                    <h2>Desktop notifications</h2>
                    <p class="form-help-muted">Show your notifications as desktop alerts in this browser, even when the admin is closed.</p>
                </header>
                <NotificationDesktopToggle />
            </section>

            <section class="admin-section">
                <div class="admin-notifications__filters">
                    <Tabs<View>
                        items={[{ value: 'all', label: 'All', }, { value: 'unread', label: `Unread${unread() ? ` (${unread()})` : ''}`, },]}
                        value={view()}
                        onChange={setView}
                    />
                    <FormField label="Type">
                        <select value={type()} onChange={(e,) => setType(e.currentTarget.value,)}>
                            <option value="">All types</option>
                            <For each={NOTIFICATION_TYPES}>{(t,) => <option value={t.key}>{t.label}</option>}</For>
                        </select>
                    </FormField>
                </div>

                <Show when={!data.loading || data()} fallback={<p class="form-help-muted">Loading…</p>}>
                    <ul class="admin-notifications__list">
                        <For
                            each={data()?.items ?? []}
                            fallback={<li class="admin-notifications__empty">{view() === 'unread' ? 'No unread notifications.' : 'No notifications.'}</li>}
                        >
                            {(n,) => (
                                <li
                                    class={`admin-notifications__item ${n.readAt ? '' : 'is-unread'}`}
                                    tabindex="0"
                                    onClick={() => void actOn(n, navigate,)}
                                    onKeyDown={(e,) => { if (e.key === 'Enter') void actOn(n, navigate,); }}
                                >
                                    <span class="admin-notifications__dot" aria-hidden="true" />
                                    <div class="admin-notifications__text">
                                        <div class="admin-notifications__title">{n.title}</div>
                                        <Show when={n.body}><div class="admin-notifications__body">{n.body}</div></Show>
                                        <div class="admin-notifications__meta">
                                            <span class="admin-notifications__type">{typeLabel(n.type,)}</span>
                                            <span title={new Date(n.createdAt,).toLocaleString()}>{timeAgo(n.createdAt,)}</span>
                                        </div>
                                    </div>
                                    <div class="admin-notifications__actions">
                                        <Show when={!n.readAt}>
                                            <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={(e,) => void markRead(n, e,)}>Mark read</button>
                                        </Show>
                                        <button type="button" class="ui-button ui-button--secondary ui-button--sm" onClick={(e,) => void clearOne(n, e,)}>Clear</button>
                                    </div>
                                </li>
                            )}
                        </For>
                    </ul>
                    <Pagination page={page()} totalPages={totalPages()} total={data()?.total} limit={LIMIT} onPageChange={setPage} />
                </Show>
            </section>

            <ConfirmModal
                open={confirmClear()}
                title="Clear all notifications?"
                message="Every notification is removed from your list. This cannot be undone."
                confirmLabel="Clear all"
                danger
                loading={busy()}
                onConfirm={() => void clearAll()}
                onCancel={() => setConfirmClear(false,)}
            />
        </div>
    );
};

export default AdminNotifications;
