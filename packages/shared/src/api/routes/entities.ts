/**
 * Wire DTOs for the generic entities module (`/api/v1/entities`). Covers the
 * entity-type registry (schema management) + generic instance CRUD, plus the
 * content-block-template sub-resource.
 */
import type { EntityFieldDef, EntityRecord, EntityTypeDef, } from '../../entities/types';
import type { ContentBlockTemplate, ContentBlockTemplateBlock, } from '../../entities/templates';

// ── Entity types (schema) ──
export type EntityTypeListResponse = EntityTypeDef[];
export type EntityTypeGetResponse = EntityTypeDef;

export interface EntityTypeCreateBody {
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
export type EntityTypeUpdateBody = Partial<EntityTypeCreateBody>;

// ── Instances ──
export interface EntityListQuery {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    search?: string;
    status?: string;
    /** JSON-encoded `Record<string, EntityFilterValue>` filter. */
    filter?: string;
}
export type EntityListResponse = EntityRecord[]; // pagination on meta
export type EntityGetResponse = EntityRecord;
export type EntityCreateBody = Record<string, unknown>;
export type EntityUpdateBody = Record<string, unknown>;
export type EntityMutateResponse = EntityRecord;

// ── Content-block templates ──
export type ContentBlockTemplateListResponse = ContentBlockTemplate[];
export type ContentBlockTemplateGetResponse = ContentBlockTemplate & { blocks: ContentBlockTemplateBlock[]; };
export interface ContentBlockTemplateCreateBody {
    name: string;
    description?: string;
    mode?: 'single' | 'list';
    maxRecords?: number | null;
}
export type ContentBlockTemplateUpdateBody = Partial<ContentBlockTemplateCreateBody> & {
    blocks?: Array<Partial<ContentBlockTemplateBlock>>;
};
