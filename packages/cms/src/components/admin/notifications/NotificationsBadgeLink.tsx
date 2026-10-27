/**
 * NotificationsBadgeLink — a prominent "N notifications" pill linking to
 * /admin/notifications, shown beside a dashboard title. Renders nothing while
 * in-app notifications are off or the viewer has no unread ones.
 */
import { A, } from '@solidjs/router';
import { Show, type Component, } from 'solid-js';
import { notificationsEnabled, unreadNotifications, } from '../../../stores/notifications';
import './NotificationsBadgeLink.scss';

const NotificationsBadgeLink: Component = () => (
    <Show when={notificationsEnabled() && unreadNotifications() > 0}>
        <A href="/admin/notifications" class="notifications-badge-link" title="View your notifications">
            <span class="notifications-badge-link__count">{unreadNotifications() > 99 ? '99+' : unreadNotifications()}</span>
            {unreadNotifications() === 1 ? 'Notification' : 'Notifications'}
            <span aria-hidden="true">→</span>
        </A>
    </Show>
);

export default NotificationsBadgeLink;
