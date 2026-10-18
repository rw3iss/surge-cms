/**
 * Roles an admin can give as ADDITIONAL roles (`users.extra_roles`) or through
 * an invite: member-level roles only — never staff (a staff role is a
 * primary-role decision), never anonymous, and not plain `member` (every
 * account already is one).
 */
import type { RoleDef, } from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';

export function assignableRoles(roles: readonly RoleDef[] | undefined,): RoleDef[] {
    return (roles ?? []).filter((r,) => !isStaffRole(r.key,) && r.key !== 'anonymous' && r.key !== 'member',);
}

/** Role key → label ("ambassador" → "Ambassador"). */
export function roleLabel(roles: readonly RoleDef[] | undefined, key: string,): string {
    return (roles ?? []).find((r,) => r.key === key,)?.label ?? key;
}

/**
 * Roles an admin may set as a user's MAIN role: every role but `anonymous`,
 * and `sysadmin` only when the caller is a sysadmin (the server refuses it
 * otherwise — showing it would only produce an error).
 */
export function primaryRoleOptions(roles: readonly RoleDef[] | undefined, callerRole: string | null | undefined,): RoleDef[] {
    return (roles ?? []).filter((r,) => r.key !== 'anonymous' && (r.key !== 'sysadmin' || callerRole === 'sysadmin'),);
}
