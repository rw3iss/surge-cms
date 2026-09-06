/**
 * Generic entity instance service — validation, slug/status handling, and
 * read caching (honoring each type's `caching` rules) over the generic repo.
 * The single business-logic home for CRUD on ANY entity type.
 */
import { createHash, } from 'crypto';
import { type EntityFieldOption, type EntityQuery, type EntityRecord, generateSlug, } from '@sitesurge/types';
import * as repo from '../repositories/genericEntity.repo';
import * as entityManager from '../entities/entityManager';
import { getEntityDataProvider, } from '../entities/dataProviders';
import { validateRecord, } from '../entities/columnMap';
import { copyRecord, } from '../entities/recordCopy';
import { transaction, } from '../db/client';
import { cache, CACHE_KEYS, } from './cache';
import { NotFoundError, ValidationError, } from '../middleware/error';

import { UUID_RE, } from '../utils/uuid';

function hashQuery(q: EntityQuery,): string {
    return createHash('sha1',).update(JSON.stringify(q,),).digest('hex',).slice(0, 16,);
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

/** List/query records. `admin` responses (all statuses) bypass the cache. */
export async function list(
    typeKey: string,
    q: EntityQuery = {},
    opts: { admin?: boolean; } = {},
): Promise<{ items: EntityRecord[]; total: number; }> {
    guardPrivateRead(typeKey, opts.admin,);
    const t = await requireType(typeKey,);
    const cacheable = Boolean(t.caching?.indexEnabled,) && !opts.admin;
    const key = CACHE_KEYS.entityList(typeKey, hashQuery(q,),);
    if (cacheable) {
        const cached = await cache.get<{ items: EntityRecord[]; total: number; }>(key,);
        if (cached) return cached;
    }
    const provider = getEntityDataProvider(typeKey,);
    const res = provider?.list ? await provider.list(q, opts,) : await repo.list(t, q,);
    if (cacheable) await cache.set(key, res, t.caching.indexTtlSeconds,);
    return res;
}

/** Get one record by id OR slug. */
export async function get(typeKey: string, idOrSlug: string, opts: { admin?: boolean; } = {},): Promise<EntityRecord> {
    guardPrivateRead(typeKey, opts.admin,);
    const t = await requireType(typeKey,);
    const cacheable = Boolean(t.caching?.recordEnabled,) && !opts.admin && UUID_RE.test(idOrSlug,);
    const key = CACHE_KEYS.entityRecord(typeKey, idOrSlug,);
    if (cacheable) {
        const cached = await cache.get<EntityRecord>(key,);
        if (cached) return cached;
    }
    const provider = getEntityDataProvider(typeKey,);
    const byId = UUID_RE.test(idOrSlug,);
    const getFirst = provider?.getById || provider?.getBySlug ? provider : { getById: (id: string,) => repo.getById(t, id,), getBySlug: (sl: string,) => repo.getBySlug(t, sl,), };
    const rec = byId
        ? (await getFirst.getById?.(idOrSlug,)) ?? (await getFirst.getBySlug?.(idOrSlug,).catch(() => null))
        : (await getFirst.getBySlug?.(idOrSlug,)) ?? (await getFirst.getById?.(idOrSlug,).catch(() => null));
    if (!rec) throw new NotFoundError(`${t.label} "${idOrSlug}"`,);
    if (cacheable) await cache.set(key, rec, t.caching.recordTtlSeconds,);
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
export async function copy(typeKey: string, id: string, _ctx: { userId?: string; } = {},): Promise<EntityRecord> {
    const t = await requireType(typeKey,);
    const newId = await transaction((client,) => copyRecord(client, t, id,));
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
