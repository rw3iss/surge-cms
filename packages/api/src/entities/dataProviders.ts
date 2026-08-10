/**
 * Entity data-provider registry. A feature (e.g. Shop) can register a custom
 * data layer for one of its entity types to override the generic repo — e.g.
 * the `product` type reads product columns generically (so admin extensions
 * still work) but ENRICHES each record with related-table data (media, tags).
 *
 * `services/entities.ts` consults this registry per operation: any method a
 * provider defines wins; anything it omits falls back to the generic repo. This
 * is how a feature "manages its entity through the entity system" while keeping
 * the generic surface (`cms.entities.*`, `{{type(...)}}`) uniform.
 */
import type { EntityQuery, EntityRecord, } from '@sitesurge/types';

export interface EntityDataProvider {
    list?(query: EntityQuery, opts: { admin?: boolean; },): Promise<{ items: EntityRecord[]; total: number; }>;
    getById?(id: string,): Promise<EntityRecord | null>;
    getBySlug?(slug: string,): Promise<EntityRecord | null>;
    create?(body: Record<string, unknown>, ctx: { userId?: string; },): Promise<EntityRecord>;
    update?(id: string, body: Record<string, unknown>,): Promise<EntityRecord>;
    remove?(id: string,): Promise<void>;
}

const providers = new Map<string, EntityDataProvider>();

export function registerEntityDataProvider(typeKey: string, provider: EntityDataProvider,): void {
    providers.set(typeKey, provider,);
}

export function getEntityDataProvider(typeKey: string,): EntityDataProvider | undefined {
    return providers.get(typeKey,);
}
