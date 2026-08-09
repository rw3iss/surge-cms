/**
 * Core contracts for the generic entity system: a stored **entity type
 * definition** (schema) and its **field definitions**, plus the runtime
 * shapes for entity records and queries.
 *
 * These are stored in `entity_types` / `entity_fields` (see the API package)
 * and cached by the backend `EntityManager`. The admin schema editor, the
 * generic repo/service, the SDK, and the template runtimes all read them.
 */
import type { EntityFieldType, } from './fieldTypes';

/** Where an entity type came from. `core` types are system-owned (scaffolded
 *  by feature modules) and their core fields are locked. */
export type EntityOrigin = 'core' | 'custom';

/** One property on an entity type's schema. */
export interface EntityFieldDef {
    id: string;
    /** Column name (snake_case enforced by the backend). */
    key: string;
    label: string;
    type: EntityFieldType;
    /** Locked: a `core` field cannot be renamed, retyped, or removed. Only
     *  ever true on `core` entity types. Admin-added fields are never core. */
    core: boolean;
    required: boolean;
    unique: boolean;
    indexed: boolean;
    /** Included in the type's `search_vector` + the generic search filter. */
    searchable: boolean;
    defaultValue?: unknown;
    /** Type-specific options. */
    options?: {
        /** enum: allowed values. */
        values?: string[];
        /** relation: target entity type key. */
        relationType?: string;
        /** relation: many-to-many (join table) vs single FK. */
        relationMany?: boolean;
        min?: number;
        max?: number;
        pattern?: string;
    };
    position: number;
}

/** Public routing config for an entity type (index + detail pages). */
export interface EntityRouting {
    detailEnabled: boolean;
    /** e.g. `/recipes` → detail at `/recipes/:slug`. */
    detailPrefix: string;
    indexEnabled: boolean;
    indexPrefix: string;
}

/** Read-cache config for an entity type (index list + individual record). */
export interface EntityCaching {
    indexEnabled: boolean;
    indexTtlSeconds: number;
    recordEnabled: boolean;
    recordTtlSeconds: number;
}

/** A stored entity type definition (schema + behaviors + routing). */
export interface EntityTypeDef {
    id: string;
    /** Machine name, unique (`post`, `recipe`). Used in routes, the generated
     *  table name, and as the `{{ }}` function name. */
    key: string;
    /** Singular display label (`Post`). */
    label: string;
    /** Plural display label (`Posts`). */
    labelPlural: string;
    /** Template variable name for a single binding (`post`). */
    singularVar: string;
    /** Template variable name for a list binding (`posts`). */
    pluralVar: string;
    description?: string;
    origin: EntityOrigin;
    /** Core/system type: enable/disable ONLY via feature modules, never the
     *  Entities UI. Core fields locked; non-core fields still extensible. */
    internal: boolean;
    /** FeatureKey that owns/scaffolds this type (core types). */
    ownerFeature?: string;
    /** Backing table: generated (`ce_recipe`) or adopted (`posts`). */
    tableName: string;
    hasSlug: boolean;
    hasStatus: boolean;
    searchable: boolean;
    revisioned: boolean;
    routing: EntityRouting;
    caching: EntityCaching;
    /** Bespoke admin editor override — core modules point at their existing
     *  editor pages instead of the generic record editor. */
    adminListRoute?: string;
    /** Template with `:id` (e.g. `/admin/posts/:id/edit`). */
    adminEditRoute?: string;
    fields: EntityFieldDef[];
    createdAt: string;
    updatedAt: string;
}

/** A generic entity instance. Known columns are surfaced; everything else is
 *  the schema-defined fields (camelCase). */
export interface EntityRecord {
    id: string;
    slug?: string;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
    [field: string]: unknown;
}

/** A single filter clause: a bare value (equality) or an operator + value. */
export type EntityFilterValue =
    | string
    | number
    | boolean
    | null
    | { op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'in'; value: unknown; };

/** A generic entity query (list/filter/sort/paginate/search). */
export interface EntityQuery {
    filter?: Record<string, EntityFilterValue>;
    /** Full-text over the type's searchable fields. */
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
    status?: string;
}
