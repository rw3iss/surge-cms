/**
 * Who a permission subject IS, beyond `{ id, role }`:
 *
 *   roleChain — the role and the roles it inherits from (`subscriber` →
 *               `member`), most specific first. A custom role gets everything
 *               its base role has, then what is granted to it directly.
 *   planId    — the user's subscription TIER: their active paid plan, else the
 *               `free` tier (so the free tier's extra permissions apply to every
 *               signed-in member). Anonymous subjects have none.
 *
 * Both are cached in-process (roles change rarely; a plan for 30 s per user)
 * and dropped by the writers (`invalidateRoles`, `invalidatePlan`).
 */
import { query, } from '../../db';

export interface EnrichedSubject {
    id?: string | null;
    role?: string | null;
    roleChain: string[];
    planId: string | null;
}

let roleBase: Map<string, string | null> | null = null;

export function invalidateRoles(): void {
    roleBase = null;
}

async function bases(): Promise<Map<string, string | null>> {
    if (roleBase) return roleBase;
    try {
        const r = await query<{ key: string; base_role: string | null; }>(`SELECT key, base_role FROM roles`,);
        roleBase = new Map(r.rows.map((x,) => [x.key, x.base_role,]),);
    } catch {
        roleBase = new Map(); // pre-migration DB: no inheritance
    }
    return roleBase;
}

/** `[role, base, base's base, …]` — cycle-safe, max depth 8. */
export async function roleChain(role: string | null | undefined,): Promise<string[]> {
    if (!role) return [];
    const map = await bases();
    const out: string[] = [];
    let cur: string | null | undefined = role;
    while (cur && !out.includes(cur,) && out.length < 8) {
        out.push(cur,);
        cur = map.get(cur,) ?? null;
    }
    return out;
}

const PLAN_TTL_MS = 30_000;
const planCache = new Map<string, { planId: string | null; at: number; }>();

export function invalidatePlan(userId?: string,): void {
    if (userId) planCache.delete(userId,);
    else planCache.clear();
}

/** Statuses that still entitle the user to the tier. */
export const ENTITLED_STATUSES = ['active', 'trialing', 'past_due',];

export async function activePlanId(userId: string | null | undefined,): Promise<string | null> {
    if (!userId) return null;
    const hit = planCache.get(userId,);
    if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.planId;
    let planId: string | null = null;
    try {
        const r = await query<{ plan_id: string; }>(
            `SELECT COALESCE(
                (SELECT s.plan_id FROM subscriptions s
                  WHERE s.user_id = $1 AND s.status = ANY($2)
                  ORDER BY s.created_at DESC LIMIT 1),
                (SELECT id FROM subscription_plans WHERE is_free LIMIT 1)
             ) AS plan_id`,
            [userId, ENTITLED_STATUSES,],
        );
        planId = r.rows[0]?.plan_id ?? null;
    } catch {
        planId = null; // pre-migration DB
    }
    planCache.set(userId, { planId, at: Date.now(), },);
    return planId;
}

const extraCache = new Map<string, { roles: string[]; at: number; }>();

/** A user's ADDITIONAL roles (`users.extra_roles`), cached like the plan. */
export async function extraRoles(userId: string | null | undefined,): Promise<string[]> {
    if (!userId) return [];
    const hit = extraCache.get(userId,);
    if (hit && Date.now() - hit.at < PLAN_TTL_MS) return hit.roles;
    let roles: string[] = [];
    try {
        const r = await query<{ extra_roles: string[] | null; }>(`SELECT extra_roles FROM users WHERE id = $1`, [userId,],);
        roles = r.rows[0]?.extra_roles ?? [];
    } catch {
        roles = []; // pre-migration DB
    }
    extraCache.set(userId, { roles, at: Date.now(), },);
    return roles;
}

export function invalidateUserRoles(userId?: string,): void {
    if (userId) extraCache.delete(userId,);
    else extraCache.clear();
}

/**
 * The PRIMARY role's chain first (so its explicit grants decide), then each
 * additional role's chain. Role DEFAULTS look at the whole chain, so an
 * additional role adds what it allows by default.
 */
export async function enrich(subject: { id?: string | null; role?: string | null; },): Promise<EnrichedSubject> {
    const [chain, planId, extras,] = await Promise.all([roleChain(subject.role,), activePlanId(subject.id,), extraRoles(subject.id,),],);
    const all = [...chain,];
    for (const r of extras) for (const x of await roleChain(r,)) if (!all.includes(x,)) all.push(x,);
    return { id: subject.id, role: subject.role, roleChain: all, planId, };
}
