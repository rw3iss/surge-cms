/*
 * Web Push handlers, imported into the generated service worker
 * (workbox `importScripts` in config/cms/vite.config.ts).
 *
 * The server sends JSON `{ title, body, url, tag }` (services/notifications
 * push channel). A click focuses an open tab on that URL (else any same-origin
 * tab, navigated there) or opens a new window.
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
        if (exact) return exact.focus();
        const sameOrigin = all.find((c) => new URL(c.url).origin === self.location.origin && 'navigate' in c);
        if (sameOrigin && new URL(target).origin === self.location.origin) {
            await sameOrigin.focus();
            return sameOrigin.navigate(target);
        }
        return self.clients.openWindow(target);
    })());
});
