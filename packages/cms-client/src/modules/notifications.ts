import type { NotificationOptions, SmsSettings, UserNotificationsResponse, } from '@sitesurge/types';
import { ModuleBase, } from './base';

/**
 * notifications namespace — the signed-in user's IN-APP notifications +
 * desktop (Web Push) subscriptions (`me*`), and the channel admin
 * (`options`, `sms`, `test` — `notifications:manage`). Per-type channel
 * config is saved with `cms.settings.update({ notifications })`.
 */
export class NotificationsModule extends ModuleBase {
    protected readonly module = 'notifications';

    /** GET /notifications/me — your notifications, unread count, whether in-app is on. */
    mine(query: { unread?: boolean; type?: string; page?: number; limit?: number; } = {},): Promise<UserNotificationsResponse> {
        return this.get('/notifications/me', {
            query: { ...query, unread: query.unread ? '1' : undefined, } as Record<string, unknown>, options: { cache: false, },
        },);
    }

    /** GET /notifications/me/count — unread count (+ enabled). */
    count(): Promise<{ unread: number; enabled: boolean; }> {
        return this.get('/notifications/me/count', { options: { cache: false, }, },);
    }

    /** POST /notifications/me/read — the ids, or all. */
    markRead(ids: string[] | 'all',): Promise<{ updated: number; }> {
        return this.mutate('POST', '/notifications/me/read', { body: ids === 'all' ? { all: true, } : { ids, }, invalidates: ['notifications',], },);
    }

    /** POST /notifications/me/clear — the ids, or all. */
    clear(ids: string[] | 'all',): Promise<{ cleared: number; }> {
        return this.mutate('POST', '/notifications/me/clear', { body: ids === 'all' ? { all: true, } : { ids, }, invalidates: ['notifications',], },);
    }

    /** GET /notifications/me/push — VAPID public key (null = unavailable) + your subscribed browsers. */
    pushInfo(): Promise<{ available: boolean; publicKey: string | null; subscriptions: number; }> {
        return this.get('/notifications/me/push', { options: { cache: false, }, },);
    }

    /** POST /notifications/me/push/subscribe — this browser's PushSubscription (`sub.toJSON()`). */
    pushSubscribe(sub: { endpoint: string; keys: { p256dh: string; auth: string; }; },): Promise<{ ok: true; }> {
        return this.mutate('POST', '/notifications/me/push/subscribe', { body: sub, },);
    }

    /** POST /notifications/me/push/unsubscribe */
    pushUnsubscribe(endpoint: string,): Promise<{ ok: true; }> {
        return this.mutate('POST', '/notifications/me/push/unsubscribe', { body: { endpoint, }, },);
    }

    /** GET /notifications/options */
    options(): Promise<NotificationOptions> {
        return this.get('/notifications/options', { options: { cache: false, }, },);
    }

    /** PUT /notifications/options */
    setOptions(body: Partial<NotificationOptions>,): Promise<NotificationOptions> {
        return this.mutate('PUT', '/notifications/options', { body, invalidates: ['notifications',], },);
    }

    /** GET /notifications/sms — provider settings (token masked). */
    sms(): Promise<SmsSettings> {
        return this.get('/notifications/sms', { options: { cache: false, }, },);
    }

    /** PUT /notifications/sms */
    setSms(body: Partial<SmsSettings>,): Promise<SmsSettings> {
        return this.mutate('PUT', '/notifications/sms', { body, },);
    }

    /** POST /notifications/sms/test */
    testSms(to: string,): Promise<{ ok: true; }> {
        return this.mutate('POST', '/notifications/sms/test', { body: { to, }, },);
    }

    /** POST /notifications/test — send a test of a type to its configured recipients. */
    test(type: string,): Promise<{ ok: true; }> {
        return this.mutate('POST', '/notifications/test', { body: { type, }, },);
    }
}
