/**
 * The shared **EntityTypeRegistry** — the runtime face of the stored entity
 * type definitions, and the single seam that replaces the three duplicated
 * `switch(name)` blocks in the template runtimes (cms / ssr / mail).
 *
 * Each platform builds descriptors with the SAME shape but injects its own
 * fetchers (the SDK on the client; backend services on the server), so the
 * `{{ }}` engine resolves any registered entity kind — core or custom — from
 * one definition.
 */
import type { EntityFieldDef, EntityQuery, EntityRecord, } from './types';

/** Everything the template runtimes + generic renderers need for one kind. */
export interface EntityKindDescriptor {
    key: string;
    /** Schema fields — power the generic field renderer + reference docs. */
    fields: EntityFieldDef[];
    /** Bound-variable names for single / list template usage. */
    singularVar: string;
    pluralVar: string;
    /** Platform-injected data access (SDK on cms, services on server). */
    getById(id: string,): Promise<EntityRecord | null>;
    getBySlug(slug: string,): Promise<EntityRecord | null>;
    list(query: EntityQuery,): Promise<{ items: EntityRecord[]; total: number; }>;
    count(query?: EntityQuery,): Promise<number>;
    /** Link builder for the entity's public detail page (replaces the
     *  hardcoded `'/posts/' + slug`). */
    detailPath?(rec: EntityRecord,): string;
}

/** A registry of entity-kind descriptors, keyed by entity type key. */
export interface EntityTypeRegistry {
    get(key: string,): EntityKindDescriptor | undefined;
    all(): EntityKindDescriptor[];
    register(descriptor: EntityKindDescriptor,): void;
}

/** Simple in-memory registry implementation shared by all platforms. */
export function createEntityTypeRegistry(): EntityTypeRegistry {
    const map = new Map<string, EntityKindDescriptor>();
    return {
        get: (key,) => map.get(key,),
        all: () => [...map.values(),],
        register: (d,) => {
            map.set(d.key, d,);
        },
    };
}
