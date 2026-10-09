/**
 * Virtual filters: properties an entity query can filter on that are not
 * plain columns — a post's `subscription` level (a RANK derived from its
 * required tier) and its `type`. Each one supplies its own suggestions and
 * turns `{ op, value }` into a parameterized SQL condition, so the generic
 * repo stays type-agnostic and nothing user-supplied is ever spliced into SQL.
 *
 * Registered per entity type; `services/entities.ts` pulls a query's virtual
 * keys out of `filter` before the repo sees it, and advertises the set on the
 * type definition (`EntityTypeDef.virtualFilters`) for the admin builders.
 */
import type { EntityFieldOption, EntityVirtualFilterDef, } from '@sitesurge/types';
import { listPostTypes, } from '@sitesurge/types';
import { query, } from '../db';

/** Appends its params; returns a SQL boolean expression over the type's table. */
export type SqlCondition = (params: unknown[],) => string;

export interface VirtualFilter extends EntityVirtualFilterDef {
    options(): Promise<EntityFieldOption[]>;
    /** Resolve one clause. Unknown values yield a condition that matches nothing. */
    resolve(op: string, value: unknown,): Promise<SqlCondition>;
}

const registry = new Map<string, Map<string, VirtualFilter>>();

export function registerVirtualFilter(typeKey: string, f: VirtualFilter,): void {
    if (!registry.has(typeKey,)) registry.set(typeKey, new Map(),);
    registry.get(typeKey,)!.set(f.key, f,);
}

export function getVirtualFilter(typeKey: string, key: string,): VirtualFilter | undefined {
    return registry.get(typeKey,)?.get(key,);
}

export function virtualFilterDefs(typeKey: string,): EntityVirtualFilterDef[] {
    return [...(registry.get(typeKey,)?.values() ?? []),].map(({ key, label, description, },) => ({ key, label, description, }));
}

const NOTHING: SqlCondition = () => 'FALSE';
const CMP: Record<string, string> = { eq: '=', ne: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: '=', };

/** `{ op:'in', value:'a, b' }` or an array → trimmed non-empty strings. */
function listOf(value: unknown,): string[] {
    const raw = Array.isArray(value,) ? value : String(value ?? '',).split(',',);
    return raw.map((v,) => String(v,).trim()).filter(Boolean,);
}

// ─── post.subscription ──────────────────────────────────────────────────

/** Rank of a post with no required tier (public): below Free (0). */
export const PUBLIC_RANK = -1;
const POST_RANK_SQL = `COALESCE((SELECT sp.sort_order FROM subscription_plans sp WHERE sp.id = "required_tier_id"), ${PUBLIC_RANK})`;

interface TierRow { id: string; slug: string | null; name: string; sort_order: number; is_free: boolean; }

async function tiers(): Promise<TierRow[]> {
    const r = await query<TierRow>(
        `SELECT id, slug, name, sort_order, is_free FROM subscription_plans WHERE is_active IS NOT FALSE OR is_free ORDER BY sort_order, created_at`,
    );
    return r.rows;
}

/** A level token → rank: `public`, a tier slug / id / name, or a number. */
function rankOf(token: string, rows: TierRow[],): number | null {
    const t = token.trim().toLowerCase();
    if (t === 'public' || t === 'none') return PUBLIC_RANK;
    if (/^-?\d+$/.test(t,)) return Number(t,);
    const hit = rows.find((r,) => r.id === token.trim() || (r.slug ?? '').toLowerCase() === t || r.name.toLowerCase() === t);
    return hit ? Number(hit.sort_order,) : null;
}

export const postSubscriptionFilter: VirtualFilter = {
    key: 'subscription',
    label: 'Subscription',
    description: 'Required subscription level. Levels rank by price: Public = -1, Free = 0, then 1, 2… cheapest first — so "> 0" means paid tiers only.',
    async options() {
        const rows = await tiers();
        return [
            { label: `Public — no subscription (${PUBLIC_RANK})`, value: 'public', },
            ...rows.map((r,) => ({ label: `${r.name} (${r.sort_order})`, value: r.slug || r.id, })),
        ];
    },
    async resolve(op, value,) {
        const rows = await tiers();
        if (op === 'in') {
            const ranks = listOf(value,).map((v,) => rankOf(v, rows,));
            if (ranks.some((r,) => r === null) || !ranks.length) return NOTHING;
            return (params,) => {
                params.push(ranks,);
                return `${POST_RANK_SQL} = ANY($${params.length}::int[])`;
            };
        }
        const sql = CMP[op];
        const rank = rankOf(String(value ?? '',), rows,);
        if (!sql || rank === null) return NOTHING;
        return (params,) => {
            params.push(rank,);
            return `${POST_RANK_SQL} ${sql} $${params.length}::int`;
        };
    },
};

// ─── post.type ──────────────────────────────────────────────────────────

export const postTypeFilter: VirtualFilter = {
    key: 'type',
    label: 'Post type',
    description: 'Article, Video, Short, Live Show, Custom…',
    async options() {
        return listPostTypes().map((t,) => ({ label: t.label, value: t.key, }));
    },
    async resolve(op, value,) {
        if (op === 'in') {
            const keys = listOf(value,).map((v,) => v.toLowerCase());
            if (!keys.length) return NOTHING;
            return (params,) => {
                params.push(keys,);
                return `"post_type" = ANY($${params.length}::text[])`;
            };
        }
        const v = String(value ?? '',).trim().toLowerCase();
        if (!v) return NOTHING;
        if (op === 'like') return (params,) => { params.push(`%${v}%`,); return `"post_type" ILIKE $${params.length}`; };
        if (op !== 'eq' && op !== 'ne') return NOTHING; // ordering is meaningless for a type
        return (params,) => {
            params.push(v,);
            return `"post_type" ${op === 'eq' ? '=' : '<>'} $${params.length}`;
        };
    },
};

registerVirtualFilter('post', postSubscriptionFilter,);
registerVirtualFilter('post', postTypeFilter,);
