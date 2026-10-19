/**
 * Wire DTOs for the generic entities module (`/api/v1/entities`). Covers the
 * entity-type registry (schema management) + generic instance CRUD, plus the
 * content-block-template sub-resource.
 */
import type { EntityFieldDef, EntityFieldOption, EntityRecord, EntityTypeDef, } from '../../entities/types';
import type { ContentBlockTemplate, ContentBlockTemplateBlock, TemplateListRender, TemplateSlot, } from '../../entities/templates';

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

/** Query for field value suggestions. */
export interface EntityFilterValuesQuery {
    /** Case-insensitive substring narrowing the returned values. */
    search?: string;
}

/** Known values of a field — filter dropdowns and value suggestions. */
export interface EntityFilterValuesResponse {
    field: string;
    values: EntityFieldOption[];
}
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
    /** List mode: render once per record (`each`, default) or once with all (`once`). */
    listRender?: TemplateListRender;
    /** Preview-sample record ids (see ContentBlockTemplate.sampleRecordIds). */
    sampleRecordIds?: string[] | null;
    /** Data inputs filled by the using block (validated server-side). */
    slots?: TemplateSlot[];
    /** Components only: the collection to file it in (null = none). */
    collectionId?: string | null;
    /**
     * The template's whole block tree (`blockType` + `position` required per
     * block). When present, the template and its blocks are written in ONE
     * transaction (on update: the tree is REPLACED); omitted = blocks untouched.
     */
    blocks?: ContentBlockTemplateBlockInput[];
}
/** One block of a template tree on a write (`blockType`/`position`, NOT `type`/`order`). */
export type ContentBlockTemplateBlockInput =
    & Partial<ContentBlockTemplateBlock>
    & Pick<ContentBlockTemplateBlock, 'blockType' | 'position'>;
export type ContentBlockTemplateUpdateBody = Partial<ContentBlockTemplateCreateBody>;

/** GET /components/collections — every collection with its component count,
 *  plus how many components have none (`noneCount`, the "[None]" entry). */
export interface ComponentCollectionsListResponse {
    collections: import('../../entities/templates').ComponentCollection[];
    noneCount: number;
}
/** POST /components/collections · PUT /components/collections/:id */
export interface ComponentCollectionBody {
    name: string;
    description?: string | null;
}
/** DELETE /components/collections/:id?components=detach|delete — what happens
 *  to the components filed in it (default `detach` → [None]). */
export interface ComponentCollectionDeleteResponse {
    deleted: true;
    /** Components moved to [None] or deleted. */
    components: number;
}
