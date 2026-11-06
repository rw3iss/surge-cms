/**
 * ROLE ADMIN SHELLS — what a NON-staff role sees when it enters the admin.
 *
 * Staff (editor / admin / sysadmin) always get the full admin. A role listed
 * here may ALSO enter `/admin`, with a reduced shell: only the `nav` items
 * (Dashboard is always shown) and its own dashboard view. A shell decides what
 * is VISIBLE; what a user may DO is still the permissions system — every nav
 * item also needs its permission, and the server checks every route.
 *
 * Add a role: one entry below (+ a dashboard in `admin/dashboards/` if it
 * needs its own). Main role first, then additional roles, in this order.
 */
import type { User, } from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';

export interface AdminShellConfig {
    /** Nav item ids shown besides Dashboard (see `NAV_ITEMS` in AdminLayout). */
    nav: string[];
    /** Dashboard view id (`admin/dashboards`); unknown/missing → `default`. */
    dashboard?: string;
    /**
     * Admin paths this shell may open, besides `/admin` itself (prefix match).
     * Defaults to the nav items' paths.
     */
    paths?: string[];
    /**
     * Paths under an allowed prefix that stay CLOSED (prefix match) — e.g.
     * `/admin/posts/settings` under `/admin/posts`: its form saves with a
     * staff-only route, so a contributor would only meet a 403 on Save.
     */
    deny?: string[];
}

export const ROLE_SHELLS: Record<string, AdminShellConfig> = {
    contributor: {
        nav: ['posts',],
        dashboard: 'contributor',
        paths: ['/admin/posts', '/admin/help', '/admin/notifications',],
        deny: ['/admin/posts/settings',],
    },
};

const under = (path: string, prefix: string,) => path === prefix || path.startsWith(`${prefix}/`,);

/**
 * May a shell open this admin path? `/admin` and the user's own notifications
 * always; else an allowed prefix (`paths`, default the nav items' paths) that
 * no `deny` prefix closes. Trailing slashes and query strings are ignored.
 */
export function shellAllowsPath(shell: AdminShellConfig, path: string, navPaths: string[] = [],): boolean {
    const p = (path.split(/[?#]/,)[0] || '/').replace(/\/+$/, '',) || '/';
    if (p === '/admin' || p === '/admin/notifications') return true;
    if ((shell.deny ?? []).some((d,) => under(p, d,),)) return false;
    return (shell.paths ?? navPaths).some((a,) => under(p, a,),);
}

/** The shell for a user: null for staff (full admin) and for users without one. */
export function adminShellFor(user: Pick<User, 'role' | 'extraRoles'> | null | undefined,): AdminShellConfig | null {
    if (!user || isStaffRole(user.role,)) return null;
    for (const key of [user.role, ...(user.extraRoles ?? []),]) {
        if (key && ROLE_SHELLS[key]) return ROLE_SHELLS[key];
    }
    return null;
}

/** May this user enter `/admin` at all? Staff, or a role with a shell. */
export function canEnterAdmin(user: Pick<User, 'role' | 'extraRoles'> | null | undefined,): boolean {
    return !!user && (isStaffRole(user.role,) || adminShellFor(user,) !== null);
}
