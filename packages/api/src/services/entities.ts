/**
 * Generic entity instance service — validation, slug/status handling, and
 * read caching (honoring each type's `caching` rules) over the generic repo.
 * The single business-logic home for CRUD on ANY entity type.
 */
import { getVirtualFilter, splitVirtualFilters as splitVirtual, type SqlCondition, } from '../entities/virtualFilters';
import { createHash, } from 'crypto';
import { type EntityFieldOption, type EntityQuery, type EntityRecord, generateSlug, } from '@sitesurge/types';
import * as repo from '../repositories/genericEntity.repo';
import { attachFeaturedMedia, withFeaturedMedia, } from './mediaRefs';
import * as entityManager from '../entities/entityManager';
import { getEntityDataProvider, } from '../entities/dataProviders';
import { columnFor, validateRecord, } from '../entities/columnMap';
import { copyRecord, } from '../entities/recordCopy';
import { transaction, } from '../db/client';
import { cache, CACHE_KEYS, } from './cache';
import { NotFoundError, ValidationError, } from '../middleware/error';

import { UUID_RE, } from '../utils/uuid';
import {
    type EntityViewer, gatePostRecords, hiddenPostCondition, isGatedType, isHiddenStatus, rankFor, statusAllows,
    visibleStatusCondition, filterPageRecords, isAccessControlledType, pageAllows,
} from '../entities/publicRead';

/**
 * Read options. `admin` = a staff caller (every status, no gate, no cache).
 * `viewer` = the signed-in non-staff caller, for the post subscription gate;
 * omitted = anonymous (SSR, mail, the backend template runtime).
 */
export interface EntityReadOpts {
    admin?: boolean;
    viewer?: EntityViewer;
    /**
     * Who the records are rendered for, as a hint to a data PROVIDER: `email` =
     * a newsletter (e.g. the gallery reads public MEDIA only, ignoring the
     * in-site gate). The generic repo ignores it; it is part of the cache key.
     */
    audience?: 'email';
}

/**
 * Cache key for a query.
 *
 * Keys are SORTED before hashing, at both levels: `JSON.stringify` preserves
 * INSERTION order, so `{sortBy, limit}` and `{limit, sortBy}` — the same query,
 * built by two different callers — hashed differently and each took its own
 * cache slot. Every caller missed the other's entry, and the wasted slots
 * multiplied once queries started carrying sort and filter clauses.
 *
 * Only two levels deep because that is the whole shape: the query is flat apart
 * from `filter`, whose values are `{op, value}` pairs.
 */
export function hashQuery(q: EntityQuery,): string {
    const stable = (v: unknown,): unknown => {
        if (typeof v !== 'object' || v === null || Array.isArray(v,)) return v;
        const out: Record<string, unknown> = {};
        // `sort()` (not `toSorted()`, which needs lib es2023) — `Object.keys`
        // already returned a fresh array, so there is nothing to mutate.
        for (const k of Object.keys(v as object,).sort()) {
            out[k] = stable((v as Record<string, unknown>)[k],);
        }
        return out;
    };
    return createHash('sha1',).update(JSON.stringify(stable(q,),),).digest('hex',).slice(0, 16,);
}

/**
 * Types holding PII that must NEVER be read through the generic (optional-auth)
 * entities API by a non-staff caller. Other internal types (post/page/product/…)
 * ARE meant to be publicly readable (entity blocks render them on public pages),
 * so this is a targeted denylist, not a blanket `internal` block. Guarded reads
 * throw NotFound (not 403) so the type's existence isn't revealed.
 */
const PRIVATE_TYPES = new Set(['contact', 'user',]);

function guardPrivateRead(typeKey: string, admin: boolean | undefined,): void {
    if (PRIVATE_TYPES.has(typeKey,) && !admin) {
        throw new NotFoundError(`Entity type "${typeKey}"`,);
    }
}

async function requireType(typeKey: string,) {
    await entityManager.ready();
    return entityManager.requireType(typeKey,);
}

/**
 * List/query records. `admin` responses (all statuses) bypass the cache.
 *
 * A non-admin read never returns a draft/archived record and runs posts
 * through the subscription gate (entities/publicRead.ts) — the same rules as
 * the bespoke public endpoints, so this surface is not a side door.
 */
export async function list(
    typeKey: string,
    q: EntityQuery = {},
    opts: EntityReadOpts = {},
): Promise<{ items: EntityRecord[]; total: number; }> {
    guardPrivateRead(typeKey, opts.admin,);
    const t = await requireType(typeKey,);
    // An explicit request for a hidden status from a non-staff caller matches nothing.
    if (!opts.admin && t.hasStatus && isHiddenStatus(q.status,)) return { items: [], total: 0, };
    const gated = !opts.admin && isGatedType(typeKey,);
    const rank = gated ? await rankFor(opts.viewer,) : null;
    // A provider with a per-viewer `allows` (e.g. `event`: view access) returns
    // a VIEWER-SHAPED list, so it is never list-cached — a cached member's
    // list would be served to anonymous visitors.
    const viewerShaped = Boolean(getEntityDataProvider(typeKey,)?.allows,);
    const cacheable = Boolean(t.caching?.indexEnabled,) && !opts.admin && !viewerShaped;
    // The hidden-post clause depends on the viewer's rank, so the rank is part of the key.
    const keyed: EntityQuery = gated ? { ...q, filter: { ...(q.filter ?? {}), __rank: String(rank,), }, } as EntityQuery : q;
    const key = CACHE_KEYS.entityList(typeKey, hashQuery(opts.audience ? { ...keyed, filter: { ...(keyed.filter ?? {}), __audience: opts.audience, }, } as EntityQuery : keyed,),);
    let res: { items: EntityRecord[]; total: number; } | null = cacheable ? await cache.get<{ items: EntityRecord[]; total: number; }>(key,) : null;
    if (!res) {
        const provider = getEntityDataProvider(typeKey,);
        const { query: plainQ, conditions, } = await splitVirtualFilters(typeKey, q,);
        if (!opts.admin && t.hasStatus) conditions.push(visibleStatusCondition,);
        const hidden = gated ? hiddenPostCondition(rank,) : null;
        if (hidden) conditions.push(hidden,);
        // A provider gets the FULL query, virtual keys included, and interprets
        // them itself (e.g. the discussion types' sort/window/category knobs);
        // the generic repo gets them pre-resolved as SQL conditions.
        res = provider?.list ? await provider.list(q, opts,) : await repo.list(t, plainQ, { extraWhere: conditions, },);
        // Any record with a `featuredImage` URL gets its media item (title,
        // description, credits) — what `{{post.featuredImage.credits}}` reads.
        await attachFeaturedMedia(res.items,);
        // Cached UNGATED (the body is replaced per request below).
        if (cacheable) await cache.set(key, res, t.caching.indexTtlSeconds,);
    }
    if (!opts.admin && t.hasStatus) res.items = res.items.filter((r,) => statusAllows(t, r,),);
    if (gated) res.items = await gatePostRecords(res.items, rank,);
    // Per request (the cached list is unfiltered). `total` may over-count a
    // gated page — the same trade-off the events list makes.
    if (!opts.admin && isAccessControlledType(typeKey,)) res.items = await filterPageRecords(res.items, opts.viewer,);
    return res;
}

/** Virtual-filter split for the generic repo (shared with data providers). */
async function splitVirtualFilters(typeKey: string, q: EntityQuery,): Promise<{ query: EntityQuery; conditions: SqlCondition[]; }> {
    return splitVirtual(typeKey, q as EntityQuery & { filter?: Record<string, unknown>; },) as Promise<{ query: EntityQuery; conditions: SqlCondition[]; }>;
}

/** Get one record by id OR slug. Non-admin: hidden statuses 404, posts are gated. */
export async function get(typeKey: string, idOrSlug: string, opts: EntityReadOpts = {},): Promise<EntityRecord> {
    guardPrivateRead(typeKey, opts.admin,);
    const t = await requireType(typeKey,);
    const cacheable = Boolean(t.caching?.recordEnabled,) && !opts.admin && UUID_RE.test(idOrSlug,);
    const key = CACHE_KEYS.entityRecord(typeKey, idOrSlug,);
    let rec: EntityRecord | null = cacheable ? await cache.get<EntityRecord>(key,) : null;
    if (!rec) {
        const provider = getEntityDataProvider(typeKey,);
        const byId = UUID_RE.test(idOrSlug,);
        const getFirst = provider?.getById || provider?.getBySlug ? provider : { getById: (id: string,) => repo.getById(t, id,), getBySlug: (sl: string,) => repo.getBySlug(t, sl,), };
        rec = (byId
            ? (await getFirst.getById?.(idOrSlug,)) ?? (await getFirst.getBySlug?.(idOrSlug,).catch(() => null))
            : (await getFirst.getBySlug?.(idOrSlug,)) ?? (await getFirst.getById?.(idOrSlug,).catch(() => null))) ?? null;
        if (!rec) throw new NotFoundError(`${t.label} "${idOrSlug}"`,);
        await withFeaturedMedia(rec,);
        // Cached UNGATED (the gate below runs per request).
        if (cacheable) await cache.set(key, rec, t.caching.recordTtlSeconds,);
    }
    if (!opts.admin) {
        // NotFound, not 403: a draft's existence is not revealed.
        if (!statusAllows(t, rec,)) throw new NotFoundError(`${t.label} "${idOrSlug}"`,);
        if (isGatedType(typeKey,)) {
            const [gatedRec,] = await gatePostRecords([rec,], await rankFor(opts.viewer,),);
            if (!gatedRec) throw new NotFoundError(`${t.label} "${idOrSlug}"`,);
            rec = gatedRec;
        }
        if (isAccessControlledType(typeKey,) && !(await pageAllows(rec, opts.viewer,))) {
            throw new NotFoundError(`${t.label} "${idOrSlug}"`,);
        }
        // A provider's own read rule (e.g. an event's "who can see").
        const allows = getEntityDataProvider(typeKey,)?.allows;
        if (allows && !(await allows(rec, opts,))) throw new NotFoundError(`${t.label} "${idOrSlug}"`,);
    }
    return rec;
}

function resolveSlug(t: { hasSlug: boolean; }, data: Record<string, unknown>, explicit?: string,): string | undefined {
    if (!t.hasSlug) return undefined;
    if (explicit) return generateSlug(explicit,);
    const base = (data.slug || data.title || data.name || '') as string;
    return base ? generateSlug(base,) : `item-${createHash('sha1',).update(JSON.stringify(data,),).digest('hex',).slice(0, 8,)}`;
}

export async function create(
    typeKey: string,
    body: Record<string, unknown>,
    ctx: { userId?: string; },
): Promise<EntityRecord> {
    const t = await requireType(typeKey,);
    const provider = getEntityDataProvider(typeKey,);
    if (provider?.create) {
        const rec = await provider.create(body, ctx,);
        await cache.invalidateEntityCache(typeKey,);
        return rec;
    }
    const data = validateRecord(t.fields, body,);
    const slug = resolveSlug(t, body, body.slug as string | undefined,);
    const rec = await repo.create(t, data, {
        userId: ctx.userId, slug, status: t.hasStatus ? (body.status as string) ?? 'draft' : undefined,
    },);
    await cache.invalidateEntityCache(typeKey,);
    return rec;
}

export async function update(
    typeKey: string,
    id: string,
    body: Record<string, unknown>,
): Promise<EntityRecord> {
    const t = await requireType(typeKey,);
    const provider = getEntityDataProvider(typeKey,);
    if (provider?.update) {
        const rec = await provider.update(id, body,);
        await cache.invalidateEntityCache(typeKey,);
        return rec;
    }
    const data = validateRecord(t.fields, body, { partial: true, },);
    const rec = await repo.update(t, id, data, {
        slug: body.slug !== undefined ? resolveSlug(t, body, body.slug as string,) : undefined,
        status: body.status as string | undefined,
    },);
    if (!rec) throw new NotFoundError(`${t.label} "${id}"`,);
    await cache.invalidateEntityCache(typeKey,);
    return rec;
}

/**
 * Deep-duplicate a record: clones the base row (unique columns re-suffixed so
 * they can't collide) plus any registered related rows (a page/post's content
 * blocks), all in one transaction. Returns the freshly-minted clone (admin view)
 * so the caller can redirect the operator straight into editing it.
 */
export async function copy(
    typeKey: string,
    id: string,
    _ctx: { userId?: string; } = {},
    /**
     * Field values for the copy, keyed by FIELD name (camelCase, as the API
     * speaks). Anything not listed is taken from the source row.
     *
     * Exists so a caller can name the duplicate — "Title (Copy)" / "slug-copy"
     * — rather than accepting the automatic `-1` suffix. Unique values are
     * still collision-checked, so a requested slug that is taken is suffixed
     * instead of failing.
     */
    overrides: Record<string, unknown> = {},
): Promise<EntityRecord> {
    const t = await requireType(typeKey,);
    // Translate field names to column names; ignore anything that is not a
    // real column on this type, so a stray key can't reach the INSERT.
    const byColumn: Record<string, unknown> = {};
    for (const [k, v,] of Object.entries(overrides,)) {
        const field = t.fields.find((f,) => f.key === k);
        if (!field) continue;
        try {
            byColumn[columnFor(field,)] = v;
        } catch { /* non-column field (e.g. blocks) — not overridable */ }
    }
    const newId = await transaction((client,) => copyRecord(client, t, id, byColumn,));
    await cache.invalidateEntityCache(typeKey,);
    // Core types keep their own caches alongside the generic entity cache.
    const coreInvalidators: Record<string, () => Promise<void>> = {
        page: () => cache.invalidatePageCache(),
        post: () => cache.invalidatePostCache(),
        campaign: () => cache.invalidateCampaignCache(),
        form: () => cache.invalidateFormCache(),
        user: () => cache.invalidateUserCache(),
    };
    await coreInvalidators[typeKey]?.();
    return get(typeKey, newId, { admin: true, },);
}

export async function remove(typeKey: string, id: string,): Promise<void> {
    const t = await requireType(typeKey,);
    const provider = getEntityDataProvider(typeKey,);
    if (provider?.remove) {
        await provider.remove(id,);
        await cache.invalidateEntityCache(typeKey,);
        return;
    }
    const ok = await repo.remove(t, id,);
    if (!ok) throw new NotFoundError(`${t.label} "${id}"`,);
    await cache.invalidateEntityCache(typeKey,);
}

export async function count(typeKey: string, q: EntityQuery = {},): Promise<number> {
    const res = await list(typeKey, { ...q, limit: 1, },);
    return res.total;
}

/**
 * Distinct/enum values of a `filterable` field, for a filter dropdown. Enum
 * fields return their defined label/value options (no query); other filterable
 * fields return DISTINCT column values (label = value). Cached aggressively
 * under the entity:<type>: prefix, so it's invalidated on any record write.
 */
export async function getFilterValues(
    typeKey: string,
    fieldKey: string,
    search?: string,
): Promise<EntityFieldOption[]> {
    const t = await requireType(typeKey,);

    // Query-only properties (a post's subscription level / type) answer from
    // their own option lists.
    const virtual = getVirtualFilter(typeKey, fieldKey,);
    if (virtual) return applySearch(await virtual.options(), search,);

    // Standard columns aren't schema fields, but every record has them and they
    // are filterable in the query builder — so they need suggestions too.
    const standard = STANDARD_SUGGEST_COLUMNS[fieldKey];
    const usable = standard
        ? (fieldKey === 'slug' ? t.hasSlug : fieldKey === 'status' ? t.hasStatus : true)
        : false;
    const field = t.fields.find((f,) => f.key === fieldKey,);
    if (!field && !(standard && usable)) {
        throw new NotFoundError(`Field "${fieldKey}" on ${t.label}`,);
    }
    // Blocks/relations have no meaningful literal value set to suggest.
    if (field && NON_SUGGESTABLE_TYPES.has(field.type,)) {
        throw new ValidationError(`Field "${fieldKey}" has no suggestable values`,);
    }

    // Enum + boolean: the allowed values are known up front. No query, no cache
    // entry, and — unlike DISTINCT — a valid option still appears when no record
    // currently uses it, which is what you want when building a filter.
    if (field?.type === 'enum') {
        const opts = field.options?.enumOptions
            ?? (field.options?.values ?? []).map((v,) => ({ label: v, value: v, }));
        return applySearch(opts, search,);
    }
    if (field?.type === 'boolean') {
        return applySearch([{ label: 'true', value: 'true', }, { label: 'false', value: 'false', },], search,);
    }

    // Everything else: DISTINCT column values. The FULL (capped) list is what
    // gets cached — `search` is applied in memory afterwards. Caching per search
    // term instead would multiply the key space by every prefix a user types
    // and defeat the prefix invalidation, for no gain: the list is already
    // capped at a size worth filtering client-side.
    const key = CACHE_KEYS.entityFilterValues(typeKey, fieldKey,);
    let opts = await cache.get<EntityFieldOption[]>(key,);
    if (!opts) {
        const values = await repo.distinctValues(t, field ?? { key: fieldKey, },);
        opts = values.map((v,) => ({ label: v, value: v, }));
        // Long TTL — the entity:<type>: prefix invalidation on writes keeps it fresh.
        await cache.set(key, opts, 3600,);
    }
    return applySearch(opts, search,);
}

/** Standard columns every record carries, offered alongside schema fields. */
const STANDARD_SUGGEST_COLUMNS: Record<string, true> = { status: true, slug: true, };

/** Field types whose values are structural, not literals worth suggesting. */
const NON_SUGGESTABLE_TYPES = new Set(['blocks', 'richtext', 'longtext', 'json',],);

/** Case-insensitive substring match, capped so a dropdown stays a dropdown. */
function applySearch(opts: EntityFieldOption[], search?: string,): EntityFieldOption[] {
    const q = (search ?? '').trim().toLowerCase();
    const matched = q
        ? opts.filter((o,) => o.label.toLowerCase().includes(q,) || o.value.toLowerCase().includes(q,))
        : opts;
    return matched.slice(0, 50,);
}
