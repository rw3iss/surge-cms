/**
 * What a viewer HOLDS, for role / subscription-level rules ("visible to the
 * ambassador role or the Gold tier"): staff?, every role (main `users.role` +
 * `users.extra_roles`), and the subscription tiers they are entitled to.
 * Build it ONCE per request and pass it to the SQL predicates.
 *
 * Tiers: every plan of an entitled subscription (`ENTITLED_STATUSES`). A
 * signed-in member with no paid subscription holds the FREE tier — unless
 * subscription-required mode is on, where Free does not count (the same rule
 * as `access/level.ts`). Anonymous holds nothing.
 */
import { isStaffRole, } from '@sitesurge/types';
import { query, } from '../../db';
import { ENTITLED_STATUSES, extraRoles, } from '../permissions';
import { getPolicy as getSubscriptionPolicy, } from '../subscriptionAccess';
import type { LevelViewer, } from './level';

export interface ViewerGrants {
    signedIn: boolean;
    staff: boolean;
    roles: string[];
    tierIds: string[];
}

export const ANONYMOUS_GRANTS: ViewerGrants = { signedIn: false, staff: false, roles: [], tierIds: [], };

export async function viewerGrants(v: LevelViewer,): Promise<ViewerGrants> {
    if (!v?.id) return ANONYMOUS_GRANTS;
    const staff = isStaffRole(v.role as never,);
    const [extra, tiers,] = await Promise.all([
        extraRoles(v.id,).catch(() => [] as string[]),
        query<{ plan_id: string; }>(
            `SELECT DISTINCT plan_id FROM subscriptions WHERE user_id = $1 AND status = ANY($2) AND plan_id IS NOT NULL`,
            [v.id, ENTITLED_STATUSES,],
        ).then((r,) => r.rows.map((x,) => x.plan_id,),).catch(() => [] as string[]),
    ],);
    let tierIds = tiers;
    if (!tierIds.length && !(await getSubscriptionPolicy().catch(() => ({ required: false, }))).required) {
        tierIds = await query<{ id: string; }>(`SELECT id FROM subscription_plans WHERE is_free`,)
            .then((r,) => r.rows.map((x,) => x.id,),).catch(() => [],);
    }
    const roles = [...new Set([v.role, ...extra,].filter((r,): r is string => Boolean(r,),),),];
    return { signedIn: true, staff, roles, tierIds, };
}
