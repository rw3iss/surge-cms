/**
 * Subscription gating for posts.
 *
 * A post may require a subscription TIER (`posts.required_tier_id`). Tiers are
 * ranked by `subscription_plans.sort_order`: a viewer passes when their own
 * tier's sort_order is ≥ the required one (Free = 0, so requiring Free means
 * "signed in"). Staff always pass. Anonymous viewers have no tier.
 *
 * Every public read of a post goes through `applyGate` — the API (detail +
 * list), SSR, RSS — so a locked viewer never receives the full body: they get
 * the sample blocks (when the post shows a sample) or no body at all. Hidden
 * posts are excluded in SQL (`hiddenClause`), so list totals stay right.
 */
import type { Post, PostGate, PostGateTier, User, } from '@sitesurge/types';
import { isStaffRole, } from '@sitesurge/types';
import { query, } from '../../db';
import { activePlanId, } from '../permissions/subjects';
import { samplePostContent, } from './samples';

interface TierRank extends PostGateTier {
    sortOrder: number;
}

/** Viewer rank: `Infinity` = staff (sees everything), `null` = no tier. */
export type ViewerRank = number | null;

const TIER_TTL_MS = 60_000;
let tierCache: { at: number; byId: Map<string, TierRank>; } | null = null;

export async function tiersById(): Promise<Map<string, TierRank>> {
    if (tierCache && Date.now() - tierCache.at < TIER_TTL_MS) return tierCache.byId;
    const r = await query<{ id: string; name: string; slug: string | null; sort_order: number; }>(
        `SELECT id, name, slug, sort_order FROM subscription_plans`,
    );
    const byId = new Map(r.rows.map((t,) => [t.id, { id: t.id, name: t.name, slug: t.slug, sortOrder: Number(t.sort_order ?? 0,), },],),);
    tierCache = { at: Date.now(), byId, };
    return byId;
}

/** Drop the tier cache (a tier was created, renamed, re-ordered or deleted). */
export function invalidateGateTiers(): void {
    tierCache = null;
}

export async function viewerRank(user: Pick<User, 'id' | 'role'> | null | undefined,): Promise<ViewerRank> {
    if (!user?.id) return null;
    if (isStaffRole(user.role,)) return Infinity;
    const planId = await activePlanId(user.id,);
    if (!planId) return null;
    return (await tiersById()).get(planId,)?.sortOrder ?? null;
}

type GateFields = Pick<Post, 'requiredTierId' | 'gateHidden' | 'gateShowSample' | 'gateSamplePercent'>;

/** Pure: how a viewer of `rank` sees a post. */
export function gateFor(post: GateFields, rank: ViewerRank, tiers: Map<string, TierRank>,): PostGate {
    const tier = post.requiredTierId ? tiers.get(post.requiredTierId,) : undefined;
    // A required tier that no longer exists gates nothing (FK is SET NULL,
    // but a cached row may still carry the id).
    if (!tier) return { state: 'public', requiredTier: null, sample: false, };
    const requiredTier = { id: tier.id, name: tier.name, slug: tier.slug, };
    const ok = rank !== null && rank >= tier.sortOrder;
    if (ok) return { state: 'premium', requiredTier, sample: false, };
    return { state: 'locked', requiredTier, sample: !post.gateHidden && !!post.gateShowSample, };
}

/** Hidden from this viewer entirely (left out of lists, 404 on the page). */
export function isHiddenFor(post: GateFields, gate: PostGate,): boolean {
    return gate.state === 'locked' && !!post.gateHidden;
}

/**
 * Stamp `gate` on a post and, when locked, replace its body with the sample
 * (or nothing). Works on list rows (no blocks / blocks attached) and on the
 * detail shape (`contentBlocks`). Returns the same object.
 */
export function applyGateSync<T extends Post & { contentBlocks?: unknown[]; }>(
    post: T,
    rank: ViewerRank,
    tiers: Map<string, TierRank>,
): T {
    const gate = gateFor(post, rank, tiers,);
    post.gate = gate;
    if (gate.state !== 'locked') return post;
    if (gate.sample) {
        const sample = samplePostContent(post, post.gateSamplePercent ?? 25,);
        post.content = sample.content;
        if (post.contentBlocks) post.contentBlocks = sample.blocks as T['contentBlocks'];
    } else {
        post.content = '';
        if (post.contentBlocks) post.contentBlocks = [] as unknown as T['contentBlocks'];
    }
    return post;
}

export async function applyGate<T extends Post & { contentBlocks?: unknown[]; }>(
    posts: T[],
    user: Pick<User, 'id' | 'role'> | null | undefined,
): Promise<T[]> {
    if (posts.length === 0) return posts;
    const [rank, tiers,] = await Promise.all([viewerRank(user,), tiersById(),],);
    return posts.map((p,) => applyGateSync(p, rank, tiers,));
}

/**
 * SQL that removes posts hidden from a viewer of `rank`. Appends its param to
 * `params` and returns the clause (starting with ` AND`). Staff get nothing.
 */
export function hiddenClause(alias: string, rank: ViewerRank, params: unknown[],): string {
    if (rank === Infinity) return '';
    params.push(rank,);
    const p = `$${params.length}::int`;
    return ` AND (${alias}.required_tier_id IS NULL OR ${alias}.gate_hidden = false
        OR (${p} IS NOT NULL AND ${p} >= COALESCE((SELECT sp.sort_order FROM subscription_plans sp
                                                  WHERE sp.id = ${alias}.required_tier_id), 0)))`;
}
