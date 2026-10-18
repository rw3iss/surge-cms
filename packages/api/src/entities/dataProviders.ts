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
import type { EntityViewer, } from './publicRead';

/** Read options a provider receives (mirrors `EntityReadOpts` in services/entities.ts). */
export interface ProviderReadOpts {
    /** A staff caller: every status, no gate. */
    admin?: boolean;
    /** `email` = rendered into a newsletter (see `EntityReadOpts.audience`). */
    audience?: 'email';
    /** The signed-in non-staff caller; omitted = anonymous (SSR, mail, backend runtime). */
    viewer?: EntityViewer;
}

export interface EntityDataProvider {
    list?(query: EntityQuery, opts: ProviderReadOpts,): Promise<{ items: EntityRecord[]; total: number; }>;
    /**
     * Non-admin single reads: may this caller read `rec`? `false` → 404. For a
     * provider whose type has its own visibility rule (an event's "who can see").
     */
    allows?(rec: EntityRecord, opts: ProviderReadOpts,): Promise<boolean>;
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
