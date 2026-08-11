/**
 * Notifications — admin-configurable, per-type dispatch to one or more
 * channels (email now; SMS/push are reserved for later).
 *
 * An operator configures, PER notification type, which channels are
 * enabled and the recipient addresses for each. When a matching event
 * fires, the backend `notify(typeKey, msg)` service dispatches to those
 * recipients. Types only surface in the admin UI when their governing
 * feature (`feature`) is enabled.
 *
 * Persisted as a single `site_settings` row keyed `notifications`, whose
 * value is a `NotificationSettings` object.
 */

/** The delivery channels a notification type can dispatch through. Only
 *  `email` is implemented today; `sms`/`push` are stubs. */
export type NotificationChannelId = 'email' | 'sms' | 'push';

/** Per-channel config for one notification type: on/off + recipients. */
export interface NotificationChannelConfig {
    enabled: boolean;
    /** Recipient addresses for this channel (emails for `email`). */
    addresses: string[];
}

/** A notification type's config across all channels. */
export interface NotificationTypeConfig {
    email?: NotificationChannelConfig;
    sms?: NotificationChannelConfig;
    push?: NotificationChannelConfig;
}

/** The whole stored blob: type key → its per-channel config. */
export type NotificationSettings = Record<string, NotificationTypeConfig>;

/** Static metadata describing a notification type (label, description,
 *  and the feature that must be enabled for it to appear in the UI). */
export interface NotificationTypeMeta {
    key: string;
    label: string;
    description: string;
    /** A `*_enabled` site-settings feature key WITHOUT the `_enabled`
     *  suffix (e.g. `shop`, `forms`, `messages`, `users`). Omit for
     *  always-available types. */
    feature?: string;
}

/** The registered notification types. Shared by the admin UI (to render
 *  the Notifications settings tab) and documented for backend emitters. */
export const NOTIFICATION_TYPES: NotificationTypeMeta[] = [
    {
        key: 'user_signup',
        label: 'New user signup',
        description: 'When a new member registers an account.',
        feature: 'users',
    },
    {
        key: 'subscription_change',
        label: 'Subscription change',
        description: 'When a member starts, changes, or cancels a subscription.',
        feature: 'users',
    },
    {
        key: 'shop_order',
        label: 'New shop order',
        description: 'When a customer places and pays for an order.',
        feature: 'shop',
    },
    {
        key: 'form_submission',
        label: 'Form submission',
        description: 'When a visitor submits a form.',
        feature: 'forms',
    },
    {
        key: 'contact_message',
        label: 'Contact message',
        description: 'When a visitor sends a contact message.',
        feature: 'messages',
    },
];
