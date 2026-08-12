/**
 * Content-block templates for one entity type — list + create. Each template is
 * an entity-bound block subtree edited in TemplateEditor.
 */
import { Title, } from '@solidjs/meta';
import { A, useParams, } from '@solidjs/router';
import type { ContentBlockTemplate, } from '@sitesurge/types';
import { Component, createResource, For, Show, } from 'solid-js';
import { cms, } from '../../../services/cmsClient';
import './EntitiesList.scss';

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
            {/* Top-level breadcrumb back to the whole Entities list (the header's
                own back link only goes to this one entity type). */}
            <A href="/admin/entities" class="entity-breadcrumb-back">← All Entities</A>
            <div class="admin-header">
                <A href={`/admin/entities/${params.type}`} class="admin-header__back">← {params.type}</A>
                <h1>Content-block templates: {params.type}</h1>
                <div class="admin-header__actions">
                    <A href={`/admin/entities/${params.type}/templates/new`} class="ui-button ui-button--primary">+ New template</A>
                </div>
            </div>

            <Show
                when={(templates() ?? []).length > 0}
                fallback={<div class="empty-state">No templates yet. Create one to render {params.type} records anywhere in the block system.</div>}
            >
                <div class="entity-template-rows">
                    <For each={templates() ?? []}>
                        {(t,) => (
                            <div class="entity-template-row">
                                <div class="entity-template-row__main">
                                    <div class="entity-template-row__head">
                                        <A
                                            href={`/admin/entities/${params.type}/templates/${t.id}`}
                                            class="entity-template-row__title"
                                        >
                                            {t.name}
                                        </A>
                                        <span class="entity-template-row__mode">
                                            {t.mode}{t.maxRecords ? ` · max ${t.maxRecords}` : ''}
                                        </span>
                                    </div>
                                    <Show when={t.description}>
                                        <span class="entity-template-row__desc">{t.description}</span>
                                    </Show>
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </Show>
            <button type="button" hidden onClick={() => refetch()} />
        </div>
    );
};

export default TemplateList;
