/**
 * Viewer ACCESS LEVELS, shared by every feature with a "who may see this"
 * rule (forum, gallery, …). A level is comparable with subscription tier
 * ranks: anonymous = -1, a signed-in member with no paid tier = 0 (Free), a
 * subscriber = their tier's rank, staff = Infinity.
 *
 * A rule is `public` (-1) | `members` (0) | `tier` (that tier's rank); a
 * viewer passes when `level >= floor`.
 */
import { isStaffRole, } from '@sitesurge/types';
import { tiersById, viewerRank, } from '../postGate';
import { getPolicy as getSubscriptionPolicy, } from '../subscriptionAccess';

export type AccessRule = 'public' | 'members' | 'tier';
export type LevelViewer = { id?: string | null; role?: string | null; } | null | undefined;

export async function viewerLevel(v: LevelViewer,): Promise<number> {
    if (!v?.id) return -1;
    if (isStaffRole(v.role as never,)) return Infinity;
    const rank = await viewerRank(v as never,).catch(() => null);
    if (rank !== null) return Math.max(0, rank,);
    // No tier: an ordinary signed-in member (Free = 0) — unless subscription-
    // required mode is on, where Free does not count and they are a visitor.
    return (await getSubscriptionPolicy()).required ? -1 : 0;
}

/** A rule as a level. `tier` with an unknown/removed tier falls back to members. */
export async function floorFor(rule: AccessRule, tierId: string | null | undefined,): Promise<number> {
    if (rule === 'public') return -1;
    if (rule === 'members') return 0;
    const t = tierId ? (await tiersById()).get(tierId,) : undefined;
    return t ? t.sortOrder : 0;
}

/** Why a viewer below `floor` is refused — for a sign-in / subscribe prompt. */
export function refusalReason(level: number, floor: number,): 'signin' | 'subscribe' | null {
    if (level >= floor) return null;
    return level < 0 ? (floor <= 0 ? 'signin' : 'subscribe') : 'subscribe';
}
