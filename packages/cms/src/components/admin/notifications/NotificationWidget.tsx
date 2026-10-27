/**
 * NotificationWidget — the sidebar "Notifications" row (bell + unread badge),
 * above the online-users widget. Clicking expands a panel UPWARD over the
 * sidebar: the latest notifications (click = mark read + go to its target,
 * × = clear), Mark all read, View all (/admin/notifications), and the user's
 * desktop-notifications switch. Shown only while in-app notifications are on.
 */
import { A, useNavigate, } from '@solidjs/router';
import type { UserNotification, } from '@sitesurge/types';
import { createEffect, createSignal, For, on, onCleanup, Show, type Component, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import { notificationsVersion, refreshNotifications, unreadNotifications, } from '../../../stores/notifications';
import NotificationDesktopToggle from './NotificationDesktopToggle';
import { actOn, timeAgo, } from './NotificationWidgetActions';
import './NotificationWidget.scss';

const BELL = '<path d="M8 2.2a3.6 3.6 0 00-3.6 3.6v2.3L3.2 10.4v.8h9.6v-.8l-1.2-2.3V5.8A3.6 3.6 0 008 2.2z" stroke="currentColor" fill="none" stroke-width="1.2" stroke-linejoin="round"/><path d="M6.6 12.6a1.5 1.5 0 002.8 0" stroke="currentColor" fill="none" stroke-width="1.2" stroke-linecap="round"/>';

const NotificationWidget: Component<{ collapsed?: boolean; }> = (props,) => {
    const navigate = useNavigate();
    const [open, setOpen,] = createSignal(false,);
    const [items, setItems,] = createSignal<UserNotification[]>([],);
    const [loading, setLoading,] = createSignal(false,);

    const load = async () => {
        setLoading(true,);
        try {
            setItems((await cms.notifications.mine({ limit: 15, },)).items,);
        } catch {
            setItems([],);
        } finally {
            setLoading(false,);
        }
    };

    // Reload the open list whenever the count is refreshed (poll / focus / actions).
    createEffect(on(() => [open(), notificationsVersion(),] as const, ([o,],) => { if (o) void load(); },),);

    // Escape closes.
    const onKey = (e: KeyboardEvent,) => { if (e.key === 'Escape' && open()) setOpen(false,); };
    document.addEventListener('keydown', onKey,);
    onCleanup(() => document.removeEventListener('keydown', onKey,),);

    const go = async (n: UserNotification,) => {
        setOpen(false,);
        await actOn(n, navigate,);
    };
    const clearOne = async (n: UserNotification, e: Event,) => {
        e.stopPropagation();
        setItems(items().filter((x,) => x.id !== n.id,),);
        await cms.notifications.clear([n.id,],).catch(() => undefined,);
        void refreshNotifications();
    };
    const markAll = async () => {
        await cms.notifications.markRead('all',).catch(() => undefined,);
        void refreshNotifications();
    };

    const badge = () => (unreadNotifications() > 99 ? '99+' : String(unreadNotifications(),));

    return (
        <div class={`notification-widget ${open() ? 'notification-widget--open' : ''}`}>
            <Show when={open()}>
                <div class="notification-widget__panel" role="dialog" aria-label="Notifications">
                    <div class="notification-widget__head">
                        <strong>Notifications</strong>
                        <A href="/admin/notifications" class="notification-widget__link" onClick={() => setOpen(false,)}>View all</A>
                        <button type="button" class="notification-widget__link" disabled={!unreadNotifications()} onClick={() => void markAll()}>Mark all read</button>
                        <button type="button" class="notification-widget__close" aria-label="Close notifications" onClick={() => setOpen(false,)}>×</button>
                    </div>
                    <div class="notification-widget__list" role="list">
                        <Show when={!loading() || items().length} fallback={<div class="notification-widget__empty">Loading…</div>}>
                            <For each={items()} fallback={<div class="notification-widget__empty">You're all caught up.</div>}>
                                {(n,) => (
                                    <div
                                        class={`notification-widget__item ${n.readAt ? '' : 'is-unread'}`}
                                        role="listitem"
                                        tabindex="0"
                                        onClick={() => void go(n,)}
                                        onKeyDown={(e,) => { if (e.key === 'Enter') void go(n,); }}
                                    >
                                        <span class="notification-widget__dot" aria-hidden="true" />
                                        <div class="notification-widget__text">
                                            <span class="notification-widget__title">{n.title}</span>
                                            <Show when={n.body}><span class="notification-widget__body">{n.body}</span></Show>
                                            <span class="notification-widget__time">{timeAgo(n.createdAt,)}</span>
                                        </div>
                                        <button type="button" class="notification-widget__clear" aria-label="Clear" title="Clear" onClick={(e,) => void clearOne(n, e,)}>×</button>
                                    </div>
                                )}
                            </For>
                        </Show>
                    </div>
                    <div class="notification-widget__foot">
                        <NotificationDesktopToggle size="sm" />
                    </div>
                </div>
            </Show>
            <button
                type="button"
                class="notification-widget__header"
                aria-expanded={open()}
                title={props.collapsed ? `Notifications${unreadNotifications() ? ` (${unreadNotifications()} unread)` : ''}` : undefined}
                onClick={() => setOpen(!open(),)}
            >
                <svg class="notification-widget__bell" viewBox="0 0 16 16" width="18" height="18" innerHTML={BELL} aria-hidden="true" />
                <span class="notification-widget__label">Notifications</span>
                <Show when={unreadNotifications() > 0}>
                    <span class="notification-widget__badge" aria-label={`${unreadNotifications()} unread`}>{badge()}</span>
                </Show>
            </button>
        </div>
    );
};

export default NotificationWidget;
