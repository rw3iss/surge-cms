/*
 * Web Push handlers, imported into the generated service worker
 * (workbox `importScripts` in config/cms/vite.config.ts).
 *
 * The server sends JSON `{ title, body, url, tag }` (services/notifications
 * push channel). A click focuses an open tab already ON that URL, else opens
 * a new window — it never navigates another open tab away, which would drop
 * unsaved work in an editor there.
 */
/* eslint-disable no-restricted-globals */
self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = { title: event.data ? event.data.text() : 'Notification' };
    }
    const title = data.title || 'Notification';
    event.waitUntil(
        self.registration.showNotification(title, {
            body: data.body || '',
            tag: data.tag || undefined,
            // Same tag = same notification type: replace the old alert but still
            // alert again (without renotify a second alert of a type is silent).
            renotify: Boolean(data.tag),
            data: { url: data.url || '/admin/notifications' },
            icon: '/logo.png',
            badge: '/logo.png',
        }),
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = new URL((event.notification.data && event.notification.data.url) || '/admin/notifications', self.location.origin).href;
    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const exact = all.find((c) => c.url === target);
        if (exact && 'focus' in exact) return exact.focus();
        return self.clients.openWindow(target);
    })());
});
