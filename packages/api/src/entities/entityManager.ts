/**
 * EntityManager — the in-memory authority for entity-type metadata. Loads all
 * `EntityTypeDef`s (with fields) once at boot and serves them synchronously to
 * hot paths (the generic repo/service, the template runtime, routing). Any
 * schema mutation calls `invalidate()` to reload.
 *
 * Multi-instance note: invalidation currently reloads only the instance that
 * made the change. A Redis pub/sub broadcast can be layered on later; for now
 * the deployment is single-instance (documented assumption).
 */
import type { EntityFieldDef, EntityTypeDef, } from '@sitesurge/types';
import { NotFoundError, } from '../middleware/error';
import { findAllTypes, } from '../repositories/entityTypes.repo';

let cache: Map<string, EntityTypeDef> | null = null;

/** Populate/replace the cache from the DB. Called at boot + after schema edits. */
export async function load(): Promise<void> {
    const types = await findAllTypes();
    cache = new Map(types.map((t,) => [t.key, t,]),);
}

/** Ensure the cache is populated (loads once if empty). Cheap when loaded. */
export async function ready(): Promise<void> {
    if (!cache) await load();
}

function ensure(): Map<string, EntityTypeDef> {
    if (!cache) throw new Error('EntityManager not loaded — call load()/ready() at boot',);
    return cache;
}

export function getType(key: string,): EntityTypeDef | undefined {
    return ensure().get(key,);
}

export function requireType(key: string,): EntityTypeDef {
    const t = ensure().get(key,);
    if (!t) throw new NotFoundError(`Entity type "${key}"`,);
    return t;
}

export function all(): EntityTypeDef[] {
    return [...ensure().values(),];
}

export function getField(typeKey: string, fieldKey: string,): EntityFieldDef | undefined {
    return getType(typeKey,)?.fields.find((f,) => f.key === fieldKey,);
}

export function isLoaded(): boolean {
    return cache !== null;
}

/** Reload after a schema change (create/extend/delete type). */
export async function invalidate(): Promise<void> {
    await load();
}

/** Test seam: replace the cache directly (avoids a DB round-trip in unit tests). */
export function __setCacheForTests(types: EntityTypeDef[] | null,): void {
    cache = types ? new Map(types.map((t,) => [t.key, t,]),) : null;
}
