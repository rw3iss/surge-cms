/**
 * `cms.components` — reusable block templates bound to no entity type.
 *
 * The same rows as `cms.contentBlockTemplates`, minus the entity binding. They
 * are separate modules because the entity-bound endpoints take the type from
 * the URL and so cannot express "no type"; sharing one module would mean a
 * nullable `type` argument on every call.
 */
import type {
    ContentBlockTemplate,
    ContentBlockTemplateBlock,
    ContentBlockTemplateCreateBody,
    ContentBlockTemplateUpdateBody,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/** Global templates carry no entity binding, so `entityTypeKey` is never sent. */
export type ComponentTemplateCreateBody = Omit<ContentBlockTemplateCreateBody, 'entityTypeKey'>;
export type ComponentTemplateUpdateBody = Omit<ContentBlockTemplateUpdateBody, 'entityTypeKey'>;

export class ComponentsModule extends ModuleBase {
    protected readonly module = 'components';

    list(): Promise<ContentBlockTemplate[]> {
        return this.get<ContentBlockTemplate[]>('/components/templates',);
    }

    getOne(id: string,): Promise<ContentBlockTemplate & { blocks: ContentBlockTemplateBlock[]; }> {
        return this.get<ContentBlockTemplate & { blocks: ContentBlockTemplateBlock[]; }>(
            '/components/templates/:id', { params: { id, }, },
        );
    }

    create(body: ComponentTemplateCreateBody,): Promise<ContentBlockTemplate> {
        return this.mutate<ContentBlockTemplate>('POST', '/components/templates', {
            body, invalidates: ['components',],
        },);
    }

    update(id: string, body: ComponentTemplateUpdateBody,): Promise<ContentBlockTemplate> {
        return this.mutate<ContentBlockTemplate>('PUT', '/components/templates/:id', {
            params: { id, }, body, invalidates: ['components',],
        },);
    }

    remove(id: string,): Promise<{ deleted: boolean; }> {
        return this.mutate<{ deleted: boolean; }>('DELETE', '/components/templates/:id', {
            params: { id, }, invalidates: ['components',],
        },);
    }

    getBlocks(id: string,): Promise<ContentBlockTemplateBlock[]> {
        return this.get<ContentBlockTemplateBlock[]>('/components/templates/:id/blocks', { params: { id, }, },);
    }

    saveBlocks(id: string, blocks: Array<Partial<ContentBlockTemplateBlock>>,): Promise<{ saved: boolean; }> {
        return this.mutate<{ saved: boolean; }>('PUT', '/components/templates/:id/blocks', {
            params: { id, }, body: { blocks, }, invalidates: ['components',],
        },);
    }
}
