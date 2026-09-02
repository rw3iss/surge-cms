/**
 * Granular permissions.
 *
 * The role system (`anonymous | member | editor | admin | sysadmin`) is a
 * ladder: a role can do everything the role below it can. That answers "how
 * much of the admin is this person trusted with" but not "may this person
 * publish posts while only drafting products", and a feature cannot extend it
 * at all. Permissions sit ON TOP of roles rather than replacing them — routes
 * keep their auth tier, and a permission narrows within it.
 *
 * The model is deliberately default-first. Every permission carries its own
 * rule (`everyone` / `roles` / `nobody`), so the common case — "all staff may
 * do this" — costs ZERO rows. The grants table records only exceptions: a
 * specific user allowed or denied something the default wouldn't decide. That
 * keeps the table proportional to how unusual a site's policy is, instead of to
 * how many users it has.
 */

/** `<feature>:<action>` — e.g. `posts:write`, `shop.orders:refund`. */
export type PermissionKey = string;

/** How a permission behaves when no explicit grant matches. */
export type PermissionDefaultAccess = 'everyone' | 'roles' | 'nobody';

/** What a grant attaches to. */
export type PermissionSubjectType = 'role' | 'user';

export interface PermissionDefinition {
    key: PermissionKey;
    /** Grouping for the admin UI — the feature key, or `core`. */
    feature: string;
    /** Short human label, e.g. "Create and edit posts". */
    label: string;
    description?: string | null;
    /**
     * Coarse action this represents. Free-form so a feature can invent its own
     * (`refund`, `publish`, `sync`), with read/write as the common pair.
     */
    action?: string | null;
    defaultAccess: PermissionDefaultAccess;
    /** Roles allowed when `defaultAccess` is `roles`. */
    defaultRoles: string[];
    /**
     * Registered by code (a feature declared it) rather than created by hand.
     * System permissions can't be deleted in the admin: the code would just
     * re-register them on the next boot, so removal is a lie.
     */
    isSystem: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface PermissionGrant {
    id: string;
    permissionKey: PermissionKey;
    subjectType: PermissionSubjectType;
    /** Role name, or user id. */
    subjectId: string;
    /**
     * `false` is an explicit DENY, which is why this is not just "row exists =
     * allowed". Revoking one person's access to something their role permits is
     * a real requirement, and it needs to be representable.
     */
    granted: boolean;
    createdAt?: string;
}

/** A permission plus its grants, as the admin screen needs it. */
export interface PermissionWithGrants extends PermissionDefinition {
    roleGrants: Array<{ role: string; granted: boolean; }>;
    userGrants: Array<{
        userId: string;
        granted: boolean;
        email?: string | null;
        displayName?: string | null;
    }>;
}

/** One resolved answer, with the reason — the admin UI explains WHY. */
export interface PermissionCheck {
    key: PermissionKey;
    allowed: boolean;
    /**
     * Which rule decided it. Ordered most-specific first in
     * `resolvePermission`, so this doubles as a trace of the decision path.
     */
    reason:
        | 'sysadmin-bypass'
        | 'user-grant'
        | 'user-deny'
        | 'role-grant'
        | 'role-deny'
        | 'default-everyone'
        | 'default-role'
        | 'default-nobody'
        | 'unknown-permission';
}

/**
 * The precedence every check follows, most specific first.
 *
 * Exported as data (not just prose) so the admin UI can describe the same order
 * the server enforces without restating it.
 */
export const PERMISSION_PRECEDENCE: readonly string[] = [
    'A sysadmin is always allowed.',
    'A grant on the specific user wins (allow or deny).',
    'Otherwise a grant on the user\'s role wins (allow or deny).',
    'Otherwise the permission\'s own default applies.',
];

/** Is `key` shaped like a permission key? */
export function isValidPermissionKey(key: string,): boolean {
    return /^[a-z0-9]+(?:[._-][a-z0-9]+)*:[a-z0-9]+(?:[._-][a-z0-9]+)*$/i.test(key,);
}

/** The feature segment of a key (`shop.orders:refund` → `shop.orders`). */
export function permissionFeatureOf(key: PermissionKey,): string {
    const i = key.indexOf(':',);
    return i === -1 ? key : key.slice(0, i,);
}

/** The action segment of a key (`shop.orders:refund` → `refund`). */
export function permissionActionOf(key: PermissionKey,): string {
    const i = key.indexOf(':',);
    return i === -1 ? '' : key.slice(i + 1,);
}
