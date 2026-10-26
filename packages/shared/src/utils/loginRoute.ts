/**
 * ROLE LOGIN ROUTES — where a user lands after signing in.
 *
 * Each role may set a `loginRoute` (a site path WITHOUT the leading slash;
 * `''` = the homepage; null = inherit from its base role) and a
 * `loginPriority`. A user's destination is the route of the highest-priority
 * role among ALL their roles (main + additional — program roles such as
 * `contributor` are additional roles), ties going to the main role. Used by
 * the server (login + /auth/me `loginRoute`) and shown in the role editor.
 */
export interface LoginRouteRole {
    key: string;
    baseRole: string | null;
    loginRoute: string | null;
    loginPriority: number;
}

/**
 * Sanitize an operator-typed route: trim, strip leading slashes, refuse
 * anything that is not an internal path (`//host`, `http:`, `javascript:` …).
 * `null`/`undefined` = unset (inherit); `''` = the homepage.
 */
export function normalizeLoginRoute(raw: string | null | undefined,): string | null {
    if (raw == null) return null;
    const s = String(raw,).trim().replace(/^\/+/, '',);
    if (/^[a-z][a-z0-9+.-]*:/i.test(s,) || s.includes('\\',) || /\s/.test(s,)) return null;
    return s.slice(0, 200,);
}

/** A role's own route + priority, else the first base role (up the chain) that sets one. */
function effective(key: string, byKey: Map<string, LoginRouteRole>,): { route: string; priority: number; } | null {
    const seen = new Set<string>();
    let cur: string | null = key;
    while (cur && !seen.has(cur,)) {
        seen.add(cur,);
        const r = byKey.get(cur,);
        if (!r) return null;
        if (r.loginRoute != null) return { route: r.loginRoute, priority: r.loginPriority, };
        cur = r.baseRole;
    }
    return null;
}

/**
 * The path (no leading slash; `''` = homepage) a user with `mainRole` +
 * `extraRoles` lands on after sign-in.
 */
export function loginRouteFor(roles: LoginRouteRole[], mainRole: string | null | undefined, extraRoles: string[] = [],): string {
    const byKey = new Map(roles.map((r,) => [r.key, r,]),);
    let best: { route: string; priority: number; } | null = null;
    for (const key of [mainRole, ...extraRoles,].filter((k,): k is string => !!k,)) {
        const e = effective(key, byKey,);
        if (e && (!best || e.priority > best.priority)) best = e; // strict > : ties keep the main role
    }
    return normalizeLoginRoute(best?.route ?? '',) ?? '';
}
