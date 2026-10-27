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
/** Every signed-in role: built-ins + anything whose base role is `member`. */
const MEMBERS = ['member', 'editor', 'admin', 'sysadmin',];

/** Always registered, regardless of which features are on. */
export const CORE_PERMISSIONS: PermissionRegistration[] = [
    {
        key: 'roles:manage',
        feature: 'core',
        label: 'Manage roles',
        description: 'Create, edit and delete custom roles (Settings → Permissions → Roles).',
        action: 'admin',
        defaultRoles: ADMIN,
    },
    {
        key: 'memberships.applications:review',
        feature: 'core',
        label: 'Review membership applications',
        description: 'Read applications for membership levels that require approval, and approve (start billing) or reject them.',
        action: 'admin',
        defaultRoles: ADMIN,
    },
    {
        key: 'users:invite',
        feature: 'core',
        label: 'Invite users',
        description: 'Invite someone to create an account with given roles (e.g. Ambassador), or give an existing account those roles.',
        action: 'admin',
        defaultRoles: ADMIN,
    },
    {
        key: 'subscriptions:manage',
        feature: 'core',
        label: 'Manage subscriptions',
        description: "Define subscription tiers (role, extra permissions, Stripe price) and put a user on a tier by hand.",
        action: 'admin',
        defaultRoles: ADMIN,
    },
    {
        key: 'data:export',
        feature: 'core',
        label: 'Export data',
        description: 'Download admin tables (donations, subscribers, users, entity records) as CSV, or open them as a printable page.',
        action: 'read',
        defaultRoles: ADMIN,
    },
    {
        key: 'components:script',
        feature: 'core',
        label: 'Edit component JavaScript',
        description:
            'Write the client-side script a Component runs in every visitor\'s browser. '
            + 'Separate from editing a component\'s blocks because this is arbitrary code execution.',
        action: 'write',
        defaultRoles: ADMIN,
    },
    {
        key: 'components.collections:manage',
        feature: 'core',
        label: 'Manage component collections',
        description: 'Create, rename and delete the folders components are filed in (/admin/components).',
        action: 'write',
        defaultRoles: ADMIN,
    },
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
        key: 'users:delete',
        feature: 'core',
        label: 'Delete users',
        description: 'Permanently delete a user account (single or bulk).',
        action: 'admin',
        defaultRoles: ADMIN,
    },
    {
        key: 'users.password:set',
        feature: 'core',
        label: "Set a user's password",
        description: 'Override a user\'s password from the admin.',
        action: 'admin',
        defaultRoles: ADMIN,
    },
    {
        key: 'users:ban',
        feature: 'core',
        label: 'Ban users',
        description: 'Ban and unban users and IP addresses, and remove bans.',
        action: 'admin',
        defaultRoles: ADMIN,
    },
    {
        key: 'users:bulk',
        feature: 'core',
        label: 'Bulk user actions',
        description: 'Run an action on many users at once (the action\'s own permission is checked too).',
        action: 'admin',
        defaultRoles: ADMIN,
    },
    {
        key: 'users:verify',
        feature: 'core',
        label: 'Manage email verification',
        description: 'Resend a user\'s verification email or mark their email address verified.',
        action: 'write',
        defaultRoles: ADMIN,
    },
    {
        key: 'users:message',
        feature: 'core',
        label: 'Email users from the admin',
        description: 'Send a message to a user (Users table / user detail). Every message is recorded.',
        action: 'write',
        defaultRoles: ADMIN,
    },
    {
        key: 'shop.providers:read',
        feature: 'shop',
        label: 'View shop providers',
        description: 'See the configured fulfilment providers and their webhook URLs.',
        action: 'read',
        defaultRoles: ADMIN,
    },
    {
        key: 'shop.providers:write',
        feature: 'shop',
        label: 'Configure shop providers',
        description:
            'Enter supplier API credentials, enable providers, trigger a catalogue sync '
            + 'and regenerate webhook tokens.',
        action: 'write',
        defaultRoles: ADMIN,
    },
    {
        key: 'settings.backup:download',
        feature: 'core',
        label: 'Download a database backup',
        description:
            'Download a full dump of the site database. The dump contains every '
            + 'password hash, API-key hash and customer record, so this is effectively '
            + 'read access to every secret the CMS holds.',
        action: 'read',
        defaultRoles: ADMIN,
    },
    {
        key: 'settings.backup:restore',
        feature: 'core',
        label: 'Restore a database backup',
        description:
            'Replace the entire live database with an uploaded dump. Overwrites all '
            + 'content AND all user accounts, including the account performing it.',
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
        key: 'geo:lookup',
        feature: 'core',
        label: 'Search addresses on the map',
        description: 'Map pickers (the event Location field): address search and the address at a dropped pin, via OpenStreetMap.',
        action: 'read',
        defaultRoles: STAFF,
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
    // Notifications: your own in-app notifications + desktop subscriptions;
    // managing the channels (options, SMS provider, tests) is admin.
    {
        key: 'notifications:self',
        feature: 'core',
        label: 'Use in-app notifications',
        description: 'See, read and clear their own in-app notifications and turn desktop notifications on for their browsers.',
        action: 'read',
        defaultRoles: ['member', 'editor', 'admin', 'sysadmin',],
    },
    {
        key: 'notifications:manage',
        feature: 'core',
        label: 'Manage notification channels',
        description: 'In-app on/off and retention, the SMS provider, and sending test notifications.',
        action: 'manage',
        defaultRoles: ADMIN,
    },
    // Partner programs (affiliates, contributors): the member's own Partner
    // Program page + Stripe Connect account. Membership in a program is checked too.
    {
        key: 'partners:self',
        feature: 'core',
        label: 'Use the Partner Program page',
        description: 'Connect a Stripe account and see their partner earnings and payouts (affiliates, contributors).',
        action: 'read',
        defaultRoles: ['member', 'editor', 'admin', 'sysadmin',],
    },
    // Own media (contributors): upload, and see only what they uploaded.
    {
        key: 'media:read_own',
        feature: 'core',
        label: 'View own uploads',
        description: 'See only the media they uploaded (the picker in their post editor).',
        action: 'read',
        defaultRoles: ['contributor',],
    },
    {
        key: 'media:write_own',
        feature: 'core',
        label: 'Upload media',
        description: 'Upload images and files for their own content.',
        action: 'write',
        defaultRoles: ['contributor',],
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
        {
            key: 'contributions:manage', feature: 'posts', label: 'Manage contributor payouts',
            description: 'Contributor settings, see contributions and their payouts, change or revoke a payout, pay contributors.',
            action: 'manage', defaultRoles: ADMIN,
        },
        // ── Own posts (contributors): the `_own` variants cover only posts the
        // user authored; `posts:read`/`posts:write`/`posts:delete` cover all.
        // `scopeFor(subject, 'posts', action)` decides any / own.
        {
            key: 'posts:read_own', feature: 'posts', label: 'View own posts',
            description: 'See the posts they wrote in the admin (all statuses).', action: 'read', defaultRoles: ['contributor',],
        },
        {
            key: 'posts:write_own', feature: 'posts', label: 'Create and edit own posts',
            description: 'Write new posts and edit the ones they wrote (not once published, unless they may publish).', action: 'write', defaultRoles: ['contributor',],
        },
        {
            key: 'posts:delete_own', feature: 'posts', label: 'Delete own drafts',
            description: 'Delete their own posts that are not published.', action: 'delete', defaultRoles: ['contributor',],
        },
        {
            key: 'posts.settings:write',
            feature: 'posts',
            label: 'Change posts settings',
            description: 'Posts → Settings, including the live-stream provider credentials.',
            action: 'write',
            defaultRoles: ADMIN,
        },
        {
            key: 'posts.live:host',
            feature: 'posts',
            label: 'Host live shows',
            description: 'Start, pause, resume and end a live show, mute it, and change its chat and reaction settings.',
            action: 'write',
            defaultRoles: STAFF,
        },
        {
            key: 'posts.live:chat_moderate',
            feature: 'posts',
            label: 'Moderate live chat',
            description: 'Delete messages from a live show\'s chat.',
            action: 'write',
            defaultRoles: STAFF,
        },
        {
            key: 'posts.live:moderate_viewers',
            feature: 'posts',
            label: 'Moderate live viewers',
            description: 'See who is watching a live show, and mute, silence, kick or ban viewers (a ban covers every live show).',
            action: 'write',
            defaultRoles: STAFF,
        },
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
        {
            key: 'forms.submissions:reply',
            feature: 'forms',
            label: 'Email submitters',
            description: "Send a form submitter an email reply from the submissions inbox.",
            action: 'write',
            defaultRoles: STAFF,
        },
    ],
    campaigns: [
        { key: 'campaigns:read', feature: 'campaigns', label: 'View campaigns', action: 'read', defaultRoles: STAFF, },
        { key: 'campaigns:write', feature: 'campaigns', label: 'Create and edit campaigns', action: 'write', defaultRoles: STAFF, },
        {
            key: 'campaigns.donations:reply',
            feature: 'campaigns',
            label: 'Email donors',
            description: 'Send a donor an email reply from the campaign donations table.',
            action: 'write',
            defaultRoles: STAFF,
        },
        {
            key: 'campaigns.donations:manage_own',
            feature: 'campaigns',
            label: 'Manage own recurring donations',
            description: 'Change the amount or frequency of, or cancel, recurring donations the user made. Always limited to their own.',
            action: 'write',
            // Every signed-in role — donors are members.
            defaultRoles: ['member', 'editor', 'admin', 'sysadmin',],
        },
    ],
    shop: [
        { key: 'shop:read', feature: 'shop', label: 'View the shop', action: 'read', defaultRoles: STAFF, },
        { key: 'shop:write', feature: 'shop', label: 'Manage products and collections', action: 'write', defaultRoles: STAFF, },
        { key: 'shop.orders:read', feature: 'shop', label: 'View orders', action: 'read', defaultRoles: STAFF, },
        {
            key: 'shop.orders:write',
            feature: 'shop',
            label: 'Edit orders',
            description: 'Change an order\'s status, notes and tracking (carrier, number, link).',
            action: 'write',
            // The order update route is admin-tier today; keep it that way by default.
            defaultRoles: ADMIN,
        },
        {
            key: 'shop.orders:refund',
            feature: 'shop',
            label: 'Refund orders',
            description: 'Issue a Stripe refund against an order.',
            action: 'refund',
            // Money leaves the account — admin-only until an operator widens it.
            defaultRoles: ADMIN,
        },
        // ── Discount codes (Shop → Discount codes) ──
        {
            key: 'shop.discounts:manage', feature: 'shop', label: 'Manage discount codes',
            description: 'Create, edit, disable and delete site-wide and affiliate discount codes.',
            action: 'admin', defaultRoles: ADMIN,
        },
        {
            key: 'shop.discounts:use', feature: 'shop', label: 'Use discount codes at checkout',
            description: 'Each code can narrow this further to membership levels or roles.',
            action: 'write', defaultAccess: 'everyone',
        },
    ],
    affiliates: [
        {
            key: 'affiliates:manage', feature: 'affiliates', label: 'Manage the affiliate program',
            description: 'See affiliates, their sales and earnings; assign codes; pay out commissions.',
            action: 'admin', defaultRoles: ADMIN,
        },
        {
            key: 'affiliates:self', feature: 'affiliates', label: 'Use the affiliate page',
            description: 'Profile → Affiliate program, for members holding the affiliate role (Shop → Settings).',
            action: 'read', defaultRoles: MEMBERS,
        },
    ],
    events: [
        { key: 'events:read', feature: 'events', label: 'View events', action: 'read', defaultRoles: STAFF, },
        { key: 'events:write', feature: 'events', label: 'Create and edit events', action: 'write', defaultRoles: STAFF, },
        { key: 'events.registrations:read', feature: 'events', label: 'View event registrants', action: 'read', defaultRoles: STAFF, },
        {
            key: 'events.registrations:cancel_own',
            feature: 'events',
            label: 'Cancel own free event registration',
            description: 'Un-register from a free event on its page. Paid tickets always need the organiser.',
            action: 'delete',
            defaultRoles: MEMBERS,
        },
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
    // ─── Discussions (Comments + Forum) ───
    // Member-level defaults use MEMBERS: a custom role (e.g. `subscriber`)
    // inherits them through its base role.
    discussions: [
        { key: 'discussions:react', feature: 'discussions', label: 'React to comments and forum posts', action: 'write', defaultRoles: MEMBERS, },
        { key: 'discussions:report', feature: 'discussions', label: 'Report comments and forum posts', action: 'write', defaultRoles: MEMBERS, },
        // Engine-level (not per feature) so they work with only the Forum on.
        { key: 'discussions:edit_own', feature: 'discussions', label: 'Edit own comments and forum posts', action: 'write', defaultRoles: MEMBERS, },
        { key: 'discussions:delete_own', feature: 'discussions', label: 'Delete own comments and forum posts', action: 'delete', defaultRoles: MEMBERS, },
        {
            key: 'discussions:moderate', feature: 'discussions', label: 'Moderate comments and forum posts',
            description: 'Approve, hide, edit or delete anyone\'s comments and forum posts; resolve reports.',
            action: 'write', defaultRoles: STAFF,
        },
    ],
    comments: [
        { key: 'comments:write', feature: 'comments', label: 'Post comments', description: 'Where an item has commenting enabled.', action: 'write', defaultRoles: MEMBERS, },
        {
            key: 'comments:anonymous', feature: 'comments', label: 'Comment without an account',
            description: 'Only where the item allows anonymous comments.',
            action: 'write', defaultAccess: 'everyone',
        },
        { key: 'comments:manage', feature: 'comments', label: 'Manage comment settings', description: 'Per-item commenting switches and the Comments settings page.', action: 'admin', defaultRoles: STAFF, },
    ],
    gallery: [
        {
            key: 'gallery:view', feature: 'gallery', label: 'View the gallery',
            description: 'Narrowed further by the gallery settings and each item\'s own visibility.',
            action: 'read', defaultAccess: 'everyone',
        },
        {
            key: 'gallery:manage', feature: 'gallery', label: 'Manage gallery items',
            description: 'Publish media to the gallery, edit, reorder and remove items.',
            action: 'write', defaultRoles: STAFF,
        },
        { key: 'gallery.settings:manage', feature: 'gallery', label: 'Change gallery settings', description: 'Route, access, comments and appearance.', action: 'admin', defaultRoles: ADMIN, },
        {
            key: 'gallery:comment', feature: 'gallery', label: 'Comment on gallery items',
            description: 'Where commenting is on (needs the Comments feature).',
            action: 'write', defaultRoles: MEMBERS,
        },
    ],
    forum: [
        {
            key: 'forum:read', feature: 'forum', label: 'Read the forum',
            description: 'Narrowed further by the forum settings and per-category tiers.',
            action: 'read', defaultAccess: 'everyone',
        },
        { key: 'forum:thread_create', feature: 'forum', label: 'Start forum threads', action: 'write', defaultRoles: MEMBERS, },
        { key: 'forum:reply', feature: 'forum', label: 'Reply in the forum', action: 'write', defaultRoles: MEMBERS, },
        {
            key: 'forum:post_anonymous', feature: 'forum', label: 'Post in the forum without an account',
            description: 'Start threads and reply as a guest — only while Forum → Settings → Allow anonymous posting is on.',
            action: 'write', defaultAccess: 'everyone',
        },
        { key: 'forum:moderate', feature: 'forum', label: 'Moderate the forum', description: 'Pin, lock, move, hide and delete threads.', action: 'write', defaultRoles: STAFF, },
        { key: 'forum:manage', feature: 'forum', label: 'Manage the forum', description: 'Categories and forum settings.', action: 'admin', defaultRoles: ADMIN, },
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
    video: [
        {
            key: 'media.video:upload',
            feature: 'video',
            label: 'Upload videos',
            description: 'Start large (multipart) video uploads to object storage.',
            action: 'write',
            defaultRoles: STAFF,
        },
        {
            key: 'media.video:manage',
            feature: 'video',
            label: 'Manage video encoding',
            description: 'Re-encode, cancel or retry encode jobs; change teaser and access level.',
            action: 'write',
            defaultRoles: STAFF,
        },
        {
            key: 'media.video:settings',
            feature: 'video',
            label: 'Video settings and keys',
            description: 'Change encoding settings and rotate the private-video encryption key.',
            action: 'admin',
            defaultRoles: ADMIN,
        },
        {
            key: 'media.private:view',
            feature: 'video',
            label: 'Watch private videos',
            description:
                'Play and download the FULL version of private videos (everyone else gets the teaser). '
                + 'Grant it to a subscription tier to make that tier\'s members subscribers.',
            action: 'read',
            defaultRoles: STAFF,
        },
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
