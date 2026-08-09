/**
 * Content-block templates for one entity type — list + create. Each template is
 * an entity-bound block subtree edited in TemplateEditor.
 */
import { Title, } from '@solidjs/meta';
import { A, useParams, } from '@solidjs/router';
import type { ContentBlockTemplate, } from '@sitesurge/types';
import { Component, createResource, For, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';

const TemplateList: Component = () => {
    const params = useParams<{ type: string; }>();
    const [templates, { refetch, },] = createResource(
        () => params.type,
        async (type,) => {
            try {
                return await cms.contentBlockTemplates.list(type,);
            } catch {
                return [] as ContentBlockTemplate[];
            }
        },
    );

    return (
        <div class="admin-page entity-templates-page">
            <Title>Templates — {params.type} - Admin</Title>
            <div class="admin-header">
                <A href={`/admin/entities/${params.type}`} class="admin-header__back">← {params.type}</A>
                <h1>Content-block templates: {params.type}</h1>
                <div class="admin-header__actions">
                    <A href={`/admin/entities/${params.type}/templates/new`} class="btn btn--primary">+ New template</A>
                </div>
            </div>

            <Show
                when={(templates() ?? []).length > 0}
                fallback={<div class="empty-state">No templates yet. Create one to render {params.type} records anywhere in the block system.</div>}
            >
                <div class="entity-rows">
                    <For each={templates() ?? []}>
                        {(t,) => (
                            <A href={`/admin/entities/${params.type}/templates/${t.id}`} class="entity-row">
                                <div class="entity-row__main">
                                    <span class="entity-row__title">{t.name}</span>
                                    <span class="entity-row__badge">{t.mode}{t.maxRecords ? ` · max ${t.maxRecords}` : ''}</span>
                                    <Show when={t.description}><span class="entity-row__desc">{t.description}</span></Show>
                                </div>
                            </A>
                        )}
                    </For>
                </div>
            </Show>
            <button type="button" hidden onClick={() => refetch()} />
        </div>
    );
};

export default TemplateList;
