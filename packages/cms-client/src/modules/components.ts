/**
 * `cms.components` — reusable block templates bound to no entity type.
 *
 * The same rows as `cms.contentBlockTemplates`, minus the entity binding. They
 * are separate modules because the entity-bound endpoints take the type from
 * the URL and so cannot express "no type"; sharing one module would mean a
 * nullable `type` argument on every call.
 */
import type {
    ComponentCollection,
    ComponentCollectionBody,
    ComponentCollectionDeleteResponse,
    ComponentCollectionsListResponse,
    ContentBlockTemplate,
    ContentBlockTemplateBlock,
    ContentBlockTemplateCreateBody,
    ContentBlockTemplateUpdateBody,
    PageRevisionListResponse,
    Revision,
    RevisionRestoreOutcome,
    RevisionSnapshotResponse,
} from '@sitesurge/types';
import { ModuleBase, } from './base';

/** The component's optional client module + its on/off switch. Writing either
 *  requires the `components:script` permission server-side. */
export interface ComponentScriptFields {
    script?: string | null;
    scriptEnabled?: boolean;
}
export type ComponentTemplateCreateBody =
    & Omit<ContentBlockTemplateCreateBody, 'entityTypeKey'>
    & ComponentScriptFields;
export type ComponentTemplateUpdateBody =
    & Omit<ContentBlockTemplateUpdateBody, 'entityTypeKey'>
    & ComponentScriptFields;

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

    /**
     * Find a component (`scope: 'component'`) or an entity template
     * (`scope: 'template'`, optionally of `type`) by id OR name, with its
     * blocks — what `{{ component(...) }}` / `{{ template(...) }}` render.
     * Answers `{ error }` (not a throw) when nothing matches.
     */
    lookup(ref: string, scope: 'component' | 'template' = 'component', type?: string,): Promise<
        | { template: ContentBlockTemplate & { singularVar?: string; pluralVar?: string; }; blocks: ContentBlockTemplateBlock[]; }
        | { error: string; }
    > {
        return this.get('/components/lookup', { query: { ref, scope, ...(type ? { type, } : {}), }, },);
    }

    // ─── Collections (folders, organisation only) ───

    /** Every collection + its count, and `noneCount` (components in no collection). */
    collections(): Promise<ComponentCollectionsListResponse> {
        return this.get<ComponentCollectionsListResponse>('/components/collections', { options: { cache: false, }, },);
    }

    createCollection(body: ComponentCollectionBody,): Promise<ComponentCollection> {
        return this.mutate<ComponentCollection>('POST', '/components/collections', { body, invalidates: ['components',], },);
    }

    updateCollection(id: string, body: ComponentCollectionBody,): Promise<ComponentCollection> {
        return this.mutate<ComponentCollection>('PUT', '/components/collections/:id', {
            params: { id, }, body, invalidates: ['components',],
        },);
    }

    /** Delete a collection. Its components go to [None] (`detach`, default) or are deleted. */
    deleteCollection(id: string, components: 'detach' | 'delete' = 'detach',): Promise<ComponentCollectionDeleteResponse> {
        return this.mutate<ComponentCollectionDeleteResponse>('DELETE', '/components/collections/:id', {
            params: { id, }, query: { components, }, invalidates: ['components',],
        },);
    }

    /** URL of the component's browser module — a real same-origin file, which
     *  is what keeps CSP at `script-src 'self'`. */
    clientUrl(id: string,): string {
        return `/api/v1/components/templates/${id}/client.js`;
    }

    getBlocks(id: string,): Promise<ContentBlockTemplateBlock[]> {
        return this.get<ContentBlockTemplateBlock[]>('/components/templates/:id/blocks', { params: { id, }, },);
    }

    saveBlocks(id: string, blocks: Array<Partial<ContentBlockTemplateBlock>>,): Promise<{ saved: boolean; }> {
        return this.mutate<{ saved: boolean; }>('PUT', '/components/templates/:id/blocks', {
            params: { id, }, body: { blocks, }, invalidates: ['components',],
        },);
    }

    // ── Revisions (keyed by id: entity-bound templates use these too) ──

    /** GET /components/templates/:id/revisions — saved versions (meta + whole block tree each). */
    revisions(id: string,): Promise<PageRevisionListResponse> {
        return this.get<PageRevisionListResponse>('/components/templates/:id/revisions', { params: { id, }, options: { cache: false, }, },);
    }

    /** POST /components/templates/:id/revisions — snapshot the current state now. */
    snapshotRevision(id: string,): Promise<RevisionSnapshotResponse> {
        return this.mutate<RevisionSnapshotResponse>('POST', '/components/templates/:id/revisions', { params: { id, }, },);
    }

    /** GET /components/templates/:id/revisions/:version — one snapshot. */
    getRevision(id: string, version: number,): Promise<Revision> {
        return this.get<Revision>('/components/templates/:id/revisions/:version', { params: { id, version, }, options: { cache: false, }, },);
    }

    /** POST /components/templates/:id/revisions/:version/restore — settings + whole block tree. */
    restoreRevision(id: string, version: number,): Promise<ContentBlockTemplate & { restore: RevisionRestoreOutcome; }> {
        return this.mutate<ContentBlockTemplate & { restore: RevisionRestoreOutcome; }>(
            'POST', '/components/templates/:id/revisions/:version/restore',
            { params: { id, version, }, invalidates: ['components', 'content-block-templates',], },
        );
    }
}
