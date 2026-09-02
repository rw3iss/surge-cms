/**
 * The permission decision itself — pure, so it can be tested without a database
 * and reused verbatim by the client when it wants to hide a button.
 *
 * Everything about authorisation that is subtle lives here, in one function,
 * rather than being spread across route guards.
 */
import type {
    PermissionCheck,
    PermissionDefinition,
    PermissionGrant,
    PermissionKey,
} from '@sitesurge/types';

export interface PermissionSubject {
    id?: string | null;
    role?: string | null;
}

/**
 * Decide one permission for one subject.
 *
 * Precedence, most specific first: sysadmin → user grant → role grant →
 * the permission's own default. Specificity beats permissiveness at every step,
 * which is what makes a per-user DENY able to override a role that allows.
 */
export function resolvePermission(
    permission: PermissionDefinition | undefined,
    subject: PermissionSubject,
    grants: readonly PermissionGrant[] = [],
): PermissionCheck {
    const key = permission?.key ?? '';

    // A sysadmin is never locked out. Without this, an admin could revoke the
    // permission that manages permissions and leave the site unadministrable —
    // recoverable only by hand-editing the database.
    if (subject.role === 'sysadmin') {
        return { key, allowed: true, reason: 'sysadmin-bypass', };
    }

    // An unknown key denies. A typo in a guard must fail CLOSED: the alternative
    // is that misspelling a permission silently grants everyone access.
    if (!permission) {
        return { key, allowed: false, reason: 'unknown-permission', };
    }

    if (subject.id) {
        const userGrant = grants.find(
            (g,) => g.subjectType === 'user' && g.subjectId === subject.id,
        );
        if (userGrant) {
            return {
                key,
                allowed: userGrant.granted,
                reason: userGrant.granted ? 'user-grant' : 'user-deny',
            };
        }
    }

    if (subject.role) {
        const roleGrant = grants.find(
            (g,) => g.subjectType === 'role' && g.subjectId === subject.role,
        );
        if (roleGrant) {
            return {
                key,
                allowed: roleGrant.granted,
                reason: roleGrant.granted ? 'role-grant' : 'role-deny',
            };
        }
    }

    switch (permission.defaultAccess) {
        case 'everyone':
            return { key, allowed: true, reason: 'default-everyone', };
        case 'roles': {
            const allowed = Boolean(
                subject.role && permission.defaultRoles.includes(subject.role,),
            );
            return { key, allowed, reason: 'default-role', };
        }
        case 'nobody':
        default:
            // `nobody` still lets a specific grant open it up — the checks above
            // already ran — so it reads as "no one unless explicitly named".
            return { key, allowed: false, reason: 'default-nobody', };
    }
}

/** Resolve many at once; grants may cover several permissions. */
export function resolveMany(
    permissions: readonly PermissionDefinition[],
    subject: PermissionSubject,
    grants: readonly PermissionGrant[] = [],
): Record<PermissionKey, boolean> {
    const byKey = new Map<PermissionKey, PermissionGrant[]>();
    for (const g of grants) {
        const list = byKey.get(g.permissionKey,) ?? [];
        list.push(g,);
        byKey.set(g.permissionKey, list,);
    }
    const out: Record<PermissionKey, boolean> = {};
    for (const p of permissions) {
        out[p.key] = resolvePermission(p, subject, byKey.get(p.key,) ?? [],).allowed;
    }
    return out;
}
