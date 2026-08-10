/**
 * Schema-CRUD service — create/update/delete entity TYPE definitions, driving
 * the table generator under a transaction and refreshing the EntityManager.
 * Enforces the core-type contract: core fields are locked; core types are not
 * deletable and their table is never generated (adopted).
 */
import { type EntityFieldDef, type EntityTypeDef, } from '@sitesurge/types';
import { transaction, } from '../db';
import * as repo from '../repositories/entityTypes.repo';
import * as tableGen from '../entities/tableGenerator';
import * as entityManager from '../entities/entityManager';
import { assertSafeIdentifier, assertValidFieldKey, } from '../entities/columnMap';
import { cache, } from './cache';
import { ValidationError, } from '../middleware/error';

export async function listTypes(): Promise<EntityTypeDef[]> {
    await entityManager.ready();
    return entityManager.all();
}

export async function getType(key: string,): Promise<EntityTypeDef | undefined> {
    await entityManager.ready();
    return entityManager.getType(key,);
}

export interface CreateTypeInput {
    key: string;
    label: string;
    labelPlural?: string;
    description?: string;
    hasSlug?: boolean;
    hasStatus?: boolean;
    searchable?: boolean;
    routing?: EntityTypeDef['routing'];
    caching?: EntityTypeDef['caching'];
    fields?: EntityFieldDef[];
}

const DEFAULT_ROUTING: EntityTypeDef['routing'] = { detailEnabled: false, detailPrefix: '', indexEnabled: false, indexPrefix: '', };
const DEFAULT_CACHING: EntityTypeDef['caching'] = { indexEnabled: true, indexTtlSeconds: 60, recordEnabled: true, recordTtlSeconds: 60, };

/** Create a new CUSTOM entity type + generate its table. */
export async function createType(input: CreateTypeInput,): Promise<EntityTypeDef> {
    assertSafeIdentifier(input.key, 'entity key',);
    await entityManager.ready();
    if (entityManager.getType(input.key,)) {
        throw new ValidationError(`Entity type "${input.key}" already exists`,);
    }
    const tableName = `ce_${input.key}`;
    const fields = normalizeFields(input.fields ?? [], /* core */ false,);
    const def: EntityTypeDef = {
        id: '', key: input.key, label: input.label,
        labelPlural: input.labelPlural || `${input.label}s`,
        singularVar: input.key, pluralVar: `${input.key}s`,
        description: input.description, origin: 'custom', internal: false,
        tableName, hasSlug: input.hasSlug ?? true, hasStatus: input.hasStatus ?? false,
        searchable: input.searchable ?? false, revisioned: false,
        routing: { ...DEFAULT_ROUTING, ...input.routing, },
        caching: { ...DEFAULT_CACHING, ...input.caching, },
        fields, createdAt: '', updatedAt: '',
    };

    await transaction(async (client,) => {
        const id = await repo.upsertType(def, client as never,);
        for (const f of fields) await repo.upsertField(id, f, client as never,);
        await tableGen.ensureTable({ ...def, id, }, client as never,);
    },);

    await entityManager.invalidate();
    await cache.invalidateEntityTypesCache();
    return entityManager.requireType(input.key,);
}

/** Update a type's props + fields. Core fields are immutable; non-core fields
 *  add/remove ALTER the table. Core types keep their adopted table. */
export async function updateType(key: string, patch: Partial<CreateTypeInput>,): Promise<EntityTypeDef> {
    await entityManager.ready();
    const existing = entityManager.requireType(key,);
    const coreKeys = new Set(existing.fields.filter((f,) => f.core,).map((f,) => f.key,),);

    const nextFields = patch.fields ? normalizeFields(patch.fields, false,) : existing.fields;
    // Guard: every core field must survive unchanged.
    for (const ck of coreKeys) {
        const kept = nextFields.find((f,) => f.key === ck,);
        const orig = existing.fields.find((f,) => f.key === ck,)!;
        if (!kept) throw new ValidationError(`Core field "${ck}" cannot be removed`,);
        if (kept.type !== orig.type) throw new ValidationError(`Core field "${ck}" type is locked`,);
        kept.core = true; // force
    }

    const merged: EntityTypeDef = {
        ...existing,
        label: patch.label ?? existing.label,
        labelPlural: patch.labelPlural ?? existing.labelPlural,
        description: patch.description ?? existing.description,
        hasStatus: patch.hasStatus ?? existing.hasStatus,
        searchable: patch.searchable ?? existing.searchable,
        routing: { ...existing.routing, ...patch.routing, },
        caching: { ...existing.caching, ...patch.caching, },
        fields: nextFields,
    };

    await transaction(async (client,) => {
        const id = await repo.upsertType(merged, client as never,);
        const existingKeys = new Set(existing.fields.map((f,) => f.key,),);
        const nextKeys = new Set(nextFields.map((f,) => f.key,),);
        // Upsert current fields + add columns for new ones.
        for (const f of nextFields) {
            await repo.upsertField(id, f, client as never,);
            if (!existingKeys.has(f.key,)) {
                await tableGen.ensureColumn({ key: key, tableName: existing.tableName, }, f, client as never,);
            }
        }
        // Remove non-core fields no longer present.
        for (const f of existing.fields) {
            if (!nextKeys.has(f.key,) && !coreKeys.has(f.key,)) {
                await repo.deleteField(id, f.key, client as never,);
                await tableGen.dropColumn({ key: key, tableName: existing.tableName, }, f.key, client as never,);
            }
        }
    },);

    await entityManager.invalidate();
    await cache.invalidateEntityTypesCache();
    return entityManager.requireType(key,);
}

/** Delete a CUSTOM type + drop its table. Core types are protected. */
export async function deleteType(key: string,): Promise<void> {
    await entityManager.ready();
    const existing = entityManager.requireType(key,);
    if (existing.origin === 'core' || existing.internal) {
        throw new ValidationError(`Core entity type "${key}" cannot be deleted`,);
    }
    await transaction(async (client,) => {
        await tableGen.dropTable({ key, tableName: existing.tableName, }, client as never,);
        await repo.deleteType(key, client as never,);
    },);
    await entityManager.invalidate();
    await cache.invalidateEntityTypesCache();
}

/** Coerce incoming field objects to full EntityFieldDefs (positions + flags). */
function normalizeFields(fields: EntityFieldDef[], forceCore: boolean,): EntityFieldDef[] {
    return fields.map((f, i,) => {
        assertValidFieldKey(f.key,);
        return {
            id: f.id || `f:${f.key}`, key: f.key, label: f.label || f.key, type: f.type,
            core: forceCore ? true : Boolean(f.core,),
            required: Boolean(f.required,), unique: Boolean(f.unique,),
            indexed: Boolean(f.indexed,), searchable: Boolean(f.searchable,),
            defaultValue: f.defaultValue, options: f.options, position: f.position ?? i,
        };
    },);
}
