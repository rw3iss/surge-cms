/**
 * Data access for the entity-type registry (`entity_types` + `entity_fields`).
 * Reads assemble a full `EntityTypeDef` (type + ordered fields). Writes accept
 * an optional txn client so schema changes run in the same transaction as the
 * table generator's DDL.
 */
import type { PoolClient, } from 'pg';
import type { EntityFieldDef, EntityTypeDef, } from '@sitesurge/types';
import { query, } from '../db';

interface DbClient { query(sql: string, params?: unknown[],): Promise<{ rows: any[]; }>; }
const q = (client?: DbClient,): DbClient => client ?? { query: (sql, params,) => query(sql, params as unknown[],), };

function mapField(r: any,): EntityFieldDef {
    return {
        id: r.id,
        key: r.key,
        label: r.label,
        type: r.type,
        core: r.core,
        required: r.required,
        unique: r.is_unique,
        indexed: r.indexed,
        searchable: r.searchable,
        defaultValue: r.default_value ?? undefined,
        options: r.options ?? undefined,
        position: r.position,
    };
}

function mapType(r: any, fields: EntityFieldDef[],): EntityTypeDef {
    return {
        id: r.id,
        key: r.key,
        label: r.label,
        labelPlural: r.label_plural,
        singularVar: r.singular_var,
        pluralVar: r.plural_var,
        description: r.description ?? undefined,
        origin: r.origin,
        internal: r.internal,
        ownerFeature: r.owner_feature ?? undefined,
        tableName: r.table_name,
        hasSlug: r.has_slug,
        hasStatus: r.has_status,
        searchable: r.searchable,
        revisioned: r.revisioned,
        routing: r.routing ?? {},
        caching: r.caching ?? {},
        adminListRoute: r.admin_list_route ?? undefined,
        adminEditRoute: r.admin_edit_route ?? undefined,
        fields,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

/** All entity type definitions with their fields (ordered by position). */
export async function findAllTypes(client?: DbClient,): Promise<EntityTypeDef[]> {
    const types = await q(client,).query('SELECT * FROM entity_types ORDER BY key',);
    if (types.rows.length === 0) return [];
    const fields = await q(client,).query(
        'SELECT * FROM entity_fields ORDER BY entity_type_id, position, key',
    );
    const byType = new Map<string, EntityFieldDef[]>();
    for (const f of fields.rows) {
        const arr = byType.get(f.entity_type_id,) ?? [];
        arr.push(mapField(f,),);
        byType.set(f.entity_type_id, arr,);
    }
    return types.rows.map((t,) => mapType(t, byType.get(t.id,) ?? [],),);
}

/** One type by key (with fields), or null. */
export async function findTypeByKey(key: string, client?: DbClient,): Promise<EntityTypeDef | null> {
    const t = await q(client,).query('SELECT * FROM entity_types WHERE key = $1', [key,],);
    if (t.rows.length === 0) return null;
    const f = await q(client,).query(
        'SELECT * FROM entity_fields WHERE entity_type_id = $1 ORDER BY position, key',
        [t.rows[0].id,],
    );
    return mapType(t.rows[0], f.rows.map(mapField,),);
}

/** Insert or update a type row (by key). Returns the row id. Does NOT touch
 *  fields — use `upsertField`/`replaceFields`. */
export async function upsertType(def: EntityTypeDef, client?: DbClient,): Promise<string> {
    const r = await q(client,).query(
        `INSERT INTO entity_types
            (key, label, label_plural, singular_var, plural_var, description, origin, internal,
             owner_feature, table_name, has_slug, has_status, searchable, revisioned, routing,
             caching, admin_list_route, admin_edit_route)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18)
         ON CONFLICT (key) DO UPDATE SET
            label = EXCLUDED.label, label_plural = EXCLUDED.label_plural,
            singular_var = EXCLUDED.singular_var, plural_var = EXCLUDED.plural_var,
            description = EXCLUDED.description, internal = EXCLUDED.internal,
            owner_feature = EXCLUDED.owner_feature, has_slug = EXCLUDED.has_slug,
            has_status = EXCLUDED.has_status, searchable = EXCLUDED.searchable,
            revisioned = EXCLUDED.revisioned, routing = EXCLUDED.routing,
            caching = EXCLUDED.caching, admin_list_route = EXCLUDED.admin_list_route,
            admin_edit_route = EXCLUDED.admin_edit_route, updated_at = NOW()
         RETURNING id`,
        [
            def.key, def.label, def.labelPlural, def.singularVar, def.pluralVar,
            def.description ?? null, def.origin, def.internal, def.ownerFeature ?? null,
            def.tableName, def.hasSlug, def.hasStatus, def.searchable, def.revisioned,
            JSON.stringify(def.routing ?? {},), JSON.stringify(def.caching ?? {},),
            def.adminListRoute ?? null, def.adminEditRoute ?? null,
        ],
    );
    return r.rows[0].id;
}

/** Insert or update one field (by (type,key)). */
export async function upsertField(entityTypeId: string, field: EntityFieldDef, client?: DbClient,): Promise<void> {
    await q(client,).query(
        `INSERT INTO entity_fields
            (entity_type_id, key, label, type, core, required, is_unique, indexed, searchable,
             default_value, options, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
         ON CONFLICT (entity_type_id, key) DO UPDATE SET
            label = EXCLUDED.label, type = EXCLUDED.type, required = EXCLUDED.required,
            is_unique = EXCLUDED.is_unique, indexed = EXCLUDED.indexed,
            searchable = EXCLUDED.searchable, default_value = EXCLUDED.default_value,
            options = EXCLUDED.options, position = EXCLUDED.position, updated_at = NOW()`,
        [
            entityTypeId, field.key, field.label, field.type, field.core, field.required,
            field.unique, field.indexed, field.searchable,
            field.defaultValue !== undefined ? JSON.stringify(field.defaultValue,) : null,
            field.options !== undefined ? JSON.stringify(field.options,) : null,
            field.position,
        ],
    );
}

/** Remove a non-core field row (the service enforces the core guard). */
export async function deleteField(entityTypeId: string, key: string, client?: DbClient,): Promise<void> {
    await q(client,).query(
        'DELETE FROM entity_fields WHERE entity_type_id = $1 AND key = $2', [entityTypeId, key,],
    );
}

/** Delete a type (CASCADE drops its fields). */
export async function deleteType(key: string, client?: DbClient,): Promise<void> {
    await q(client,).query('DELETE FROM entity_types WHERE key = $1', [key,],);
}
