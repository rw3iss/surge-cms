/**
 * Permissions the core product declares, plus the per-feature sets.
 *
 * Registered at boot and after a feature is enabled, so a newly installed
 * feature's permissions appear in the admin without a restart.
 *
 * Defaults were chosen to preserve today's behaviour exactly: everything staff
 * can currently do stays available to staff. Introducing a permission system
 * that quietly takes access away from existing users would be a bug, not a
 * feature — an operator opts into tightening, one permission at a time.
 */
import type { PermissionRegistration, } from './index';

/** Roles that can already reach the admin's content screens. */
const STAFF = ['editor', 'admin', 'sysadmin',];
const ADMIN = ['admin', 'sysadmin',];

/** Always registered, regardless of which features are on. */
export const CORE_PERMISSIONS: PermissionRegistration[] = [
    {
        key: 'permissions:manage',
        feature: 'core',
        label: 'Manage permissions',
        description: 'Edit permission rules and grant them to roles or users.',
        action: 'write',
        // Admin-only, and a sysadmin bypasses every check anyway — so an admin
        // cannot use this to lock the site's owner out.
        defaultRoles: ADMIN,
    },
    {
        key: 'users:read',
        feature: 'core',
        label: 'View users',
        action: 'read',
        defaultRoles: ADMIN,
    },
    {
        key: 'users:write',
        feature: 'core',
        label: 'Create and edit users',
        action: 'write',
        defaultRoles: ADMIN,
    },
    {
        key: 'settings:read',
        feature: 'core',
        label: 'View settings',
        action: 'read',
        defaultRoles: ADMIN,
    },
    {
        key: 'settings:write',
        feature: 'core',
        label: 'Change settings',
        action: 'write',
        defaultRoles: ADMIN,
    },
    {
        key: 'media:read',
        feature: 'core',
        label: 'View media',
        action: 'read',
        defaultRoles: STAFF,
    },
    {
        key: 'media:write',
        feature: 'core',
        label: 'Upload and manage media',
        action: 'write',
        defaultRoles: STAFF,
    },
    {
        key: 'pages:read',
        feature: 'core',
        label: 'View pages',
        action: 'read',
        defaultRoles: STAFF,
    },
    {
        key: 'pages:write',
        feature: 'core',
        label: 'Create and edit pages',
        action: 'write',
        defaultRoles: STAFF,
    },
    {
        key: 'pages:publish',
        feature: 'core',
        label: 'Publish pages',
        description: 'Move a page from draft to published.',
        action: 'publish',
        defaultRoles: STAFF,
    },
];

/**
 * Per-feature permissions, registered when that feature is enabled.
 *
 * Keyed by feature so `installFeatureStep` can register exactly the new set —
 * and so a disabled feature's permissions don't clutter the admin screen.
 */
export const FEATURE_PERMISSIONS: Record<string, PermissionRegistration[]> = {
    posts: [
        { key: 'posts:read', feature: 'posts', label: 'View posts', action: 'read', defaultRoles: STAFF, },
        { key: 'posts:write', feature: 'posts', label: 'Create and edit posts', action: 'write', defaultRoles: STAFF, },
        {
            key: 'posts:publish',
            feature: 'posts',
            label: 'Publish posts',
            description: 'Move a post from draft to published.',
            action: 'publish',
            defaultRoles: STAFF,
        },
        { key: 'posts:delete', feature: 'posts', label: 'Delete posts', action: 'delete', defaultRoles: ADMIN, },
    ],
    forms: [
        { key: 'forms:read', feature: 'forms', label: 'View forms', action: 'read', defaultRoles: STAFF, },
        { key: 'forms:write', feature: 'forms', label: 'Create and edit forms', action: 'write', defaultRoles: STAFF, },
        {
            key: 'forms:submissions',
            feature: 'forms',
            label: 'View form submissions',
            description: 'Read the submission inbox and export it.',
            action: 'read',
            defaultRoles: STAFF,
        },
    ],
    campaigns: [
        { key: 'campaigns:read', feature: 'campaigns', label: 'View campaigns', action: 'read', defaultRoles: STAFF, },
        { key: 'campaigns:write', feature: 'campaigns', label: 'Create and edit campaigns', action: 'write', defaultRoles: STAFF, },
    ],
    shop: [
        { key: 'shop:read', feature: 'shop', label: 'View the shop', action: 'read', defaultRoles: STAFF, },
        { key: 'shop:write', feature: 'shop', label: 'Manage products and collections', action: 'write', defaultRoles: STAFF, },
        { key: 'shop.orders:read', feature: 'shop', label: 'View orders', action: 'read', defaultRoles: STAFF, },
        {
            key: 'shop.orders:refund',
            feature: 'shop',
            label: 'Refund orders',
            description: 'Issue a Stripe refund against an order.',
            action: 'refund',
            // Money leaves the account — admin-only until an operator widens it.
            defaultRoles: ADMIN,
        },
    ],
    events: [
        { key: 'events:read', feature: 'events', label: 'View events', action: 'read', defaultRoles: STAFF, },
        { key: 'events:write', feature: 'events', label: 'Create and edit events', action: 'write', defaultRoles: STAFF, },
        { key: 'events.registrations:read', feature: 'events', label: 'View event registrants', action: 'read', defaultRoles: STAFF, },
    ],
    mailing_lists: [
        { key: 'mailing_lists:read', feature: 'mailing_lists', label: 'View mailing lists', action: 'read', defaultRoles: STAFF, },
        { key: 'mailing_lists:write', feature: 'mailing_lists', label: 'Manage mailing lists', action: 'write', defaultRoles: STAFF, },
        {
            key: 'mailing_lists:send',
            feature: 'mailing_lists',
            label: 'Send a mailing',
            description: 'Start a send job to a list. This mails real subscribers.',
            action: 'send',
            defaultRoles: ADMIN,
        },
    ],
    social: [
        { key: 'social:read', feature: 'social', label: 'View social posts', action: 'read', defaultRoles: STAFF, },
        { key: 'social:write', feature: 'social', label: 'Compose and manage social posts', action: 'write', defaultRoles: STAFF, },
    ],
    wiki: [
        {
            key: 'wiki:read',
            feature: 'wiki',
            label: 'View the wiki',
            description: 'Read wiki pages. Individual pages can restrict themselves further.',
            action: 'read',
            // A wiki is public by default; a page locks itself down via its own
            // view roles rather than the whole wiki being closed.
            defaultAccess: 'everyone',
        },
        {
            key: 'wiki:write',
            feature: 'wiki',
            label: 'Create and edit wiki pages',
            description: 'Widen this to let non-admins contribute from the client-side editor.',
            action: 'write',
            defaultRoles: ADMIN,
        },
        {
            key: 'wiki:delete',
            feature: 'wiki',
            label: 'Delete wiki pages',
            action: 'delete',
            defaultRoles: ADMIN,
        },
    ],
    plugins: [
        { key: 'plugins:manage', feature: 'plugins', label: 'Install and configure plugins', action: 'write', defaultRoles: ADMIN, },
    ],
    contacts: [
        { key: 'contacts:read', feature: 'contacts', label: 'View contacts', action: 'read', defaultRoles: STAFF, },
        { key: 'contacts:write', feature: 'contacts', label: 'Create and edit contacts', action: 'write', defaultRoles: STAFF, },
    ],
};

/** Everything to register for the given set of enabled features. */
export function permissionsForFeatures(enabled: readonly string[],): PermissionRegistration[] {
    const out = [...CORE_PERMISSIONS,];
    for (const key of enabled) {
        const set = FEATURE_PERMISSIONS[key];
        if (set) out.push(...set,);
    }
    return out;
}
