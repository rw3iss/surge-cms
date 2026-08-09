import type {
    ContentBlockTemplate,
    ContentBlockTemplateBlock,
    ContentBlockTemplateCreateBody,
    ContentBlockTemplateUpdateBody,
    EntityQuery,
    EntityRecord,
    EntityTypeCreateBody,
    EntityTypeDef,
    EntityTypeUpdateBody,
    Paginated,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/** Serialize an EntityQuery to wire params (filter → JSON string). */
function toParams(query?: EntityQuery,): Record<string, unknown> {
    if (!query) return {};
    const { filter, ...rest } = query;
    return { ...rest, ...(filter ? { filter: JSON.stringify(filter,), } : {}), };
}

/** `cms.entities` — generic instance CRUD for any entity type. */
export class EntitiesModule extends ModuleBase {
    protected readonly module = 'entities';

    list(type: string, query?: EntityQuery,): Promise<Paginated<EntityRecord>> {
        return this.getPaged<EntityRecord>('/entities/:type', { params: { type, }, query: toParams(query,), },);
    }

    getOne(type: string, idOrSlug: string,): Promise<EntityRecord> {
        return this.get<EntityRecord>('/entities/:type/:idOrSlug', { params: { type, idOrSlug, }, },);
    }

    create(type: string, body: Record<string, unknown>,): Promise<EntityRecord> {
        return this.mutate<EntityRecord>('POST', '/entities/:type', { params: { type, }, body, invalidates: ['entities',], },);
    }

    update(type: string, id: string, body: Record<string, unknown>,): Promise<EntityRecord> {
        return this.mutate<EntityRecord>('PUT', '/entities/:type/:id', { params: { type, id, }, body, invalidates: ['entities',], },);
    }

    remove(type: string, id: string,): Promise<{ deleted: boolean; }> {
        return this.mutate<{ deleted: boolean; }>('DELETE', '/entities/:type/:id', { params: { type, id, }, invalidates: ['entities',], },);
    }

    async count(type: string, query?: EntityQuery,): Promise<number> {
        const res = await this.list(type, { ...query, limit: 1, },);
        return res.meta.total ?? 0;
    }
}

/** `cms.entityTypes` — the entity-type registry (schema management). */
export class EntityTypesModule extends ModuleBase {
    protected readonly module = 'entity-types';

    list(): Promise<EntityTypeDef[]> {
        return this.get<EntityTypeDef[]>('/entities/types',);
    }

    getOne(key: string,): Promise<EntityTypeDef> {
        return this.get<EntityTypeDef>('/entities/types/:key', { params: { key, }, },);
    }

    create(body: EntityTypeCreateBody,): Promise<EntityTypeDef> {
        return this.mutate<EntityTypeDef>('POST', '/entities/types', { body, invalidates: ['entity-types',], },);
    }

    update(key: string, body: EntityTypeUpdateBody,): Promise<EntityTypeDef> {
        return this.mutate<EntityTypeDef>('PUT', '/entities/types/:key', { params: { key, }, body, invalidates: ['entity-types',], },);
    }

    remove(key: string,): Promise<{ deleted: boolean; }> {
        return this.mutate<{ deleted: boolean; }>('DELETE', '/entities/types/:key', { params: { key, }, invalidates: ['entity-types',], },);
    }
}

/** `cms.contentBlockTemplates` — reusable entity-bound block subtrees. */
export class ContentBlockTemplatesModule extends ModuleBase {
    protected readonly module = 'content-block-templates';

    list(type: string,): Promise<ContentBlockTemplate[]> {
        return this.get<ContentBlockTemplate[]>('/entities/:type/templates', { params: { type, }, },);
    }

    getOne(type: string, id: string,): Promise<ContentBlockTemplate & { blocks: ContentBlockTemplateBlock[]; }> {
        return this.get<ContentBlockTemplate & { blocks: ContentBlockTemplateBlock[]; }>(
            '/entities/:type/templates/:id', { params: { type, id, }, },
        );
    }

    create(type: string, body: ContentBlockTemplateCreateBody,): Promise<ContentBlockTemplate> {
        return this.mutate<ContentBlockTemplate>('POST', '/entities/:type/templates', {
            params: { type, }, body, invalidates: ['content-block-templates',],
        },);
    }

    update(type: string, id: string, body: ContentBlockTemplateUpdateBody,): Promise<ContentBlockTemplate> {
        return this.mutate<ContentBlockTemplate>('PUT', '/entities/:type/templates/:id', {
            params: { type, id, }, body, invalidates: ['content-block-templates',],
        },);
    }

    remove(type: string, id: string,): Promise<{ deleted: boolean; }> {
        return this.mutate<{ deleted: boolean; }>('DELETE', '/entities/:type/templates/:id', {
            params: { type, id, }, invalidates: ['content-block-templates',],
        },);
    }

    getBlocks(type: string, id: string,): Promise<ContentBlockTemplateBlock[]> {
        return this.get<ContentBlockTemplateBlock[]>('/entities/:type/templates/:id/blocks', { params: { type, id, }, },);
    }

    saveBlocks(type: string, id: string, blocks: Array<Partial<ContentBlockTemplateBlock>>,): Promise<{ saved: boolean; }> {
        return this.mutate<{ saved: boolean; }>('PUT', '/entities/:type/templates/:id/blocks', {
            params: { type, id, }, body: { blocks, }, invalidates: ['content-block-templates',],
        },);
    }
}
