/**
 * Generic entity instance service — validation, slug/status handling, and
 * read caching (honoring each type's `caching` rules) over the generic repo.
 * The single business-logic home for CRUD on ANY entity type.
 */
import { createHash, } from 'crypto';
import { type EntityQuery, type EntityRecord, generateSlug, } from '@sitesurge/types';
import * as repo from '../repositories/genericEntity.repo';
import * as entityManager from '../entities/entityManager';
import { getEntityDataProvider, } from '../entities/dataProviders';
import { validateRecord, } from '../entities/columnMap';
import { cache, CACHE_KEYS, } from './cache';
import { NotFoundError, } from '../middleware/error';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function hashQuery(q: EntityQuery,): string {
    return createHash('sha1',).update(JSON.stringify(q,),).digest('hex',).slice(0, 16,);
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
