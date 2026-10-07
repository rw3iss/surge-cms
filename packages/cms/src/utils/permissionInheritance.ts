/**
 * Which permissions a ROLE already gives — mirrored from the server's resolver
 * (`services/permissions/resolve.ts`) for DISPLAY only (the server decides):
 * walk the role then its base roles; the first role with a grant on a
 * permission decides it, else the permission's default (everyone, or a listed
 * role anywhere in the chain).
 */
import type { PermissionWithGrants, RoleDef, } from '@sitesurge/types';

export function roleChainOf(role: string | null | undefined, roles: RoleDef[],): string[] {
    const byKey = new Map(roles.map((r,) => [r.key, r,]),);
    const out: string[] = [];
    let cur = role ?? null;
    while (cur && !out.includes(cur,) && out.length < 8) {
        out.push(cur,);
        cur = byKey.get(cur,)?.baseRole ?? null;
    }
    return out;
}

export function roleAllows(p: PermissionWithGrants, chain: string[],): boolean {
    for (const r of chain) {
        const g = p.roleGrants.find((x,) => x.role === r,);
        if (g) return g.granted;
    }
    if (p.defaultAccess === 'everyone') return true;
    if (p.defaultAccess === 'roles') return chain.some((r,) => p.defaultRoles.includes(r,),);
    return false;
}
