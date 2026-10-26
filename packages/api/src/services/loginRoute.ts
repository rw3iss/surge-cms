/**
 * Where a user lands after signing in — `loginRouteFor` (`@sitesurge/types`)
 * over the role table and ALL the user's roles (main + additional). Returned
 * as `loginRoute` by POST /auth/login and GET /auth/me.
 */
import { loginRouteFor, type LoginRouteRole, } from '@sitesurge/types';
import { query, } from '../db';

let cache: { at: number; roles: LoginRouteRole[]; } | null = null;
const TTL_MS = 30_000;

/** Drop the cached role routes (role saved). Other workers refresh within the TTL. */
export function invalidateLoginRoutes(): void {
    cache = null;
}

async function roles(): Promise<LoginRouteRole[]> {
    if (cache && Date.now() - cache.at < TTL_MS) return cache.roles;
    const r = await query<{ key: string; base_role: string | null; login_route: string | null; login_priority: number; }>(
        `SELECT key, base_role, login_route, login_priority FROM roles`,
    );
    const list = r.rows.map((x,) => ({ key: x.key, baseRole: x.base_role, loginRoute: x.login_route, loginPriority: Number(x.login_priority ?? 0,), }));
    cache = { at: Date.now(), roles: list, };
    return list;
}

/** A user's additional roles (`users.extra_roles`). */
export async function extraRolesOf(userId: string,): Promise<string[]> {
    const r = await query<{ extra_roles: string[] | null; }>(`SELECT extra_roles FROM users WHERE id = $1`, [userId,],).catch(() => ({ rows: [], }),);
    return r.rows[0]?.extra_roles ?? [];
}

export async function loginRouteForUser(user: { id: string; role?: string | null; } | null | undefined,): Promise<string> {
    if (!user) return '';
    try {
        const extra = await query<{ extra_roles: string[] | null; }>(`SELECT extra_roles FROM users WHERE id = $1`, [user.id,],);
        return loginRouteFor(await roles(), user.role, extra.rows[0]?.extra_roles ?? [],);
    } catch {
        return '';
    }
}
