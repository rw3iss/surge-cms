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

/** The delivery channels a notification type can dispatch through. */
export type NotificationChannelId = 'email' | 'sms' | 'push' | 'inApp';

/** Per-channel config for one notification type: on/off + recipients. */
export interface NotificationChannelConfig {
    enabled: boolean;
    /** Recipients: email addresses (`email`) or phone numbers in E.164, e.g. +12155550123 (`sms`). */
    addresses: string[];
}

/** In-app recipients: chosen users + every user holding one of the roles (main or additional). */
export interface NotificationInAppConfig {
    enabled: boolean;
    userIds: string[];
    roles: string[];
}

/** A notification type's config across all channels. */
export interface NotificationTypeConfig {
    email?: NotificationChannelConfig;
    sms?: NotificationChannelConfig;
    inApp?: NotificationInAppConfig;
    /** Desktop (Web Push) — sent to the IN-APP recipients on every browser where they turned desktop notifications on. */
    push?: { enabled: boolean; };
}

/** The whole stored blob: type key → its per-channel config. */
export type NotificationSettings = Record<string, NotificationTypeConfig>;

/** Global notification options (`notification_options` row; Settings → Notifications). */
export interface NotificationOptions {
    /** In-app notifications in the admin (the sidebar Notifications widget + /admin/notifications). */
    inAppEnabled: boolean;
    /** Days to keep a user's in-app notifications (read or not); cleared ones go sooner. */
    retentionDays: number;
}

/** One in-app notification of the signed-in user. */
export interface UserNotification {
    id: string;
    /** The notification type key (`post_submitted`, …). */
    type: string;
    title: string;
    body: string | null;
    /** Where acting on it goes (a site path or absolute URL). */
    url: string | null;
    readAt: string | null;
    createdAt: string;
}

export interface UserNotificationsResponse {
    enabled: boolean;
    unread: number;
    items: UserNotification[];
    total: number;
}

/** SMS provider (`sms_settings`; Settings → Notifications → SMS). Twilio first; AWS SNS later. */
export interface SmsSettings {
    provider: 'none' | 'twilio';
    accountSid: string;
    /** Masked (`••••••••`) when read; send the mask back = unchanged. */
    authToken: string;
    /** The sending number (E.164) or a Messaging Service SID (MG…). */
    fromNumber: string;
    /** Provider set and credentials present. */
    configured?: boolean;
}

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
        key: 'membership_application',
        label: 'Membership application',
        description: 'When a member applies for a membership level that requires approval (built-in application form; a level with its own form uses that form\'s email settings).',
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
        key: 'contribution_published',
        label: 'Contribution published',
        description: "When a contributor's post is approved and published (with the payout credited).",
        feature: 'posts',
    },
    {
        key: 'post_submitted',
        label: 'Content submissions',
        description: 'When someone submits a post for review (contributors, or anyone whose publishing needs approval) — with a link to review it.',
        feature: 'posts',
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
    {
        key: 'comment_posted',
        label: 'New comment',
        description: 'When someone comments on a post or event (including comments waiting for approval).',
        feature: 'comments',
    },
    {
        key: 'comment_reported',
        label: 'Comment reported',
        description: 'When a reader reports a comment to the moderators.',
        feature: 'comments',
    },
    {
        key: 'forum_thread_created',
        label: 'New forum thread',
        description: 'When a member starts a forum thread (including threads waiting for approval).',
        feature: 'forum',
    },
    {
        key: 'forum_reported',
        label: 'Forum post reported',
        description: 'When a member reports a forum post to the moderators.',
        feature: 'forum',
    },
];
